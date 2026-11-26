import { z } from 'zod';
import { scalar, transaction, type DatabaseSync } from '../db.js';
import { badRequest, parse, zmsg } from '../lib/http.js';
import { t } from '../i18n.js';
import { cancelEventRuns, fireTrigger, normalizeEventName } from './automations.js';
import { closeCartsForEmail, upsertCart } from './carts.js';
import { CONTACT_STATUSES, findContactByEmail, isValidEmail, normalizeEmail, recordEvent, upsertContact, type Contact } from './contacts.js';

/**
 * Everything a website can tell Pingsell, whatever the way it arrives: the REST API (API key),
 * the universal webhook (WooCommerce, Webflow, Framer, Wix, Tally…), the paste-in signup form,
 * the WordPress and PrestaShop extensions. One code path, so they all behave the same.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const contactInputSchema = z.object({
  email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')).max(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  phone: optionalText(40),
  /** Customer's language (« fr », « en-GB »…): campaigns are translated into it when auto-translation is on. */
  language: optionalText(35),
  tags: z.array(z.string().max(64)).max(100).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
});

/** "59,90 €", "€1,234.56", "1 234,56" → number. */
export function parseMoney(v: string): number {
  // Plain numbers keep JavaScript's reading (as before): "59.90", "1e3".
  if (/^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i.test(v)) return Number(v);
  let s = v.replace(/[^\d.,-]/g, '');
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  // The last separator is the decimal one when followed by 1–2 digits; the other is for thousands.
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '') : s.replace(/,/g, '');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\.(?=.*\.)/g, '');
  return s === '' ? NaN : Number(s);
}

/** Accepts 59.9, "59.90", "59,90" or "59,90 €" (POS, PHP back-ends and site builders often send strings). */
export const money = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? parseMoney(v) : v),
  z.number().nonnegative().max(1_000_000_000, zmsg('Le total est trop élevé', 'Total is too high')),
);

/** « Panier » : sent when the customer leaves their email at checkout; Pingsell relaunches it if no order follows. */
export const cartSchema = z.object({
  email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')).max(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  cart_id: z.string().trim().min(1, zmsg('cart_id est requis', 'cart_id is required')).max(100),
  total: money.optional(),
  currency: z.string().trim().max(8).optional(),
  checkout_url: z.string().trim().url(zmsg('checkout_url doit être une adresse web complète', 'checkout_url must be a full web address')).max(2000).optional(),
  items: z.array(z.object({ title: z.string().trim().min(1).max(200), quantity: z.number().int().positive().max(10_000).optional(), price: money.optional() })).max(50).optional(),
});

/** Names a site may send for the built-in moments (French and English, accents and case ignored). */
export const BUILTIN_EVENTS: Record<string, 'contact' | 'cart' | 'order' | 'shipped'> = Object.fromEntries([
  ...['inscription', 'contact', 'nouveau_client', 'client', 'signup', 'sign_up', 'newsletter', 'subscribe'].map((n) => [n, 'contact' as const]),
  ...['panier', 'cart', 'checkout', 'panier_en_cours'].map((n) => [n, 'cart' as const]),
  ...['commande', 'order', 'achat', 'purchase', 'commande_passee', 'order_created'].map((n) => [n, 'order' as const]),
  ...['expedition', 'shipped', 'shipping', 'livraison', 'commande_expediee', 'order_fulfilled', 'fulfilled'].map((n) => [n, 'shipped' as const]),
]);

export const eventSchema = z.object({
  event: z.string().trim().min(1, zmsg("Le nom de l'événement est requis (event)", 'Event name is required (event)')).max(64),
  email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')).max(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  phone: optionalText(40),
  /** Customer's language (« fr », « en-GB »…): campaigns are translated into it when auto-translation is on. */
  language: optionalText(35),
  tags: z.array(z.string().max(64)).max(100).optional(),
  /** Your id for this cart / order / booking: the same id sent again updates it instead of duplicating. */
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1).max(100)).optional(),
  /** When it happens (booking, appointment…), for « N hours before » reminders. */
  date: z.string().trim().max(40).refine((v) => !Number.isNaN(Date.parse(v)), zmsg('date doit être une date (ex : 2026-12-24T19:30:00+01:00)', 'date must be a date (e.g. 2026-12-24T19:30:00+01:00)')).optional(),
  status: z.string().trim().toLowerCase().max(40).optional(),
  total: money.optional(),
  currency: z.string().trim().max(8).optional(),
  url: z.string().trim().url(zmsg('url doit être une adresse web complète', 'url must be a full web address')).max(2000).optional(),
  items: z.array(z.object({ title: z.string().trim().min(1).max(200), quantity: z.number().int().positive().max(10_000).optional(), price: money.optional() })).max(50).optional(),
  carrier: z.string().trim().max(100).optional(),
  tracking_number: z.string().trim().max(100).optional(),
  tracking_url: z.string().trim().max(2000).optional(),
  /** Booking reminder, receipt…: also reaches customers unsubscribed from marketing. */
  transactional: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const orderSchema = z.object({
  email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')).max(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  phone: optionalText(40),
  /** Customer's language (« fr », « en-GB »…): campaigns are translated into it when auto-translation is on. */
  language: optionalText(35),
  order_id: z.string().trim().min(1, zmsg('order_id est requis', 'order_id is required')).max(100),
  /** `created` = order placed (« Commande passée »), `fulfilled` = shipped (« Commande expédiée »). */
  status: z.enum(['created', 'fulfilled']).default('created'),
  total: money.optional(),
  currency: z.string().trim().max(8).optional(),
  tracking_number: z.string().trim().max(100).optional(),
  tracking_url: z.string().trim().max(2000).optional(),
  carrier: z.string().trim().max(100).optional(),
});

const CANCEL_WORDS = ['cancelled', 'canceled', 'annule', 'annulee', 'annulé', 'annulée'];

export interface IngestResult {
  code: number;
  body: Record<string, unknown>;
}

export interface IngestOptions {
  /** Public form or webhook: never overwrite a known name/phone, a stranger could send anything. */
  untrusted?: boolean;
}

const DATA_MAX = 8 * 1024;
const VALUE_MAX = 1000;
/** Free event data is stored on every event: keep it small whatever the source sends. */
export function capData(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let size = 2;
  for (const [k, v] of Object.entries(input)) {
    const value = typeof v === 'string' && v.length > VALUE_MAX ? v.slice(0, VALUE_MAX) : v;
    const cost = k.length + (JSON.stringify(value) ?? '').length + 4;
    if (size + cost > DATA_MAX) continue;
    out[k.slice(0, 64)] = value;
    size += cost;
  }
  return out;
}

export function createIngest(db: DatabaseSync) {
  /** Records `tag_added` events + fires automations for each newly added tag. */
  const onTagsAdded = (accountId: string, contactId: string, tags: string[]) => {
    for (const tag of tags) {
      recordEvent(db, accountId, contactId, 'tag_added', { tag });
      fireTrigger(db, accountId, contactId, 'tag_added', { tag });
    }
  };

  const onCreated = (accountId: string, contact: Contact, triggers = true) => {
    recordEvent(db, accountId, contact.id, 'contact_created', { source: contact.source });
    if (triggers) fireTrigger(db, accountId, contact.id, 'contact_created', { source: contact.source });
  };

  const saveContact = (accountId: string, body: z.output<typeof contactInputSchema>, opts: IngestOptions = {}) =>
    transaction(db, () => {
      const r = upsertContact(db, accountId, { ...body, source: 'api', fill_only: opts.untrusted });
      if (r.created) onCreated(accountId, r.contact);
      onTagsAdded(accountId, r.contact.id, r.created ? r.contact.tags : r.addedTags);
      return r;
    });

  const placeOrder = (accountId: string, body: z.output<typeof orderSchema>, opts: IngestOptions = {}) =>
    transaction(db, () => {
      const existing = findContactByEmail(db, accountId, normalizeEmail(body.email));
      const identity = { email: body.email, first_name: body.first_name, last_name: body.last_name, phone: body.phone, language: body.language, source: 'api' as const, fill_only: opts.untrusted };
      if (body.status === 'fulfilled') {
        // Like Shopify: a shipment never creates (and opts in) a marketing contact.
        if (!existing) return { contact: null, duplicate: false, skipped: true };
        const tracking = body.tracking_number ?? null;
        const shipments = db
          .prepare(
            // Pinned to the buyer's own history (idx_events_contact): idx_events_account_type would read every shipment of the account.
            `SELECT id, data FROM events INDEXED BY idx_events_contact WHERE contact_id = ? AND account_id = ? AND type = 'order_fulfilled'
               AND json_extract(data, '$.order_id') = ?`,
          )
          .all(existing.id, accountId, body.order_id) as { id: string; data: string }[];
        const tracked = (e: { data: string }) => (JSON.parse(e.data) as { tracking_number?: string | null }).tracking_number ?? null;
        if (shipments.some((e) => !tracking || tracked(e) === tracking)) return { contact: existing, duplicate: true, skipped: false };
        // The tracking number often arrives after the shipment: complete it without a second email.
        const pending = shipments.find((e) => !tracked(e));
        if (pending) {
          const prev = JSON.parse(pending.data) as Record<string, unknown>;
          const next = { ...prev, tracking_number: tracking, tracking_url: body.tracking_url ?? prev.tracking_url ?? null, carrier: body.carrier ?? prev.carrier ?? null };
          db.prepare('UPDATE events SET data = ? WHERE id = ?').run(JSON.stringify(next), pending.id);
          return { contact: existing, duplicate: true, skipped: false };
        }
        const data = {
          order_id: body.order_id,
          tracking_number: body.tracking_number ?? null,
          tracking_url: body.tracking_url ?? null,
          carrier: body.carrier ?? null,
          source: 'api',
        };
        recordEvent(db, accountId, existing.id, 'order_fulfilled', data);
        fireTrigger(db, accountId, existing.id, 'order_fulfilled', data);
        return { contact: existing, duplicate: false, skipped: false };
      }
      // Scoped to the buyer: nobody can « burn » someone else's order number in advance.
      const duplicate =
        !!existing &&
        scalar(
          db,
          // Same: only this contact's events (idx_events_contact), never every order of the account.
          "SELECT COUNT(*) FROM events INDEXED BY idx_events_contact WHERE contact_id = ? AND account_id = ? AND type = 'order' AND json_extract(data, '$.order_id') = ?",
          existing.id,
          accountId,
          body.order_id,
        ) > 0;
      const total = body.total ?? 0;
      const r = upsertContact(db, accountId, {
        ...identity,
        ...(duplicate
          ? {}
          : {
              total_spent: Math.round(((existing?.total_spent ?? 0) + total) * 100) / 100,
              orders_count: (existing?.orders_count ?? 0) + 1,
              last_order_at: new Date().toISOString(),
            }),
      });
      if (r.created) onCreated(accountId, r.contact);
      if (!duplicate) {
        const data = { order_id: body.order_id, total, currency: body.currency ?? null, source: 'api' };
        recordEvent(db, accountId, r.contact.id, 'order', data);
        closeCartsForEmail(db, accountId, r.contact.email);
        fireTrigger(db, accountId, r.contact.id, 'order_created', data);
      }
      return { contact: r.contact, duplicate, skipped: false };
    });

  /**
   * The single call a website needs: `event` says what happened, Pingsell does the rest.
   * Known names (inscription, panier, commande, expedition…) keep their built-in behaviour;
   * any other name (reservation, rendez_vous, avis…) can start an automation « Événement ».
   */
  const ingestEvent = (accountId: string, raw: Record<string, unknown>, opts: IngestOptions = {}): IngestResult => {
    const body = parse(eventSchema, raw);
    const name = normalizeEventName(body.event);
    if (!name) throw badRequest(t("Le nom de l'événement est requis", 'Event name is required'));
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw badRequest(t(`Adresse email invalide : ${body.email}`, `Invalid email address: ${body.email}`));
    const identity = { email, first_name: body.first_name, last_name: body.last_name, phone: body.phone, language: body.language };
    const kind = BUILTIN_EVENTS[name];
    const cancelled = CANCEL_WORDS.includes(body.status ?? '');

    if (kind === 'contact') {
      const r = saveContact(accountId, { ...identity, tags: body.tags }, opts);
      return { code: r.created ? 201 : 200, body: { ok: true, event: name, contact_id: r.contact.id } };
    }
    if (kind === 'cart') {
      if (!body.id) throw badRequest(t('id est requis pour un panier', 'id is required for a cart'));
      upsertCart(db, accountId, { ...identity, cart_id: body.id, total: body.total, currency: body.currency, checkout_url: body.url, items: body.items });
      return { code: 201, body: { ok: true, event: name } };
    }
    if (kind === 'order' || kind === 'shipped') {
      if (!body.id) throw badRequest(t('id est requis pour une commande', 'id is required for an order'));
      const r = placeOrder(accountId, {
        ...identity,
        order_id: body.id,
        status: kind === 'shipped' ? 'fulfilled' : 'created',
        total: body.total,
        currency: body.currency,
        carrier: body.carrier,
        tracking_number: body.tracking_number,
        tracking_url: body.tracking_url ?? (kind === 'shipped' ? body.url : undefined),
      }, opts);
      if (body.tags?.length && r.contact) saveContact(accountId, { email, tags: body.tags }, opts);
      return { code: r.skipped || r.duplicate ? 200 : 201, body: { ok: true, event: name, skipped: r.skipped || undefined, duplicate: r.duplicate || undefined } };
    }

    // Any other event: a moment in the customer's life that the merchant names freely.
    const result = transaction(db, () => {
      const existing = findContactByEmail(db, accountId, email);
      if (cancelled) {
        const stopped = existing && body.id ? cancelEventRuns(db, accountId, existing.id, name, body.id) : 0;
        if (existing) recordEvent(db, accountId, existing.id, 'event', { event: name, id: body.id ?? null, status: 'cancelled' });
        return { contactId: existing?.id ?? null, stopped, started: 0 };
      }
      const r = saveContact(accountId, { ...identity, tags: body.tags }, opts);
      const known = new Set(Object.keys(eventSchema.shape));
      const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)));
      const data = { ...capData({ ...extra, ...(body.data ?? {}) }), event: name, id: body.id ?? null, date: body.date ?? null, url: body.url ?? null, total: body.total ?? null, transactional: body.transactional === true };
      recordEvent(db, accountId, r.contact.id, 'event', data);
      const started = fireTrigger(db, accountId, r.contact.id, 'event', data);
      return { contactId: r.contact.id, stopped: 0, started };
    });
    return {
      code: cancelled ? 200 : 201,
      body: { ok: true, event: name, contact_id: result.contactId, automations_started: result.started, automations_stopped: cancelled ? result.stopped : undefined },
    };
  };

  return { saveContact, placeOrder, ingestEvent, onCreated, onTagsAdded };
}

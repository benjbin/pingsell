import { randomBytes } from 'node:crypto';
import { get, newId, now, parseJson, run, type DatabaseSync } from '../db.js';
import { isValidEmail } from './contacts.js';
import { parseMoney } from './ingest.js';
import { parisToUtc } from './automations.js';

/**
 * No-code sites (WooCommerce, Webflow, Framer, Wix, Tally, Typeform, Squarespace…) can't call an API
 * with a header: they post their own JSON to a URL. This module turns any of those payloads into
 * Pingsell events (the same ones `POST /events` accepts).
 */

export type HookKind = 'webhook' | 'form';

export interface InboundHook {
  id: string;
  account_id: string;
  kind: HookKind;
  token: string;
  allowed_origins: string;
  uses: number;
  last_used_at: string | null;
  last_source: string | null;
  last_result: string | null;
  created_at: string;
}

const newToken = (kind: HookKind) => `${kind === 'webhook' ? 'whk' : 'pk'}_${randomBytes(18).toString('base64url')}`;

/** The account's webhook URL token or form key, created on first use. */
export function ensureHook(db: DatabaseSync, accountId: string, kind: HookKind): InboundHook {
  const existing = get<InboundHook>(db, 'SELECT * FROM inbound_hooks WHERE account_id = ? AND kind = ?', accountId, kind);
  if (existing) return existing;
  run(db, 'INSERT INTO inbound_hooks (id, account_id, kind, token, created_at) VALUES (?, ?, ?, ?, ?)', newId(), accountId, kind, newToken(kind), now());
  return get<InboundHook>(db, 'SELECT * FROM inbound_hooks WHERE account_id = ? AND kind = ?', accountId, kind)!;
}

export function rotateHook(db: DatabaseSync, accountId: string, kind: HookKind): InboundHook {
  ensureHook(db, accountId, kind);
  run(db, 'UPDATE inbound_hooks SET token = ? WHERE account_id = ? AND kind = ?', newToken(kind), accountId, kind);
  return ensureHook(db, accountId, kind);
}

export function findHook(db: DatabaseSync, kind: HookKind, token: string): InboundHook | undefined {
  if (!token || token.length > 80) return undefined;
  return get<InboundHook>(db, 'SELECT * FROM inbound_hooks WHERE kind = ? AND token = ?', kind, token);
}

/** Shown in Intégrations (« Dernier appel : WooCommerce, il y a 2 min — commande ») so the merchant can check the setup. */
export function markHookUsed(db: DatabaseSync, hook: InboundHook, source: string, result: Record<string, unknown>) {
  run(db, 'UPDATE inbound_hooks SET uses = uses + 1, last_used_at = ?, last_source = ?, last_result = ? WHERE id = ?', now(), source, JSON.stringify(result), hook.id);
}

export const hookOrigins = (hook: InboundHook) => parseJson<string[]>(hook.allowed_origins, []);

/** `https://www.Shop.fr/` → `shop.fr` (www ignored), for the form's allowed domains. */
export function siteHost(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** True when the calling page belongs to one of the allowed domains (or a subdomain of one). */
export function originAllowed(hook: InboundHook, origin: string | undefined): boolean {
  const allowed = hookOrigins(hook);
  if (!allowed.length) return true;
  const host = origin ? siteHost(origin) : '';
  return !!host && allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

// ─── Payload detection ───────────────────────────────────────────────────────

export type InboundEvent = Record<string, unknown> & { event: string; email: string };

export interface Detected {
  source: string;
  events: InboundEvent[];
  /** Handshake / test call from the platform (WooCommerce ping, empty test): answer 200, do nothing. */
  ping?: boolean;
  /** Why nothing was done (shown in « Dernier appel reçu »). */
  reason?: 'ignored_status';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? parseMoney(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** « Adresse e-mail », « Prénom », « first-name » → `adresse_e_mail`, `prenom`, `first_name`. */
export function keyOf(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Lists of purchased items: their prices and names must not be read as the customer's. */
const ITEM_LISTS = /^(line_items|items|products|purchased_items|cart_items|order_items|lines|produits|articles)$/;
const LABEL_KEYS = ['label', 'title', 'question', 'field', 'name', 'key'];
const VALUE_KEYS = ['value', 'answer', 'raw_value'];

/** `{ title: 'Email', value: 'a@b.fr', type: 'email' }` (Elementor, Wix, many builders) → `email`, value. */
function labelled(o: Obj, fallback: string): [string, unknown] | undefined {
  const valueKey = VALUE_KEYS.find((k) => k in o && (typeof o[k] === 'string' || typeof o[k] === 'number' || typeof o[k] === 'boolean'));
  if (!valueKey) return undefined;
  const type = str(o.type)?.toLowerCase();
  if (type === 'email') return ['email', o[valueKey]];
  if (type === 'tel' || type === 'phone') return ['phone', o[valueKey]];
  const labelKey = LABEL_KEYS.find((k) => typeof o[k] === 'string' && o[k] !== o[valueKey]);
  const key = keyOf(labelKey ? String(o[labelKey]) : '') || fallback;
  return key ? [key, o[valueKey]] : undefined;
}

/** Every leaf of a nested payload as `key → value` (last key segment wins; first value kept). */
function leaves(value: unknown, out: Map<string, unknown> = new Map(), depth = 0, key = ''): Map<string, unknown> {
  if (depth > 6 || ITEM_LISTS.test(key)) return out;
  if (Array.isArray(value)) {
    value.slice(0, 50).forEach((v) => leaves(v, out, depth + 1, key));
  } else if (isObj(value)) {
    const pair = labelled(value, key);
    if (pair) {
      if (!out.has(pair[0])) out.set(pair[0], pair[1]);
      return out;
    }
    for (const [k, v] of Object.entries(value)) {
      // `total: { amount: '25.90' }` → `total_amount`, so a subtotal's amount is not taken for the total.
      const child = keyOf(k);
      leaves(v, out, depth + 1, key && /^(amount|value|price|formatted_?amount|formatted)$/.test(child) ? `${key}_${child}` : child);
    }
  } else if (key && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && !out.has(key)) {
    out.set(key, value);
  }
  return out;
}

/** Form posts flatten nested fields: `fields[email][value]=…` → `{ fields: { email: { value: … } } }`. */
function unflatten(obj: Obj): Obj {
  if (!Object.keys(obj).some((k) => /\[[^\]]*\]/.test(k))) return obj;
  const out: Obj = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = k.replace(/\]/g, '').split('[').filter((p) => p !== '');
    if (!path.length || path.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let node = out;
    path.slice(0, -1).forEach((p) => {
      if (!isObj(node[p])) node[p] = {};
      node = node[p] as Obj;
    });
    const last = path[path.length - 1]!;
    if (node[last] === undefined) node[last] = v;
  }
  return out;
}

const FULL_NAME = /^(name|full_?name|your_?name|nom_complet|nom_et_prenom|nom_prenom|prenom_nom|prenom_et_nom|votre_nom|customer_name|contact_name|display_name)$/;
const FIRST_NAME = /(^|_)(first_?name|firstname|name_first|prenom|given_?name|fname|vorname)($|_)|^first$/;
const LAST_NAME = /^(nom|last|last_?name|lastname|name_last|surname|family_?name|lname|nom_de_famille|nachname|votre_nom_de_famille)$|(^|_)(last_?name|name_last|nom_de_famille)$/;
const PHONE = /(phone|telephone|^tel$|^tel_|mobile|portable|gsm|whatsapp)/;
const EMAIL_KEY = /(e_?mail|courriel|mail_address)/;
const ID_KEY = /^(order_?id|order_?number|id_commande|numero_commande|commande_id|booking_?id|reservation_?id|reference|ref|number|id)$/;
const TOTAL_KEY = /^(total|grand_?total|order_?total|total_?price|total_?amount|amount_?total|prix_total|montant_total|total_ttc|montant_ttc)$/;
/** Weaker money labels: used only when no real total is present. */
const PRICE_KEY = /^(amount|montant|price|prix|payment|paiement)$|^(price|amount)_(amount|value)$/;
/** Emails that belong to someone else than the customer (the shop, a referrer, a host…). */
const OTHER_EMAIL = /(seller|vendor|vendeur|merchant|marchand|host|owner|admin|friend|ami|parrain|referr|sponsor|conseiller|guest|invite|user|recipient|destinataire|notify|notification|reply_?to|cc|bcc)/;
const STRONG_EMAIL = /^(email|e_mail|mail|courriel|customer_?email|client_?email|billing_?email|buyer_?email|contact_?email|your_?email|votre_?email|adresse_?e?_?mail|email_?address|adresse_email|votre_adresse_e?_?mail)$/;
/** Dates that are not the booking: birthdays, timestamps of the submission itself. */
const OTHER_DATE = /(naissance|birth|dob|anniversaire|created|submitted|sent|updated|envoi|soumis)/;
const PHONE_LIKE = /^\+\d[\d\s().-]{7,}$|^0[1-9]([\s.-]?\d{2}){4}$/;
const DATE_KEY = /(^|_)(date|start|start_?time|rdv|rendez_vous|appointment|booking_?time|creneau|heure|time)(_|$)/;
/** Platform plumbing that should not end up in the contact's event data. */
const NOISE = /^(form_?id|site_?id|page_?id|submission_?id|response_?id|event_?id|webhook_?id|created_?at|submitted_?at|updated_?at|hidden|token|signature|secret|_hp|_t|g_recaptcha_response|h_captcha_response)$/;

/** « 24/12/2026 19:30 » (French forms) is Paris time; ISO dates are kept as sent. */
export function parseDate(value: string): string | undefined {
  const fr = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,à]+(\d{1,2})[:hH](\d{2})?)?$/);
  if (fr) {
    const [d, m, y, h, min] = [Number(fr[1]), Number(fr[2]), Number(fr[3]), Number(fr[4] ?? 0), Number(fr[5] ?? 0)];
    if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return undefined;
    return new Date(parisToUtc(y, m, d, h, min)).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return value;
  return undefined;
}

/** The customer's address among all the emails of a payload (the shop's or a referrer's are skipped). */
function pickEmail(fields: Map<string, unknown>): [string, string] | undefined {
  let labelled: [string, string] | undefined;
  let any: [string, string] | undefined;
  for (const [k, v] of fields) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || !isValidEmail(s.toLowerCase())) continue;
    if (STRONG_EMAIL.test(k)) return [k, s];
    if (OTHER_EMAIL.test(k)) continue;
    if (!labelled && EMAIL_KEY.test(k)) labelled = [k, s];
    else if (!any) any = [k, s];
  }
  return labelled ?? any;
}

/** Fields → Pingsell identity + the rest as event data. */
function fromFields(fields: Map<string, unknown>) {
  const picked = pickEmail(fields);
  const email = picked?.[1];
  let first: string | undefined;
  let last: string | undefined;
  let full: string | undefined;
  let phone: string | undefined;
  let id: string | undefined;
  let total: number | undefined;
  let price: number | undefined;
  let date: string | undefined;
  const data: Obj = {};
  for (const [k, v] of fields) {
    const s = str(v);
    if (!s || k === picked?.[0]) continue;
    if (NOISE.test(k) || /(^|_)(created|submitted|updated)(_|$)/.test(k)) continue;
    if (!full && FULL_NAME.test(k)) full = s;
    else if (!first && FIRST_NAME.test(k)) first = s;
    else if (!last && LAST_NAME.test(k)) last = s;
    else if (!phone && PHONE.test(k)) phone = s;
    else if (!id && ID_KEY.test(k) && !PHONE_LIKE.test(s)) id = s;
    else if (total === undefined && TOTAL_KEY.test(k) && num(v) !== undefined) total = num(v);
    else if (price === undefined && PRICE_KEY.test(k) && num(v) !== undefined) price = num(v);
    else if (!date && DATE_KEY.test(k) && !OTHER_DATE.test(k) && parseDate(s)) date = parseDate(s);
    else if (Object.keys(data).length < 30) data[k.slice(0, 64)] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  // A single « Nom » field holding « Marie Dupont » is a full name.
  if (!full && !first && last && /\s/.test(last)) [full, last] = [last, undefined];
  if (full && !first && !last) {
    const parts = full.split(/\s+/);
    first = parts.shift();
    last = parts.join(' ') || undefined;
  }
  return { email, first_name: first, last_name: last, phone, id, total: total ?? price, date, data };
}

function person(first?: unknown, last?: unknown, full?: unknown) {
  const f = str(first);
  const l = str(last);
  if (f || l) return { first_name: f, last_name: l };
  const parts = (str(full) ?? '').split(/\s+/).filter(Boolean);
  return parts.length ? { first_name: parts.shift(), last_name: parts.join(' ') || undefined } : {};
}

// ─── WooCommerce (Réglages › Avancé › Webhooks) ──────────────────────────────

function wooItems(lines: unknown) {
  return Array.isArray(lines)
    ? lines
        .filter(isObj)
        .slice(0, 50)
        .map((l) => ({ title: (str(l.name) ?? 'Article').slice(0, 200), quantity: Math.max(1, Math.round(num(l.quantity) ?? 1)), price: num(l.price) ?? 0 }))
    : undefined;
}

/** Shipment Tracking plugin (and similar) keep the tracking number in the order's meta data. */
function wooTracking(meta: unknown) {
  if (!Array.isArray(meta)) return {};
  for (const m of meta.filter(isObj)) {
    if (m.key === '_wc_shipment_tracking_items' && Array.isArray(m.value) && isObj(m.value[0])) {
      const t = m.value[0];
      return { tracking_number: str(t.tracking_number), carrier: str(t.tracking_provider) ?? str(t.custom_tracking_provider), tracking_url: str(t.custom_tracking_link) };
    }
  }
  return {};
}

function detectWoo(topic: string, body: Obj): Detected {
  const source = 'woocommerce';
  if (!topic || topic.startsWith('action.')) return { source, events: [], ping: true };
  const billing = isObj(body.billing) ? body.billing : {};
  if (topic.startsWith('customer.')) {
    const email = str(body.email) ?? str(billing.email);
    if (!email) return { source, events: [], ping: true };
    return { source, events: [{ event: 'inscription', email, ...person(body.first_name ?? billing.first_name, body.last_name ?? billing.last_name), phone: str(billing.phone) }] };
  }
  if (!topic.startsWith('order.')) return { source, events: [], ping: true };
  const email = str(billing.email);
  if (!email) return { source, events: [], ping: true };
  const id = str(body.number) ?? str(body.id);
  const base = {
    email,
    ...person(billing.first_name, billing.last_name),
    phone: str(billing.phone),
    id,
    total: num(body.total),
    currency: str(body.currency),
    items: wooItems(body.line_items),
  };
  const status = str(body.status) ?? 'pending';
  if (['pending', 'failed', 'checkout-draft'].includes(status)) {
    const url = str(body.payment_url);
    return { source, events: [{ event: 'panier', ...base, url: url && /^https?:\/\//.test(url) ? url : undefined }] };
  }
  if (['processing', 'on-hold'].includes(status)) return { source, events: [{ event: 'commande', ...base }] };
  // A completed order is also an order: sent first so the shipment finds its customer (deduplicated by id).
  if (status === 'completed') return { source, events: [{ event: 'commande', ...base }, { event: 'expedition', email, id, ...wooTracking(body.meta_data) }] };
  // cancelled, refunded…: nothing to send.
  return { source, events: [], reason: 'ignored_status' };
}

/** Webflow sends amounts in the currency's smallest unit (ISO 4217 decimals). */
const ZERO_DECIMALS = /^(JPY|KRW|VND|CLP|ISK|XAF|XOF|XPF|PYG|UGX|RWF|KMF|GNF|DJF|BIF|VUV)$/i;
const THREE_DECIMALS = /^(KWD|BHD|OMR|JOD|TND|IQD|LYD)$/i;

// ─── Webflow (Site settings › Apps & integrations › Webhooks) ────────────────

function detectWebflow(body: Obj): Detected {
  const source = 'webflow';
  const type = str(body.triggerType) ?? '';
  const payload = isObj(body.payload) ? body.payload : body;
  if (type === 'ecomm_new_order' || type === 'ecomm_order_changed') {
    const customer = isObj(payload.customerInfo) ? payload.customerInfo : {};
    const email = str(customer.email);
    if (!email) return { source, events: [], ping: true };
    const totals = isObj(payload.totals) && isObj(payload.totals.total) ? payload.totals.total : {};
    const minor = num(totals.value);
    const decimals = ZERO_DECIMALS.test(str(totals.unit) ?? '') ? 0 : THREE_DECIMALS.test(str(totals.unit) ?? '') ? 3 : 2;
    const id = str(payload.orderId);
    const items = Array.isArray(payload.purchasedItems)
      ? payload.purchasedItems.filter(isObj).slice(0, 50).map((i) => ({ title: (str(i.productName) ?? 'Article').slice(0, 200), quantity: Math.max(1, Math.round(num(i.count) ?? 1)) }))
      : undefined;
    const order = { event: 'commande', email, ...person(undefined, undefined, customer.fullName), id, total: minor === undefined ? undefined : minor / 10 ** decimals, currency: str(totals.unit), items };
    if (type === 'ecomm_order_changed') {
      if (str(payload.status) !== 'fulfilled') return { source, events: [], reason: 'ignored_status' };
      return { source, events: [order, { event: 'expedition', email, id, tracking_number: str(payload.shippingTracking), tracking_url: str(payload.shippingTrackingURL), carrier: str(payload.shippingProvider) }] };
    }
    return { source, events: [order] };
  }
  // form_submission (API v2) or the v1 shape { name, data }.
  const data = isObj(payload.data) ? payload.data : payload;
  return generic(source, data);
}

// ─── Tally, Typeform ─────────────────────────────────────────────────────────

function detectTally(body: Obj): Detected {
  const fields = new Map<string, unknown>();
  const list = isObj(body.data) && Array.isArray(body.data.fields) ? body.data.fields.filter(isObj) : [];
  for (const f of list) {
    let value = f.value;
    // Choices come as option ids: show their text instead.
    if (Array.isArray(value) && Array.isArray(f.options)) {
      const options = f.options.filter(isObj);
      value = value.map((id) => str(options.find((o) => o.id === id)?.text) ?? str(id)).filter(Boolean).join(', ');
    }
    const key = keyOf(str(f.label) ?? str(f.key) ?? '') || keyOf(str(f.type) ?? '');
    if (f.type === 'INPUT_EMAIL' && !fields.has('email')) fields.set('email', value);
    else if (f.type === 'INPUT_PHONE_NUMBER' && !fields.has('phone')) fields.set('phone', value);
    else if (f.type === 'PAYMENT' && !fields.has('total')) fields.set('total', isObj(value) ? (value.price ?? value.amount) : value);
    else if (key && !fields.has(key)) fields.set(key, value);
  }
  return generic('tally', fields);
}

function detectTypeform(body: Obj): Detected {
  const response = isObj(body.form_response) ? body.form_response : {};
  const defs = isObj(response.definition) && Array.isArray(response.definition.fields) ? response.definition.fields.filter(isObj) : [];
  // Group questions keep their sub-questions in `properties.fields`.
  const titles = new Map<string | undefined, string | undefined>();
  const index = (list: Obj[], depth = 0) => {
    for (const d of list) {
      titles.set(str(d.id), str(d.title));
      const sub = isObj(d.properties) && Array.isArray(d.properties.fields) ? d.properties.fields.filter(isObj) : [];
      if (sub.length && depth < 3) index(sub, depth + 1);
    }
  };
  index(defs);
  const fields = new Map<string, unknown>();
  for (const a of Array.isArray(response.answers) ? response.answers.filter(isObj) : []) {
    const field = isObj(a.field) ? a.field : {};
    const type = str(a.type) ?? '';
    const value =
      type === 'choice' && isObj(a.choice)
        ? a.choice.label
        : type === 'choices' && isObj(a.choices) && Array.isArray(a.choices.labels)
          ? a.choices.labels.join(', ')
          : a[type];
    if (type === 'email' && !fields.has('email')) fields.set('email', value);
    else if (type === 'phone_number' && !fields.has('phone')) fields.set('phone', value);
    else {
      // A ref like `first_name` says more than a title like « Comment vous appelez-vous ? ».
      const ref = keyOf(str(field.ref) ?? '');
      const identity = [FULL_NAME, FIRST_NAME, LAST_NAME, PHONE, EMAIL_KEY].some((r) => r.test(ref));
      const key = identity ? ref : keyOf(titles.get(str(field.id)) ?? str(field.ref) ?? type);
      if (key && !fields.has(key)) fields.set(key, value);
    }
  }
  if (isObj(response.hidden)) for (const [k, v] of Object.entries(response.hidden)) if (!fields.has(keyOf(k))) fields.set(keyOf(k), v);
  return generic('typeform', fields);
}

// ─── Calendly (webhook subscriptions, API) ─────────────────────────────────

function detectCalendly(body: Obj): Detected {
  const source = 'calendly';
  const p = isObj(body.payload) ? body.payload : {};
  const email = str(p.email);
  if (!email) return { source, events: [], ping: true };
  const scheduled = isObj(p.scheduled_event) ? p.scheduled_event : {};
  const answers = Array.isArray(p.questions_and_answers) ? p.questions_and_answers.filter(isObj) : [];
  const phoneAnswer = answers.find((a) => PHONE.test(keyOf(str(a.question) ?? '')));
  const data: Obj = {};
  for (const a of answers.slice(0, 20)) {
    const k = keyOf(str(a.question) ?? '');
    if (k && a !== phoneAnswer) data[k.slice(0, 64)] = (str(a.answer) ?? '').slice(0, 500);
  }
  if (str(scheduled.name)) data.type = str(scheduled.name);
  return {
    source,
    events: [
      {
        event: '',
        email,
        ...person(p.first_name, p.last_name, p.name),
        phone: str(p.text_reminder_number) ?? str(phoneAnswer?.answer),
        id: str(scheduled.uri) ?? str(p.event) ?? str(p.uri),
        date: str(scheduled.start_time),
        status: body.event === 'invitee.canceled' ? 'cancelled' : undefined,
        url: str(p.reschedule_url),
        data: Object.keys(data).length ? data : undefined,
      },
    ],
  };
}

// ─── Jotform (Paramètres › Intégrations › Webhooks: multipart with `rawRequest`) ─

function detectJotform(body: Obj): Detected {
  let raw: unknown;
  try {
    raw = typeof body.rawRequest === 'string' ? JSON.parse(body.rawRequest) : body.rawRequest;
  } catch {
    raw = undefined;
  }
  const fields = new Map<string, unknown>();
  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const m = k.match(/^q\d+_(.+)$/);
      if (!m) continue;
      const key = keyOf(m[1]!);
      if (isObj(v)) {
        if ('first' in v || 'last' in v) {
          fields.set('first_name', v.first);
          fields.set('last_name', v.last);
        } else if ('full' in v) fields.set(PHONE.test(key) ? 'phone' : key, v.full);
        else if ('datetime' in v || 'date' in v) fields.set(key, v.datetime ?? v.date);
        else if ('year' in v && 'month' in v && 'day' in v) {
          const pad = (x: unknown) => String(x ?? '').padStart(2, '0');
          fields.set(key, `${v.year}-${pad(v.month)}-${pad(v.day)}` + (v.hour !== undefined ? `T${pad(v.hour)}:${pad(v.min ?? v.minute ?? 0)}` : ''));
        }
        else fields.set(key, Object.values(v).filter((x) => typeof x === 'string' && x).join(' '));
      } else if (!fields.has(key)) fields.set(key, Array.isArray(v) ? v.join(', ') : v);
    }
  }
  return generic('jotform', fields);
}

/** Elementor Pro « Webhook » action adds its own metadata next to the visitor's answers. */
const ELEMENTOR_META = ['date', 'time', 'page_url', 'user_agent', 'remote_ip', 'powered_by', 'form_id', 'form_name'];

// ─── Anything else: Framer, Wix, Squarespace, Carrd, Elementor, Jotform… ─────

function generic(source: string, payload: Obj | Map<string, unknown>): Detected {
  let tree = payload instanceof Map ? undefined : unflatten(payload);
  // Elementor « advanced data »: the answers are under `fields`, next to `form` and `meta`.
  if (tree && isObj(tree.fields) && (isObj(tree.form) || isObj(tree.meta))) {
    tree = tree.fields;
    if (source === 'webhook') source = 'elementor';
  }
  const fields = payload instanceof Map ? payload : leaves(tree);
  if (fields.has('powered_by') || fields.has('remote_ip')) {
    source = source === 'webhook' ? 'elementor' : source;
    for (const k of ELEMENTOR_META) fields.delete(k);
  }
  const found = fromFields(fields);
  if (!found.email) return { source, events: [], ping: !fields.size };
  const { data, ...rest } = found;
  return { source, events: [{ event: '', ...rest, email: found.email, data: Object.keys(data).length ? data : undefined }] };
}

/** Recognises who is calling from headers and body shape. `event` (query or body) names what happened. */
export function detectPayload(headers: Record<string, string | string[] | undefined>, body: unknown, query: { event?: string; tags?: string }): Detected {
  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const obj: Obj = isObj(body) ? body : {};
  let detected: Detected;
  const wooTopic = header('x-wc-webhook-topic');
  if (wooTopic !== undefined || (Object.keys(obj).length === 1 && 'webhook_id' in obj)) {
    detected = detectWoo(wooTopic ?? '', obj);
  } else if (typeof obj.event === 'string' && obj.event.startsWith('invitee.') && isObj(obj.payload)) {
    detected = detectCalendly(obj);
  } else if ('rawRequest' in obj && ('submissionID' in obj || 'formID' in obj)) {
    detected = detectJotform(obj);
  } else if (typeof obj.event === 'string' && typeof obj.email === 'string') {
    // Already a Pingsell event (the WordPress / PrestaShop extensions, custom code).
    detected = { source: str(header('x-pingsell-source'))?.slice(0, 40) ?? 'webhook', events: [obj as InboundEvent] };
  } else if (typeof obj.triggerType === 'string' || (isObj(obj.payload) && 'siteId' in obj.payload) || (typeof obj.site === 'string' && isObj(obj.data) && 'd' in obj)) {
    detected = detectWebflow(obj);
  } else if (obj.eventType === 'FORM_RESPONSE' && isObj(obj.data)) {
    detected = detectTally(obj);
  } else if (isObj(obj.form_response)) {
    detected = detectTypeform(obj);
  } else {
    const ua = header('user-agent') ?? '';
    const source = header('framer-webhook-submission-id') || /framer/i.test(ua) ? 'framer' : /wix/i.test(ua) || 'instance' in obj ? 'wix' : 'webhook';
    detected = generic(source, obj);
  }
  // `?event=reservation` on the URL names the moment for forms that can't send it; `?tags=vip,salon` adds tags.
  const queryTags = (query.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
  for (const e of detected.events) {
    if (!e.event) e.event = query.event?.trim() || (detected.source === 'calendly' ? 'reservation' : 'inscription');
    if (queryTags.length) e.tags = [...new Set([...(Array.isArray(e.tags) ? (e.tags as string[]) : []), ...queryTags])];
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  }
  return detected;
}

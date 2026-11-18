import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync } from '../db.js';
import { normalizeEmail, isValidEmail } from './contacts.js';
import { hookOrigins, siteHost, type InboundHook } from './inbound.js';
import { firePageVisited, startOnce } from './automations.js';

/**
 * Site tracking: the same one-line script as the paste-in form records pages and products seen, then ties
 * them to the contact once known (Pingsell email click, any form with an email, Pingsell.identify).
 * Feeds two triggers: « Page visitée » and « Produit consulté sans achat ».
 */

export interface TrackingSettings {
  account_id: string;
  secret: string;
  enabled: number;
  require_consent: number;
  site_hosts: string;
  pageviews: number;
  last_seen_at: string | null;
  last_url: string | null;
}

export function ensureTracking(db: DatabaseSync, accountId: string): TrackingSettings {
  const existing = get<TrackingSettings>(db, 'SELECT * FROM web_tracking WHERE account_id = ?', accountId);
  if (existing) return existing;
  run(
    db,
    'INSERT OR IGNORE INTO web_tracking (account_id, secret, created_at) VALUES (?, ?, ?)',
    accountId,
    randomBytes(24).toString('base64url'),
    now(),
  );
  return get<TrackingSettings>(db, 'SELECT * FROM web_tracking WHERE account_id = ?', accountId)!;
}

/* ------------------------------------------------------------------ signed link from Pingsell emails */

const sign = (secret: string, contactId: string) => createHmac('sha256', secret).update(`ps:${contactId}`).digest('base64url').slice(0, 22);

/** `ps_t` added to links towards the merchant's own site: the click identifies the visitor, no form needed. */
export function contactToken(secret: string, contactId: string): string {
  return `${contactId}.${sign(secret, contactId)}`;
}

export function verifyContactToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 120) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const contactId = token.slice(0, dot);
  const expected = Buffer.from(sign(secret, contactId));
  const given = Buffer.from(token.slice(dot + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? contactId : null;
}

/** The merchant's own sites: allowed domains, or the hosts where the script already runs. */
export function siteHosts(db: DatabaseSync, accountId: string): string[] {
  const tracking = get<{ site_hosts: string }>(db, 'SELECT site_hosts FROM web_tracking WHERE account_id = ?', accountId);
  const hook = get<InboundHook>(db, "SELECT * FROM inbound_hooks WHERE account_id = ? AND kind = 'form'", accountId);
  const allowed = hook ? hookOrigins(hook) : [];
  return allowed.length ? allowed : parseJson<string[]>(tracking?.site_hosts, []);
}

const onSite = (host: string, sites: string[]) => !!host && sites.some((d) => host === d || host.endsWith(`.${d}`));

/** Adds the signed visitor token to a link if it points to the merchant's site (never to third parties). */
export function decorateLink(db: DatabaseSync, accountId: string, contactId: string | null, target: string): string {
  if (!contactId) return target;
  const tracking = get<{ secret: string; enabled: number }>(db, 'SELECT secret, enabled FROM web_tracking WHERE account_id = ?', accountId);
  if (!tracking?.enabled) return target;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target;
  }
  if (!onSite(siteHost(url.href), siteHosts(db, accountId))) return target;
  url.searchParams.set('ps_t', contactToken(tracking.secret, contactId));
  return url.href;
}

/* ------------------------------------------------------------------ incoming hits */

export interface Product {
  name: string;
  url: string;
  image?: string;
  price?: number;
  currency?: string;
  sku?: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const httpUrl = (v: unknown, max = 1000) => {
  const s = text(v, max);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
};

/** Keeps only a clean product: its link must stay on the page's own site. */
export function cleanProduct(raw: unknown, pageUrl: string): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const name = text(p.name, 200);
  const given = httpUrl(p.url);
  const url = given ? cleanPageUrl(given) : pageUrl;
  if (!name || siteHost(url) !== siteHost(pageUrl)) return null;
  const price = Number(p.price);
  const currency = text(p.currency, 3)?.toUpperCase();
  return {
    name,
    url,
    ...(httpUrl(p.image) ? { image: httpUrl(p.image) } : {}),
    ...(Number.isFinite(price) && price >= 0 && p.price !== '' && p.price != null ? { price } : {}),
    ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(text(p.sku, 100) ? { sku: text(p.sku, 100) } : {}),
  };
}

export const VID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const PRIVATE_PARAM = /mail|pass|pwd|token|secret|key|tel|phone|nom|name|address|adresse|ps_t/i;
/** Page addresses are kept without personal data (an email typed in a GET form, a reset token…). */
export function cleanPageUrl(href: string): string {
  const url = new URL(href);
  for (const [k, v] of [...url.searchParams]) if (PRIVATE_PARAM.test(k) || v.includes('@')) url.searchParams.delete(k);
  url.hash = '';
  return url.href;
}

function touchVisitor(db: DatabaseSync, accountId: string, vid: string, ts: string, views: number) {
  run(
    db,
    `INSERT INTO web_visitors (account_id, vid, pageviews, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, vid) DO UPDATE SET pageviews = pageviews + excluded.pageviews, last_seen = excluded.last_seen`,
    accountId,
    vid,
    views,
    ts,
    ts,
  );
  return get<{ contact_id: string | null }>(db, 'SELECT contact_id FROM web_visitors WHERE account_id = ? AND vid = ?', accountId, vid)!;
}

/** Remembers the host the script runs on (signed links go only there when no allowed domain is set). */
function learnHost(db: DatabaseSync, accountId: string, host: string, url: string, ts: string) {
  const row = ensureTracking(db, accountId);
  const hosts = parseJson<string[]>(row.site_hosts, []);
  const fresh = host && !hosts.includes(host) && hosts.length < 10 && host.includes('.') && !/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host);
  run(
    db,
    'UPDATE web_tracking SET pageviews = pageviews + 1, last_seen_at = ?, last_url = ?, site_hosts = ? WHERE account_id = ?',
    ts,
    url.slice(0, 500),
    JSON.stringify(fresh ? [...hosts, host] : hosts),
    accountId,
  );
}

export function recordPageview(
  db: DatabaseSync,
  accountId: string,
  input: { vid: string; url: string; title?: string; referrer?: string; product?: Product | null },
): { contactId: string | null; duplicate: boolean } {
  return transaction(db, () => {
    const ts = now();
    const url = new URL(input.url);
    const path = url.pathname.slice(0, 500) || '/';
    // A reload or a double send within 30 s counts once.
    const recent = scalar(
      db,
      'SELECT COUNT(*) FROM web_pageviews WHERE account_id = ? AND vid = ? AND url = ? AND created_at > ?',
      accountId,
      input.vid,
      url.href,
      new Date(Date.now() - 30_000).toISOString(),
    );
    const visitor = touchVisitor(db, accountId, input.vid, ts, recent ? 0 : 1);
    if (recent) return { contactId: visitor.contact_id, duplicate: true };
    run(
      db,
      'INSERT INTO web_pageviews (id, account_id, vid, contact_id, url, path, title, referrer, product, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      accountId,
      input.vid,
      visitor.contact_id,
      url.href.slice(0, 1000),
      path,
      input.title?.slice(0, 300) ?? null,
      input.referrer?.slice(0, 500) ?? null,
      input.product ? JSON.stringify(input.product) : null,
      ts,
    );
    learnHost(db, accountId, siteHost(url.href), url.href, ts);
    if (visitor.contact_id) {
      run(db, 'UPDATE contacts SET last_seen_at = ? WHERE id = ?', ts, visitor.contact_id);
      firePageVisited(db, accountId, visitor.contact_id, {
        url: url.href,
        path,
        title: input.title ?? '',
        ...(input.product ? { product: input.product.name } : {}),
      });
    }
    return { contactId: visitor.contact_id, duplicate: false };
  });
}

/**
 * Ties a visitor (and all the pages they saw so far) to a contact.
 * A signed email link always wins; an email typed in a form never takes over a visitor already known.
 */
export function linkVisitor(
  db: DatabaseSync,
  accountId: string,
  vid: string,
  contactId: string,
  by: 'email_link' | 'form' | 'identify',
): boolean {
  return transaction(db, () => {
    const contact = get<{ id: string }>(db, 'SELECT id FROM contacts WHERE id = ? AND account_id = ?', contactId, accountId);
    if (!contact) return false;
    const ts = now();
    const visitor = touchVisitor(db, accountId, vid, ts, 0);
    if (visitor.contact_id === contactId) return true;
    if (visitor.contact_id && by !== 'email_link') return false;
    run(db, 'UPDATE web_visitors SET contact_id = ?, identified_by = ? WHERE account_id = ? AND vid = ?', contactId, by, accountId, vid);
    run(db, 'UPDATE web_pageviews SET contact_id = ? WHERE account_id = ? AND vid = ?', contactId, accountId, vid);
    const last = get<{ at: string | null }>(db, 'SELECT MAX(created_at) AS at FROM web_pageviews WHERE contact_id = ?', contactId);
    if (last?.at) run(db, 'UPDATE contacts SET last_seen_at = MAX(COALESCE(last_seen_at, ?), ?) WHERE id = ?', last.at, last.at, contactId);
    return true;
  });
}

/** Email typed on the site: links to an existing contact only (browsing never creates a contact on its own). */
export function linkVisitorByEmail(db: DatabaseSync, accountId: string, vid: string, email: unknown, by: 'form' | 'identify'): boolean {
  if (typeof email !== 'string' || !isValidEmail(email)) return false;
  const contact = get<{ id: string }>(db, 'SELECT id FROM contacts WHERE account_id = ? AND email = ?', accountId, normalizeEmail(email));
  return contact ? linkVisitor(db, accountId, vid, contact.id, by) : false;
}

/* ------------------------------------------------------------------ contact view */

export function contactVisits(db: DatabaseSync, accountId: string, contactId: string, limit = 50) {
  const rows = all<{ url: string; path: string; title: string | null; product: string | null; created_at: string }>(
    db,
    'SELECT url, path, title, product, created_at FROM web_pageviews WHERE account_id = ? AND contact_id = ? ORDER BY created_at DESC LIMIT ?',
    accountId,
    contactId,
    limit,
  );
  return {
    total: scalar(db, 'SELECT COUNT(*) FROM web_pageviews WHERE account_id = ? AND contact_id = ?', accountId, contactId),
    visits: rows.map((r) => ({ url: r.url, path: r.path, title: r.title, product: parseJson<Product | null>(r.product, null), created_at: r.created_at })),
  };
}

/* ------------------------------------------------------------------ browse abandonment (worker) */

/**
 * « Produit consulté sans achat »: a known, subscribed contact viewed a product, then nothing (no order,
 * no cart) for `hours`. Their latest product starts the journey, at most once every 3 days per automation,
 * and never twice for the same product within 30 days.
 */
export function processBrowseAbandonment(db: DatabaseSync, nowMs = Date.now()): number {
  const automations = all<{ id: string; account_id: string; trigger_config: string }>(
    db,
    "SELECT id, account_id, trigger_config FROM automations WHERE status = 'active' AND trigger = 'product_viewed'",
  );
  let started = 0;
  for (const a of automations) {
    const hours = Math.min(Math.max(Number(parseJson<{ hours?: number }>(a.trigger_config, {}).hours ?? 2), 0.25), 168);
    const until = new Date(nowMs - hours * 3_600_000).toISOString();
    const from = new Date(nowMs - hours * 3_600_000 - 2 * 86_400_000).toISOString();
    const rows = all<{ contact_id: string; product: string; url: string; created_at: string; email: string; status: string }>(
      db,
      `SELECT p.contact_id, p.product, p.url, p.created_at, c.email, c.status
         FROM web_pageviews p JOIN contacts c ON c.id = p.contact_id
        WHERE p.account_id = ? AND p.product IS NOT NULL AND p.contact_id IS NOT NULL AND p.created_at > ? AND p.created_at <= ?
        ORDER BY p.created_at DESC`,
      a.account_id,
      from,
      until,
    );
    const done = new Set<string>();
    for (const row of rows) {
      if (done.has(row.contact_id)) continue;
      done.add(row.contact_id);
      if (row.status !== 'subscribed') continue;
      transaction(db, () => {
        const since = row.created_at;
        // Still browsing, bought or started a cart since: not abandoned (the cart journey takes over).
        if (scalar(db, 'SELECT COUNT(*) FROM web_pageviews WHERE contact_id = ? AND product IS NOT NULL AND created_at > ?', row.contact_id, since) > 0) return;
        if (scalar(db, "SELECT COUNT(*) FROM events WHERE contact_id = ? AND type = 'order' AND created_at > ?", row.contact_id, since) > 0) return;
        if (scalar(db, 'SELECT COUNT(*) FROM api_carts WHERE account_id = ? AND email = ? AND updated_at > ?', a.account_id, row.email, since) > 0) return;
        if (
          scalar(
            db,
            "SELECT COUNT(*) FROM automation_seen WHERE automation_id = ? AND contact_id = ? AND key LIKE 'browse:%' AND created_at > ?",
            a.id,
            row.contact_id,
            new Date(nowMs - 3 * 86_400_000).toISOString(),
          ) > 0
        )
          return;
        const product = parseJson<Product>(row.product, { name: '', url: row.url });
        const views = scalar(
          db,
          'SELECT COUNT(*) FROM web_pageviews WHERE contact_id = ? AND url = ? AND created_at > ?',
          row.contact_id,
          row.url,
          new Date(nowMs - 30 * 86_400_000).toISOString(),
        );
        const key = `browse:${(product.sku || new URL(product.url).pathname).slice(0, 200)}:${Math.floor(nowMs / (30 * 86_400_000))}`;
        if (
          startOnce(db, a.id, row.contact_id, key, {
            product: product.name,
            name: product.name,
            url: product.url,
            image: product.image ?? '',
            price: product.price ?? '',
            currency: product.currency ?? '',
            sku: product.sku ?? '',
            views,
            viewed_at: row.created_at,
          })
        )
          started++;
      });
    }
  }
  return started;
}

/** Anonymous visitors are forgotten after 90 days, browsing history after 13 months (CNIL guidance). */
export function purgeTracking(db: DatabaseSync, nowMs = Date.now()): void {
  run(db, 'DELETE FROM web_visitors WHERE contact_id IS NULL AND last_seen < ?', new Date(nowMs - 90 * 86_400_000).toISOString());
  run(db, 'DELETE FROM web_pageviews WHERE created_at < ?', new Date(nowMs - 395 * 86_400_000).toISOString());
}

let lastTrackingRun = 0;
/** Worker entry point: browse abandonment and clean-up, every few minutes. */
export function processTracking(db: DatabaseSync, nowMs = Date.now(), force = false): number {
  const every = Number(process.env.SCHEDULED_TRIGGERS_MS ?? 300_000);
  if (!force && nowMs - lastTrackingRun < every) return 0;
  lastTrackingRun = nowMs;
  const started = processBrowseAbandonment(db, nowMs);
  purgeTracking(db, nowMs);
  return started;
}

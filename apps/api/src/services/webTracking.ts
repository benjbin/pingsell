import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync } from '../db.js';
import { findContactByEmail, isValidEmail, normalizeEmail, recordEvent, upsertContact } from './contacts.js';
import { hookOrigins, siteHost, type InboundHook } from './inbound.js';
import { fireSiteAction, firePageVisited, startOnce, type SiteAction } from './automations.js';

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
  capture_actions: number;
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

/**
 * Un compte ne suit pas plus de sites que ça : au-delà, le site vu le moins récemment laisse sa place, mais
 * jamais un site nommé par le marchand ni un site actif (pages ou actions) depuis 30 jours. Sans place libre,
 * le nouveau domaine n'est pas appris (ses pages comptent quand même) : de fausses origines ne chassent pas les vrais sites.
 */
export const MAX_SITES = 50;

/**
 * Un domaine que « Vos sites » peut apprendre : jamais localhost, *.localhost ni une adresse IP en production
 * (même règle que les domaines appris pour les liens signés). En développement, tout est permis pour essayer.
 */
export function learnableHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  return host.includes('.') && !/(^|\.)localhost$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.startsWith('[') && !host.includes(':');
}

/** Chaque site est reconnu par son domaine dès sa première page vue ou action : rien à déclarer. */
function touchSite(db: DatabaseSync, accountId: string, host: string, ts: string, views: number) {
  if (!learnableHost(host)) return;
  const known = scalar(db, 'SELECT COUNT(*) FROM web_sites WHERE account_id = ? AND host = ?', accountId, host) > 0;
  if (!known && scalar(db, 'SELECT COUNT(*) FROM web_sites WHERE account_id = ?', accountId) >= MAX_SITES) {
    const recent = new Date(Date.parse(ts) - 30 * 86_400_000).toISOString();
    const old = get<{ host: string }>(
      db,
      `SELECT s.host FROM web_sites s
        WHERE s.account_id = ? AND s.name IS NULL AND s.last_seen < ?
          AND NOT EXISTS (SELECT 1 FROM web_actions a WHERE a.account_id = s.account_id AND a.host = s.host AND a.created_at >= ?)
        ORDER BY s.last_seen ASC, s.host LIMIT 1`,
      accountId,
      recent,
      recent,
    );
    if (!old) return;
    // Le site remplacé part avec ses actions repérées (ses pages vues restent).
    run(db, 'DELETE FROM web_sites WHERE account_id = ? AND host = ?', accountId, old.host);
    run(db, 'DELETE FROM web_actions WHERE account_id = ? AND host = ?', accountId, old.host);
  }
  run(
    db,
    `INSERT INTO web_sites (account_id, host, pageviews, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, host) DO UPDATE SET pageviews = pageviews + excluded.pageviews, last_seen = MAX(last_seen, excluded.last_seen)`,
    accountId,
    host,
    views,
    ts,
    ts,
  );
}

export function recordPageview(
  db: DatabaseSync,
  accountId: string,
  input: { vid: string; url: string; title?: string; referrer?: string; product?: Product | null },
  /** Faux quand la requête ne prouve pas venir de ce domaine (pas d'en-tête Origin/Referer du même site). */
  learnSite = true,
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
    const host = siteHost(url.href);
    run(
      db,
      'INSERT INTO web_pageviews (id, account_id, vid, contact_id, url, path, title, referrer, product, host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      accountId,
      input.vid,
      visitor.contact_id,
      url.href.slice(0, 1000),
      path,
      input.title?.slice(0, 300) ?? null,
      input.referrer?.slice(0, 500) ?? null,
      input.product ? JSON.stringify(input.product) : null,
      host || null,
      ts,
    );
    learnHost(db, accountId, host, url.href, ts);
    if (learnSite) touchSite(db, accountId, host, ts, 1);
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

/* ------------------------------------------------------------------ actions repérées sur le site */

export interface SiteActionInput {
  vid: string | null;
  kind: SiteAction;
  formKey: string;
  label: string | null;
  /** Adresse de la page du formulaire, déjà nettoyée (cleanPageUrl). */
  url: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  /** Faux quand la requête ne prouve pas venir de ce domaine : l'action compte, le site n'est pas appris. */
  learnSite?: boolean;
}

/** Seules une création de compte et une inscription à la newsletter ajoutent la personne aux contacts. */
export const CREATES_CONTACT: ReadonlySet<SiteAction> = new Set<SiteAction>(['signup', 'newsletter']);

const TOKEN_SEGMENT = (seg: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
  /^[0-9a-f]{16,}$/i.test(seg) ||
  (/^[A-Za-z0-9]{16,}$/.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg)) ||
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(seg);

/** « /reset/9f86d081884c7d65… » → « /reset/:id » : un jeton dans le chemin n'est jamais gardé. */
export function maskPath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      let raw = seg;
      try {
        raw = decodeURIComponent(seg);
      } catch {
        /* segment mal encodé : testé tel quel */
      }
      return TOKEN_SEGMENT(raw) ? ':id' : seg;
    })
    .join('/');
}

/** Même masque pour l'adresse complète : segments du chemin et valeurs de la requête (jeton, JWT, UUID…). */
export function maskUrl(href: string): string {
  const url = new URL(href);
  url.pathname = maskPath(url.pathname);
  for (const [k, v] of [...url.searchParams]) if (TOKEN_SEGMENT(v)) url.searchParams.set(k, ':id');
  return url.href;
}

/** Doublons d'une personne inconnue (aucun identifiant visiteur n'est gardé pour elle) : mémoire de 30 s seulement. */
const recentAnonymous = new Map<string, number>();
function anonymousDuplicate(key: string, nowMs: number): boolean {
  if (recentAnonymous.size > 10_000) for (const [k, at] of recentAnonymous) if (at < nowMs - 30_000) recentAnonymous.delete(k);
  const seen = recentAnonymous.get(key);
  recentAnonymous.set(key, nowMs);
  return seen !== undefined && seen > nowMs - 30_000;
}

/** form_key « /chemin#form2 » (dernier recours du script) : le chemin est masqué lui aussi. */
export function maskFormKey(formKey: string): string {
  const hash = formKey.indexOf('#');
  return hash > 0 ? maskPath(formKey.slice(0, hash)) + formKey.slice(hash) : formKey;
}

/**
 * Une action repérée par le script (création de compte, connexion, newsletter, contact, autre formulaire).
 * - signup / newsletter : la personne devient contact si elle ne l'est pas (abonnée, comme le formulaire public),
 *   SANS « Nouveau contact » : c'est « Une action sur votre site » qui souhaite la bienvenue (pas de double email).
 * - login / contact / form : ne créent jamais de contact. Email connu : visiteur rattaché, action enregistrée,
 *   automatisations démarrées. Email inconnu : l'action compte pour « Vos sites », sans contact, rien ne démarre.
 * Le même envoi reçu deux fois en 30 s (double clic, renvoi du navigateur) ne compte qu'une fois.
 */
export function recordSiteAction(
  db: DatabaseSync,
  accountId: string,
  input: SiteActionInput,
): { contactId: string | null; created: boolean; duplicate: boolean; started: number } {
  return transaction(db, () => {
    const ts = now();
    const url = new URL(maskUrl(input.url));
    const host = siteHost(url.href);
    const path = url.pathname.slice(0, 500) || '/';
    const formKey = maskFormKey(input.formKey).slice(0, 200);
    let contactId: string | null = null;
    let created = false;
    if (CREATES_CONTACT.has(input.kind)) {
      const r = upsertContact(db, accountId, {
        email: input.email,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone,
        source: 'api',
        fill_only: true,
      });
      contactId = r.contact.id;
      created = r.created;
      // Trace sur la fiche comme le formulaire public, mais sans démarrer « Nouveau contact ».
      if (created) recordEvent(db, accountId, contactId, 'contact_created', { source: r.contact.source });
    } else {
      contactId = findContactByEmail(db, accountId, input.email)?.id ?? null;
    }
    if (contactId && input.vid) linkVisitor(db, accountId, input.vid, contactId, 'form');
    const since = new Date(Date.now() - 30_000).toISOString();
    const recent = contactId
      ? scalar(
          db,
          'SELECT COUNT(*) FROM web_actions WHERE account_id = ? AND contact_id = ? AND kind = ? AND form_key = ? AND host = ? AND created_at > ?',
          accountId,
          contactId,
          input.kind,
          formKey,
          host,
          since,
        )
      : input.vid && anonymousDuplicate(`${accountId}:${input.vid}:${input.kind}:${host}:${formKey}`, Date.now())
        ? 1
        : 0;
    if (recent) return { contactId, created, duplicate: true, started: 0 };
    run(
      db,
      'INSERT INTO web_actions (id, account_id, host, vid, contact_id, kind, form_key, label, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      accountId,
      host,
      // Une action sans contact ne garde aucun identifiant visiteur : elle ne sert qu'au compteur.
      contactId ? input.vid : null,
      contactId,
      input.kind,
      formKey,
      input.label,
      path,
      ts,
    );
    if (input.learnSite !== false) touchSite(db, accountId, host, ts, 0);
    if (!contactId) return { contactId, created, duplicate: false, started: 0 };
    run(db, 'UPDATE contacts SET last_seen_at = MAX(COALESCE(last_seen_at, ?), ?) WHERE id = ?', ts, ts, contactId);
    const site = get<{ name: string | null }>(db, 'SELECT name FROM web_sites WHERE account_id = ? AND host = ?', accountId, host);
    const started = fireSiteAction(db, accountId, contactId, {
      action: input.kind,
      host,
      form_key: formKey,
      site: site?.name || host,
      page: url.href,
      form: input.label || formKey,
    });
    return { contactId, created, duplicate: false, started };
  });
}

/** « Retirer ce site » : le site et ses actions repérées disparaissent ; les pages vues restent sur les fiches. */
export function deleteSite(db: DatabaseSync, accountId: string, host: string): boolean {
  return transaction(db, () => {
    const removed = run(db, 'DELETE FROM web_sites WHERE account_id = ? AND host = ?', accountId, host);
    if (removed) run(db, 'DELETE FROM web_actions WHERE account_id = ? AND host = ?', accountId, host);
    return removed > 0;
  });
}

/** « Vos sites » : chaque domaine repéré, ce que Pingsell y a vu passer, et ses pages les plus vues (90 jours). */
export function listSites(db: DatabaseSync, accountId: string, nowMs = Date.now()) {
  const sites = all<{ host: string; name: string | null; pageviews: number; first_seen: string; last_seen: string }>(
    db,
    'SELECT host, name, pageviews, first_seen, last_seen FROM web_sites WHERE account_id = ? ORDER BY last_seen DESC LIMIT ?',
    accountId,
    MAX_SITES,
  );
  const since = new Date(nowMs - 90 * 86_400_000).toISOString();
  return sites.map((s) => ({
    host: s.host,
    name: s.name,
    pageviews: Number(s.pageviews),
    first_seen: s.first_seen,
    last_seen: s.last_seen,
    // Colonnes « nues » avec MAX() : SQLite reprend le libellé et la page de l'action la plus récente.
    actions: all<{ kind: string; form_key: string; label: string | null; path: string; n: number; last_at: string }>(
      db,
      `SELECT kind, form_key, label, path, COUNT(*) AS n, MAX(created_at) AS last_at
         FROM web_actions WHERE account_id = ? AND host = ?
        GROUP BY kind, form_key ORDER BY last_at DESC LIMIT 100`,
      accountId,
      s.host,
    ).map((a) => ({ kind: a.kind, form_key: a.form_key, label: a.label, path: a.path, count: Number(a.n), last_at: a.last_at })),
    pages: all<{ path: string; n: number }>(
      db,
      `SELECT path, COUNT(*) AS n FROM web_pageviews WHERE account_id = ? AND host = ? AND created_at > ?
        GROUP BY path ORDER BY n DESC, path LIMIT 30`,
      accountId,
      s.host,
      since,
    ).map((p) => ({ path: p.path, count: Number(p.n) })),
  }));
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
    const cfg = parseJson<{ hours?: number; host?: string }>(a.trigger_config, {});
    const hours = Math.min(Math.max(Number(cfg.hours ?? 2), 0.25), 168);
    // Un seul site choisi : seuls ses produits comptent (vide = tous les sites).
    const host = typeof cfg.host === 'string' ? cfg.host : '';
    const until = new Date(nowMs - hours * 3_600_000).toISOString();
    const from = new Date(nowMs - hours * 3_600_000 - 2 * 86_400_000).toISOString();
    const rows = all<{ contact_id: string; product: string; url: string; created_at: string; email: string; status: string }>(
      db,
      `SELECT p.contact_id, p.product, p.url, p.created_at, c.email, c.status
         FROM web_pageviews p JOIN contacts c ON c.id = p.contact_id
        WHERE p.account_id = ? AND p.product IS NOT NULL AND p.contact_id IS NOT NULL AND p.created_at > ? AND p.created_at <= ?
          AND (? = '' OR p.host = ?)
        ORDER BY p.created_at DESC`,
      a.account_id,
      from,
      until,
      host,
      host,
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

/** Anonymous visitors are forgotten after 90 days, browsing history and site actions after 13 months (CNIL guidance). */
export function purgeTracking(db: DatabaseSync, nowMs = Date.now()): void {
  const anonymousBefore = new Date(nowMs - 90 * 86_400_000).toISOString();
  // Le visiteur anonyme oublié ne laisse pas son identifiant sur des actions restantes.
  run(
    db,
    `UPDATE web_actions SET vid = NULL WHERE vid IS NOT NULL AND EXISTS (
       SELECT 1 FROM web_visitors v WHERE v.account_id = web_actions.account_id AND v.vid = web_actions.vid AND v.contact_id IS NULL AND v.last_seen < ?)`,
    anonymousBefore,
  );
  run(db, 'DELETE FROM web_visitors WHERE contact_id IS NULL AND last_seen < ?', anonymousBefore);
  run(db, 'DELETE FROM web_pageviews WHERE created_at < ?', new Date(nowMs - 395 * 86_400_000).toISOString());
  run(db, 'DELETE FROM web_actions WHERE created_at < ?', new Date(nowMs - 395 * 86_400_000).toISOString());
  // Codes « Connecter à Pingsell » expirés (10 min).
  run(db, 'DELETE FROM connect_codes WHERE expires_at < ?', new Date(nowMs).toISOString());
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

// Persistence for the Shopify module: core `integrations` table + module-owned tables.
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ShopifyClient, isTerminalTokenError, requestAccessToken, type TokenProvider } from './client.js';
import type { IntegrationRow, PublicIntegration, ShopifyConfig } from './types.js';
import { t } from '../../i18n.js';

const PROVIDER = 'shopify';

/** Creates the tables owned by this module (idempotent). */
export function ensureShopifySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_checkouts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      shop_domain TEXT NOT NULL,
      checkout_id TEXT NOT NULL,
      checkout_token TEXT,
      email TEXT,
      total REAL NOT NULL DEFAULT 0,
      currency TEXT,
      abandoned_url TEXT,
      line_items TEXT NOT NULL DEFAULT '[]',
      customer TEXT,                              -- JSON {first_name,last_name,external_id,marketing_state}
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | completed | abandoned
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      abandoned_at TEXT,
      UNIQUE(account_id, checkout_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_pending ON shopify_checkouts(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_shopify_checkouts_email ON shopify_checkouts(account_id, email);

    -- Secrets kept outside integrations.config so that core never exposes them.
    CREATE TABLE IF NOT EXISTS shopify_credentials (
      account_id TEXT PRIMARY KEY,
      client_id TEXT,
      client_secret TEXT,
      webhook_secret TEXT,
      token_expires_at TEXT,
      updated_at TEXT NOT NULL
    );

    -- Installs started from Shopify (App Store) before we know which Pingsell account they belong to.
    -- The merchant claims it after logging in; rows live 24 h at most.
    CREATE TABLE IF NOT EXISTS shopify_pending_installs (
      claim TEXT PRIMARY KEY,
      shop_domain TEXT NOT NULL,
      shop_name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TEXT,
      refresh_expires_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- customers/data_request received from Shopify, kept so the merchant can answer the customer.
    CREATE TABLE IF NOT EXISTS shopify_data_requests (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      shop_domain TEXT NOT NULL,
      customer_email TEXT,
      customer_id TEXT,
      orders_requested TEXT NOT NULL DEFAULT '[]',
      contact_id TEXT,
      created_at TEXT NOT NULL
    );

    -- Webhook idempotency (Shopify retries deliveries).
    CREATE TABLE IF NOT EXISTS shopify_webhook_log (
      webhook_id TEXT PRIMARY KEY,
      topic TEXT,
      received_at TEXT NOT NULL
    );
  `);
  // Expiring offline tokens (public apps, mandatory since 2026): rotating refresh token per store.
  const cols = (db.prepare('PRAGMA table_info(shopify_credentials)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('refresh_token')) db.exec('ALTER TABLE shopify_credentials ADD COLUMN refresh_token TEXT');
  if (!cols.includes('refresh_expires_at')) db.exec('ALTER TABLE shopify_credentials ADD COLUMN refresh_expires_at TEXT');
}

const nowIso = () => new Date().toISOString();

export function parseConfig(raw: string | null | undefined): ShopifyConfig {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as ShopifyConfig) : {};
  } catch {
    return {};
  }
}

export function getIntegration(db: DatabaseSync, accountId: string): IntegrationRow | undefined {
  return db
    .prepare('SELECT * FROM integrations WHERE account_id = ? AND provider = ?')
    .get(accountId, PROVIDER) as unknown as IntegrationRow | undefined;
}

export function getIntegrationsByShop(db: DatabaseSync, shop: string): IntegrationRow[] {
  return db
    .prepare('SELECT * FROM integrations WHERE provider = ? AND shop_domain = ?')
    .all(PROVIDER, shop) as unknown as IntegrationRow[];
}

/** Inserts or replaces the account's Shopify integration and returns the row. */
export function saveIntegration(
  db: DatabaseSync,
  accountId: string,
  shop: string,
  accessToken: string,
  config: ShopifyConfig,
): IntegrationRow {
  db.prepare(
    `INSERT INTO integrations (id, account_id, provider, shop_domain, access_token, status, config, last_sync_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, NULL, ?)
     ON CONFLICT(account_id, provider) DO UPDATE SET
       shop_domain = excluded.shop_domain,
       access_token = excluded.access_token,
       status = 'connected',
       config = excluded.config`,
  ).run(randomUUID(), accountId, PROVIDER, shop, accessToken, JSON.stringify(config), nowIso());
  const row = getIntegration(db, accountId);
  if (!row) throw new Error(t('Intégration Shopify introuvable après enregistrement', 'Shopify integration not found after saving'));
  return row;
}

/** Shallow-merges `patch` into integrations.config (and optionally updates status / last_sync_at). */
export function updateIntegration(
  db: DatabaseSync,
  accountId: string,
  patch: Partial<ShopifyConfig>,
  fields: { status?: 'connected' | 'error'; last_sync_at?: string; access_token?: string } = {},
): void {
  const row = getIntegration(db, accountId);
  if (!row) return;
  const config = { ...parseConfig(row.config), ...patch };
  db.prepare(
    `UPDATE integrations SET config = ?, status = COALESCE(?, status), last_sync_at = COALESCE(?, last_sync_at),
       access_token = COALESCE(?, access_token) WHERE id = ?`,
  ).run(JSON.stringify(config), fields.status ?? null, fields.last_sync_at ?? null, fields.access_token ?? null, row.id);
}

export function deleteIntegration(db: DatabaseSync, accountId: string): void {
  db.prepare('DELETE FROM integrations WHERE account_id = ? AND provider = ?').run(accountId, PROVIDER);
  db.prepare('DELETE FROM shopify_credentials WHERE account_id = ?').run(accountId);
  db.prepare("DELETE FROM shopify_checkouts WHERE account_id = ? AND status = 'pending'").run(accountId);
}

export function toPublic(row: IntegrationRow): PublicIntegration {
  return {
    id: row.id,
    provider: 'shopify',
    shop_domain: row.shop_domain,
    status: row.status,
    connected: row.status === 'connected' && Boolean(row.access_token),
    config: parseConfig(row.config),
    last_sync_at: row.last_sync_at,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Credentials (client credentials grant + per-integration webhook secret)

export interface ShopifyCredentials {
  account_id: string;
  client_id: string | null;
  client_secret: string | null;
  webhook_secret: string | null;
  token_expires_at: string | null;
  refresh_token: string | null;
  refresh_expires_at: string | null;
}

export interface CredentialsInput {
  client_id?: string | null;
  client_secret?: string | null;
  webhook_secret?: string | null;
  token_expires_at?: string | null;
  refresh_token?: string | null;
  refresh_expires_at?: string | null;
}

export function getCredentials(db: DatabaseSync, accountId: string): ShopifyCredentials | undefined {
  return db.prepare('SELECT * FROM shopify_credentials WHERE account_id = ?').get(accountId) as unknown as
    | ShopifyCredentials
    | undefined;
}

export function saveCredentials(db: DatabaseSync, accountId: string, creds: CredentialsInput): void {
  db.prepare(
    `INSERT INTO shopify_credentials (account_id, client_id, client_secret, webhook_secret, token_expires_at, refresh_token, refresh_expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       client_id = excluded.client_id, client_secret = excluded.client_secret,
       webhook_secret = excluded.webhook_secret, token_expires_at = excluded.token_expires_at,
       refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at,
       updated_at = excluded.updated_at`,
  ).run(
    accountId,
    creds.client_id ?? null,
    creds.client_secret ?? null,
    creds.webhook_secret ?? null,
    creds.token_expires_at ?? null,
    creds.refresh_token ?? null,
    creds.refresh_expires_at ?? null,
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Public app credentials (set once by registerShopify from SHOPIFY_API_KEY / SHOPIFY_API_SECRET)

let appCredentials: { key: string; secret: string } | null = null;
export function setAppCredentials(key?: string, secret?: string): void {
  appCredentials = key && secret ? { key, secret } : null;
}

/** ISO date `seconds` from now (undefined when Shopify didn't say). */
export function inSeconds(seconds: number | undefined): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

/** One refresh at a time per account: Shopify rotates the refresh token on every call. */
const refreshing = new Map<string, Promise<string>>();

/**
 * Token provider for an account. Static tokens (legacy custom app) are returned as-is;
 * client-credentials tokens (24 h) and expiring OAuth offline tokens (1 h, rotating refresh token)
 * are renewed transparently 5 minutes before expiry.
 */
export function tokenProviderFor(db: DatabaseSync, accountId: string): TokenProvider {
  return async () => {
    const row = getIntegration(db, accountId);
    if (!row) throw new Error(t('Aucune intégration Shopify pour ce compte', 'No Shopify integration for this account'));
    const creds = getCredentials(db, accountId);
    const expiresAt = creds?.token_expires_at ? Date.parse(creds.token_expires_at) : NaN;
    const stale = !row.access_token || !Number.isFinite(expiresAt) || expiresAt - Date.now() < 5 * 60_000;
    const canClientCredentials = Boolean(creds?.client_id && creds.client_secret);
    const canRefresh = Boolean(creds?.refresh_token && appCredentials);
    if (!stale || (!canClientCredentials && !canRefresh)) return row.access_token;

    const inflight = refreshing.get(accountId);
    if (inflight) return inflight;
    const job = (async () => {
      if (canClientCredentials) {
        const token = await requestAccessToken(row.shop_domain, {
          grant_type: 'client_credentials',
          client_id: creds!.client_id!,
          client_secret: creds!.client_secret!,
        });
        db.prepare('UPDATE integrations SET access_token = ? WHERE id = ?').run(token.access_token, row.id);
        saveCredentials(db, accountId, { ...creds, token_expires_at: inSeconds(token.expires_in ?? 86_399) });
        return token.access_token;
      }
      try {
        const token = await requestAccessToken(row.shop_domain, {
          grant_type: 'refresh_token',
          client_id: appCredentials!.key,
          client_secret: appCredentials!.secret,
          refresh_token: creds!.refresh_token!,
        });
        db.prepare('UPDATE integrations SET access_token = ? WHERE id = ?').run(token.access_token, row.id);
        saveCredentials(db, accountId, {
          ...creds,
          token_expires_at: inSeconds(token.expires_in ?? 3600),
          // Always keep the newest refresh token: presenting it retires the previous one.
          refresh_token: token.refresh_token ?? creds!.refresh_token,
          refresh_expires_at: token.refresh_token ? inSeconds(token.refresh_token_expires_in) : creds!.refresh_expires_at,
        });
        return token.access_token;
      } catch (err) {
        if (isTerminalTokenError(err)) {
          // Refresh token expired or revoked: only a new install can fix it.
          updateIntegration(
            db,
            accountId,
            { error: t('La connexion à Shopify a expiré : rouvrez Pingsell depuis votre admin Shopify pour la renouveler.', 'The Shopify connection expired: open Pingsell again from your Shopify admin to renew it.') },
            { status: 'error' },
          );
        }
        throw err;
      }
    })().finally(() => refreshing.delete(accountId));
    refreshing.set(accountId, job);
    return job;
  };
}

export function clientFor(db: DatabaseSync, accountId: string, shop: string): ShopifyClient {
  return new ShopifyClient(shop, tokenProviderFor(db, accountId));
}

// ---------------------------------------------------------------------------
// Contacts (read-only lookups; writes go through ctx.upsertContact)

export interface ContactSnapshot {
  id: string;
  email: string;
  tags: string[];
  status: string;
  total_spent: number;
  orders_count: number;
  last_order_at: string | null;
}

export function findContactByEmail(db: DatabaseSync, accountId: string, email: string): ContactSnapshot | undefined {
  const row = db
    .prepare(
      'SELECT id, email, tags, status, total_spent, orders_count, last_order_at FROM contacts WHERE account_id = ? AND lower(email) = lower(?)',
    )
    .get(accountId, email) as
    | { id: string; email: string; tags: string | null; status: string; total_spent: number | null; orders_count: number | null; last_order_at: string | null }
    | undefined;
  if (!row) return undefined;
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags ?? '[]');
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    /* ignore malformed tags */
  }
  return {
    id: row.id,
    email: row.email,
    tags,
    status: row.status,
    total_spent: Number(row.total_spent ?? 0),
    orders_count: Number(row.orders_count ?? 0),
    last_order_at: row.last_order_at,
  };
}

/** True when an `order` event with this Shopify order id was already recorded for the account. */
export function orderAlreadyRecorded(db: DatabaseSync, accountId: string, orderId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS x FROM events WHERE account_id = ? AND type = 'order' AND json_extract(data, '$.order_id') = ? LIMIT 1")
    .get(accountId, orderId);
  return Boolean(row);
}

/** Inserts an `order` event with its original date (used by the historical sync). */
export function insertHistoricalOrderEvent(
  db: DatabaseSync,
  accountId: string,
  contactId: string,
  data: Record<string, unknown>,
  createdAt: string,
): void {
  db.prepare('INSERT INTO events (id, account_id, contact_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    accountId,
    contactId,
    'order',
    JSON.stringify(data),
    createdAt,
  );
}

/** Records a webhook id; returns false if it was already processed. */
export function markWebhookProcessed(db: DatabaseSync, webhookId: string, topic: string): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO shopify_webhook_log (webhook_id, topic, received_at) VALUES (?, ?, ?)')
    .run(webhookId, topic, nowIso());
  return Number(res.changes) > 0;
}

export function pruneWebhookLog(db: DatabaseSync): void {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  db.prepare('DELETE FROM shopify_webhook_log WHERE received_at < ?').run(cutoff);
}

// ---------------------------------------------------------------------------
// Installs started from Shopify, waiting for the merchant to pick their Pingsell account

const PENDING_TTL_MS = 24 * 3600_000;

export interface PendingInstallRow {
  claim: string;
  shop_domain: string;
  shop_name: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  created_at: string;
  expires_at: string;
}

export function savePendingInstall(
  db: DatabaseSync,
  input: Omit<PendingInstallRow, 'claim' | 'created_at' | 'expires_at'>,
): string {
  prunePendingInstalls(db);
  // One pending install per shop: a new install replaces the previous one (its token is retired anyway).
  db.prepare('DELETE FROM shopify_pending_installs WHERE shop_domain = ?').run(input.shop_domain);
  const claim = randomBytes(24).toString('base64url');
  db.prepare(
    `INSERT INTO shopify_pending_installs (claim, shop_domain, shop_name, access_token, refresh_token, token_expires_at, refresh_expires_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    claim,
    input.shop_domain,
    input.shop_name,
    input.access_token,
    input.refresh_token,
    input.token_expires_at,
    input.refresh_expires_at,
    nowIso(),
    new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  );
  return claim;
}

export function getPendingInstall(db: DatabaseSync, claim: unknown): PendingInstallRow | undefined {
  if (typeof claim !== 'string' || !claim || claim.length > 100) return undefined;
  const row = db.prepare('SELECT * FROM shopify_pending_installs WHERE claim = ?').get(claim) as unknown as PendingInstallRow | undefined;
  if (!row || Date.parse(row.expires_at) < Date.now()) return undefined;
  return row;
}

export function deletePendingInstall(db: DatabaseSync, claim: string): void {
  db.prepare('DELETE FROM shopify_pending_installs WHERE claim = ?').run(claim);
}

export function prunePendingInstalls(db: DatabaseSync): void {
  db.prepare('DELETE FROM shopify_pending_installs WHERE expires_at < ?').run(nowIso());
}

// ---------------------------------------------------------------------------
// Privacy (mandatory compliance webhooks)

const SHOPIFY_EVENT_TYPES = ['order', 'order_fulfilled', 'cart_abandoned'];

function contactsFor(db: DatabaseSync, accountId: string, email: string | null, customerId: string | null) {
  const rows = new Map<string, { id: string; source: string }>();
  if (email) {
    for (const r of db
      .prepare('SELECT id, source FROM contacts WHERE account_id = ? AND lower(email) = lower(?)')
      .all(accountId, email) as { id: string; source: string }[])
      rows.set(r.id, r);
  }
  if (customerId) {
    for (const r of db
      .prepare('SELECT id, source FROM contacts WHERE account_id = ? AND external_id = ?')
      .all(accountId, customerId) as { id: string; source: string }[])
      rows.set(r.id, r);
  }
  return [...rows.values()];
}

/**
 * customers/redact: erase what Pingsell got from Shopify about one customer.
 * A contact that came from Shopify is deleted (its sends, runs… cascade); a contact the merchant
 * added another way keeps its own data but loses everything Shopify brought (orders, carts, totals, id).
 */
export function redactCustomer(db: DatabaseSync, accountId: string, shop: string, email: string | null, customerId: string | null): number {
  let touched = 0;
  for (const c of contactsFor(db, accountId, email, customerId)) {
    touched++;
    if (c.source === 'shopify') {
      db.prepare('DELETE FROM events WHERE account_id = ? AND contact_id = ?').run(accountId, c.id);
      db.prepare('DELETE FROM contacts WHERE id = ?').run(c.id);
    } else {
      db.prepare(
        `DELETE FROM events WHERE account_id = ? AND contact_id = ? AND type IN (${SHOPIFY_EVENT_TYPES.map(() => '?').join(',')})`,
      ).run(accountId, c.id, ...SHOPIFY_EVENT_TYPES);
      db.prepare(
        "UPDATE contacts SET external_id = NULL, total_spent = 0, orders_count = 0, last_order_at = NULL, updated_at = ? WHERE id = ?",
      ).run(nowIso(), c.id);
    }
  }
  if (email) {
    db.prepare('DELETE FROM shopify_checkouts WHERE account_id = ? AND shop_domain = ? AND lower(email) = lower(?)').run(accountId, shop, email);
  }
  db.prepare('DELETE FROM shopify_data_requests WHERE account_id = ? AND (lower(customer_email) = lower(?) OR customer_id = ?)').run(
    accountId,
    email ?? '',
    customerId ?? '',
  );
  return touched;
}

/** customers/data_request: keep the request so the merchant can see and answer it. */
export function recordDataRequest(
  db: DatabaseSync,
  accountId: string,
  shop: string,
  email: string | null,
  customerId: string | null,
  orders: unknown[],
): void {
  const contact = contactsFor(db, accountId, email, customerId)[0];
  db.prepare(
    `INSERT INTO shopify_data_requests (id, account_id, shop_domain, customer_email, customer_id, orders_requested, contact_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), accountId, shop, email, customerId, JSON.stringify(orders.slice(0, 500)), contact?.id ?? null, nowIso());
}

/**
 * shop/redact (48 h after uninstall): drop the store connection and everything kept only for it
 * (secrets, carts, pending installs, data requests). Contacts stay in the merchant's Pingsell
 * account: they are the merchant's audience, which the merchant can delete at any time.
 */
export function redactShop(db: DatabaseSync, shop: string): void {
  const rows = db
    .prepare("SELECT account_id, status, access_token FROM integrations WHERE provider = ? AND shop_domain = ?")
    .all(PROVIDER, shop) as { account_id: string; status: string; access_token: string }[];
  for (const r of rows) {
    // Reinstalled since the uninstall: the connection is live again, nothing to erase.
    if (r.status === 'connected' && r.access_token) continue;
    db.prepare('DELETE FROM shopify_checkouts WHERE account_id = ? AND shop_domain = ?').run(r.account_id, shop);
    db.prepare('DELETE FROM shopify_data_requests WHERE account_id = ? AND shop_domain = ?').run(r.account_id, shop);
    db.prepare('DELETE FROM integrations WHERE account_id = ? AND provider = ? AND shop_domain = ?').run(r.account_id, PROVIDER, shop);
    db.prepare('DELETE FROM shopify_credentials WHERE account_id = ?').run(r.account_id);
  }
  db.prepare('DELETE FROM shopify_pending_installs WHERE shop_domain = ?').run(shop);
}

/** app/uninstalled: the token is dead, forget it and its refresh token. */
export function forgetTokens(db: DatabaseSync, accountId: string): void {
  db.prepare('UPDATE shopify_credentials SET refresh_token = NULL, refresh_expires_at = NULL, token_expires_at = NULL, updated_at = ? WHERE account_id = ?').run(
    nowIso(),
    accountId,
  );
}

// Persistence for the Shopify module: core `integrations` table + module-owned tables.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ShopifyClient, requestAccessToken, type TokenProvider } from './client.js';
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

    -- Webhook idempotency (Shopify retries deliveries).
    CREATE TABLE IF NOT EXISTS shopify_webhook_log (
      webhook_id TEXT PRIMARY KEY,
      topic TEXT,
      received_at TEXT NOT NULL
    );
  `);
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
}

export function getCredentials(db: DatabaseSync, accountId: string): ShopifyCredentials | undefined {
  return db.prepare('SELECT * FROM shopify_credentials WHERE account_id = ?').get(accountId) as unknown as
    | ShopifyCredentials
    | undefined;
}

export function saveCredentials(
  db: DatabaseSync,
  accountId: string,
  creds: { client_id?: string | null; client_secret?: string | null; webhook_secret?: string | null; token_expires_at?: string | null },
): void {
  db.prepare(
    `INSERT INTO shopify_credentials (account_id, client_id, client_secret, webhook_secret, token_expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       client_id = excluded.client_id, client_secret = excluded.client_secret,
       webhook_secret = excluded.webhook_secret, token_expires_at = excluded.token_expires_at,
       updated_at = excluded.updated_at`,
  ).run(
    accountId,
    creds.client_id ?? null,
    creds.client_secret ?? null,
    creds.webhook_secret ?? null,
    creds.token_expires_at ?? null,
    nowIso(),
  );
}

/**
 * Token provider for an account. Static tokens (custom app / OAuth offline token) are returned as-is;
 * client-credentials tokens (24 h) are refreshed transparently 5 minutes before expiry.
 */
export function tokenProviderFor(db: DatabaseSync, accountId: string): TokenProvider {
  return async () => {
    const row = getIntegration(db, accountId);
    if (!row) throw new Error(t('Aucune intégration Shopify pour ce compte', 'No Shopify integration for this account'));
    const creds = getCredentials(db, accountId);
    const expiresAt = creds?.token_expires_at ? Date.parse(creds.token_expires_at) : NaN;
    const needsRefresh =
      creds?.client_id && creds.client_secret && (!row.access_token || !Number.isFinite(expiresAt) || expiresAt - Date.now() < 5 * 60_000);
    if (!needsRefresh) return row.access_token;
    const token = await requestAccessToken(row.shop_domain, {
      grant_type: 'client_credentials',
      client_id: creds.client_id!,
      client_secret: creds.client_secret!,
    });
    const newExpiry = new Date(Date.now() + (token.expires_in ?? 86_399) * 1000).toISOString();
    db.prepare('UPDATE integrations SET access_token = ? WHERE id = ?').run(token.access_token, row.id);
    saveCredentials(db, accountId, { ...creds, token_expires_at: newExpiry });
    return token.access_token;
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

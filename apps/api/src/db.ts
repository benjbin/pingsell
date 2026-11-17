import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type { DatabaseSync, SQLInputValue };
export type Row = Record<string, unknown>;

/**
 * Ordered list of schema migrations. Each entry is applied once, tracked by
 * `PRAGMA user_version`. Never edit an applied migration: append a new one.
 */
const MIGRATIONS: Array<string | { sql: string; foreignKeysOff?: boolean }> = [
  /* 1 — initial schema (SPEC.md "Data model") */ `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_account ON sessions(account_id);

  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX idx_api_keys_account ON api_keys(account_id);

  CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    attributes TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'subscribed'
      CHECK (status IN ('subscribed','unsubscribed','bounced','complained')),
    source TEXT NOT NULL DEFAULT 'manual'
      CHECK (source IN ('manual','import','shopify','api')),
    external_id TEXT,
    total_spent REAL NOT NULL DEFAULT 0,
    orders_count INTEGER NOT NULL DEFAULT 0,
    last_order_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, email)
  );
  CREATE INDEX idx_contacts_account_status ON contacts(account_id, status);
  CREATE INDEX idx_contacts_account_created ON contacts(account_id, created_at);
  CREATE INDEX idx_contacts_external ON contacts(account_id, external_id);

  CREATE TABLE segments (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rules TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_segments_account ON segments(account_id);

  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    preheader TEXT,
    from_name TEXT,
    from_email TEXT,
    html TEXT,
    segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','scheduled','sending','sent','failed')),
    scheduled_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_campaigns_account_status ON campaigns(account_id, status);

  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL
      CHECK (trigger IN ('contact_created','tag_added','order_created','cart_abandoned')),
    trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_automations_account_trigger ON automations(account_id, trigger, status);

  -- contact_id is nullable: test sends may target addresses that are not contacts,
  -- and deleting a contact keeps its message history for statistics.
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','bounced')),
    provider_id TEXT,
    error TEXT,
    sent_at TEXT,
    opened_at TEXT,
    clicked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_status_created ON messages(status, created_at);
  CREATE INDEX idx_messages_campaign ON messages(campaign_id);
  CREATE INDEX idx_messages_automation ON messages(automation_id);
  CREATE INDEX idx_messages_contact ON messages(contact_id);
  CREATE INDEX idx_messages_account_sent ON messages(account_id, sent_at);

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id TEXT,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_events_contact ON events(contact_id, created_at);
  CREATE INDEX idx_events_account_type ON events(account_id, type, created_at);

  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_runs_due ON automation_runs(status, next_run_at);
  CREATE INDEX idx_runs_automation_contact ON automation_runs(automation_id, contact_id);

  CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    shop_domain TEXT,
    access_token TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    config TEXT NOT NULL DEFAULT '{}',
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (account_id, provider)
  );
  `,
  // v2 — visual editor: block design (JSON) stored next to the rendered HTML
  `ALTER TABLE campaigns ADD COLUMN design TEXT;`,
  // v3 — media library (uploaded images) and saved email templates
  `
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_assets_account ON assets(account_id, created_at);

  CREATE TABLE email_templates (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    design TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_email_templates_account ON email_templates(account_id, updated_at);
  `,
  // v4 — brand kit: default email style (theme, logo, socials, footer) per account
  `ALTER TABLE accounts ADD COLUMN brand_kit TEXT;`,
  // v5 — team: several users per account (roles), invitations. The account's
  // historical login becomes its owner user (same id), sessions belong to a user.
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor')),
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  );
  CREATE INDEX idx_users_account ON users(account_id);
  INSERT INTO users (id, account_id, email, name, password_hash, role, created_at)
    SELECT id, id, email, name, password_hash, 'owner', created_at FROM accounts;

  ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
  UPDATE sessions SET user_id = account_id;
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor')),
    token TEXT NOT NULL UNIQUE,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_invitations_account ON invitations(account_id);
  CREATE UNIQUE INDEX idx_invitations_email ON invitations(account_id, email);
  `,
  // v6 — push notifications to the merchant's own iOS / Android app (FCM, APNs, Expo).
  `
  CREATE TABLE push_config (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    app_key TEXT NOT NULL UNIQUE,
    fcm TEXT,
    apns TEXT,
    expo TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE push_devices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
    provider TEXT NOT NULL CHECK (provider IN ('fcm','apns','expo')),
    app_version TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_push_devices_token ON push_devices(account_id, token);
  CREATE INDEX idx_push_devices_contact ON push_devices(contact_id);

  CREATE TABLE push_campaigns (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image_url TEXT,
    url TEXT,
    audience TEXT NOT NULL DEFAULT '{"type":"all"}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX idx_push_campaigns_account ON push_campaigns(account_id, created_at);

  CREATE TABLE push_messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    push_campaign_id TEXT REFERENCES push_campaigns(id) ON DELETE CASCADE,
    automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL,
    device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image_url TEXT,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
    error TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    opened_at TEXT
  );
  CREATE INDEX idx_push_messages_status ON push_messages(status, created_at);
  CREATE INDEX idx_push_messages_campaign ON push_messages(push_campaign_id);
  `,
  // v7 — in-app notification centre (inbox inside the merchant's app), channels, identity verification.
  `
  ALTER TABLE push_campaigns ADD COLUMN channels TEXT NOT NULL DEFAULT '["push","in_app"]';
  ALTER TABLE push_messages ADD COLUMN inbox_id TEXT;
  ALTER TABLE push_config ADD COLUMN identity_secret TEXT;
  ALTER TABLE push_config ADD COLUMN require_identity INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE app_inbox (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES push_devices(id) ON DELETE CASCADE,
    push_campaign_id TEXT REFERENCES push_campaigns(id) ON DELETE CASCADE,
    automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image_url TEXT,
    url TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX idx_app_inbox_contact ON app_inbox(account_id, contact_id, created_at);
  CREATE INDEX idx_app_inbox_device ON app_inbox(account_id, device_id, created_at);
  CREATE INDEX idx_app_inbox_campaign ON app_inbox(push_campaign_id);
  `,
  // v8 — push growth: pre-permission prompt, resend to non-openers, smart send time,
  // app triggers (first sign-in, push enabled, order shipped), exit conditions.
  // The automations table is rebuilt (new trigger values in its CHECK), so foreign keys are
  // switched off for this migration: dropping the old table must not cascade to runs / messages.
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE automations_v8 (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL
      CHECK (trigger IN ('contact_created','tag_added','order_created','cart_abandoned','order_fulfilled','app_signed_in','push_subscribed')),
    trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO automations_v8 (id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at)
    SELECT id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at FROM automations;
  DROP TABLE automations;
  ALTER TABLE automations_v8 RENAME TO automations;
  CREATE INDEX idx_automations_account_trigger ON automations(account_id, trigger, status);

  ALTER TABLE push_config ADD COLUMN prompt TEXT;
  CREATE TABLE push_prompt_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event TEXT NOT NULL CHECK (event IN ('shown','accepted','declined','granted','denied')),
    platform TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_push_prompt_events ON push_prompt_events(account_id, created_at);

  ALTER TABLE push_campaigns ADD COLUMN send_mode TEXT NOT NULL DEFAULT 'now';
  ALTER TABLE push_campaigns ADD COLUMN resend_after_hours INTEGER;
  ALTER TABLE push_campaigns ADD COLUMN resend_title TEXT;
  ALTER TABLE push_campaigns ADD COLUMN resend_body TEXT;
  ALTER TABLE push_campaigns ADD COLUMN resend_queued_at TEXT;
  ALTER TABLE push_messages ADD COLUMN resend INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE push_messages ADD COLUMN scheduled_at TEXT;
  CREATE INDEX idx_push_messages_contact ON push_messages(contact_id, opened_at);

  CREATE TABLE app_users (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (account_id, contact_id)
  );
  `,
  },
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as Row).user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version];
    const { sql, foreignKeysOff } = typeof migration === 'string' ? { sql: migration, foreignKeysOff: false } : migration;
    // Table rebuilds (SQLite's 12-step ALTER) need foreign keys off, which only works outside a transaction.
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(sql);
        if (foreignKeysOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migration ${version + 1} : ${broken.length} clé(s) étrangère(s) invalide(s)`);
        }
        db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    } finally {
      if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

let txDepth = 0;

/** Runs `fn` inside a transaction (nested calls join the outer transaction). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

export function all<T = Row>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function scalar(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = db.prepare(sql).get(...params) as Row | undefined;
  if (!row) return 0;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const now = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();

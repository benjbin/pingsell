import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { runInDbThread } from './services/dbThread.js';

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
  // v9 — account language (fr | en) for texts generated outside a request: worker, campaign emails.
  `ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'fr';`,
  // v10 — the merchant's own sending domain (DKIM key generated by us, published in their DNS)
  // and the account's default sender address on that domain.
  `
  CREATE TABLE sending_domains (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    selector TEXT NOT NULL,
    private_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    dmarc TEXT,
    last_error TEXT,
    last_checked_at TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL
  );
  ALTER TABLE accounts ADD COLUMN from_email TEXT;
  `,
  // v11 — "forgot password": one-time reset links (only a hash of the token is stored).
  `
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);
  `,
  // v12 — carts sent by any website through the API (POST /carts): abandoned after 1 h without an order.
  `
  CREATE TABLE api_carts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    cart_id TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT,
    checkout_url TEXT,
    line_items TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    abandoned_at TEXT,
    UNIQUE (account_id, cart_id)
  );
  CREATE INDEX idx_api_carts_pending ON api_carts(status, updated_at);
  `,
  // v13 — any event sent by a website (POST /events) can start an automation: new `event` trigger,
  // runs keep the event's data (for {{event.*}} and « wait until N hours before the date »).
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE automations_v13 (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL
      CHECK (trigger IN ('contact_created','tag_added','order_created','cart_abandoned','order_fulfilled','app_signed_in','push_subscribed','event')),
    trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO automations_v13 (id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at)
    SELECT id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at FROM automations;
  DROP TABLE automations;
  ALTER TABLE automations_v13 RENAME TO automations;
  CREATE INDEX idx_automations_account_trigger ON automations(account_id, trigger, status);

  ALTER TABLE automation_runs ADD COLUMN data TEXT;
  ALTER TABLE automation_runs ADD COLUMN event_key TEXT;
  CREATE INDEX idx_runs_event_key ON automation_runs(event_key);
  `,
  },
  // v14 — Brevo / OneSignal-style journeys: new triggers (validated by the API, so no CHECK to rebuild
  // next time), once-per-occurrence memory for time-based triggers, team alerts.
  {
    foreignKeysOff: true,
    sql: `
  CREATE TABLE automations_v14 (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    trigger_config TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO automations_v14 (id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at)
    SELECT id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at FROM automations;
  DROP TABLE automations;
  ALTER TABLE automations_v14 RENAME TO automations;
  CREATE INDEX idx_automations_account_trigger ON automations(account_id, trigger, status);

  CREATE TABLE automation_seen (
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (automation_id, contact_id, key)
  );

  CREATE TABLE team_notifications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    automation_id TEXT,
    contact_id TEXT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    data TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX idx_team_notifications_status ON team_notifications(status, created_at);
  `,
  },
  // v15 — no-code sites: one secret webhook URL (WooCommerce, Webflow, Framer, Wix, Tally…) and one public
  // form key (paste-in signup form, order-confirmation snippet) per account.
  `
  CREATE TABLE inbound_hooks (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('webhook','form')),
    token TEXT NOT NULL UNIQUE,
    allowed_origins TEXT NOT NULL DEFAULT '[]',
    uses INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    last_source TEXT,
    last_result TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (account_id, kind)
  );
  `,
  // v16 — site tracking (same one-line script as the form): visitors, pages and products seen,
  // linked to the contact once known. Deleting a contact deletes their browsing history.
  `
  CREATE TABLE web_tracking (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    require_consent INTEGER NOT NULL DEFAULT 0,
    site_hosts TEXT NOT NULL DEFAULT '[]',
    pageviews INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    last_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE web_visitors (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    vid TEXT NOT NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    identified_by TEXT,
    pageviews INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (account_id, vid)
  );
  CREATE INDEX idx_web_visitors_contact ON web_visitors(contact_id);
  CREATE INDEX idx_web_visitors_seen ON web_visitors(last_seen);

  CREATE TABLE web_pageviews (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    vid TEXT NOT NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    referrer TEXT,
    product TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id, vid) REFERENCES web_visitors(account_id, vid) ON DELETE CASCADE
  );
  CREATE INDEX idx_web_pageviews_visitor ON web_pageviews(account_id, vid, created_at);
  CREATE INDEX idx_web_pageviews_contact ON web_pageviews(contact_id, created_at);
  CREATE INDEX idx_web_pageviews_product ON web_pageviews(account_id, created_at) WHERE product IS NOT NULL AND contact_id IS NOT NULL;

  ALTER TABLE contacts ADD COLUMN last_seen_at TEXT;
  `,
  // v17 — « Une ligne, et Pingsell voit tout » : chaque site reconnu par son domaine (nom modifiable),
  // pages rattachées à leur site, actions repérées par le script (création de compte, connexion,
  // newsletter, contact, autre formulaire). Supprimer un contact supprime ses actions ; une action d'une
  // personne inconnue (connexion, contact…) est gardée sans contact, pour le compteur de « Vos sites ».
  `
  CREATE TABLE web_sites (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    host TEXT NOT NULL,
    name TEXT,
    pageviews INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (account_id, host)
  );

  ALTER TABLE web_pageviews ADD COLUMN host TEXT;
  -- Rattrapage des anciennes pages : le domaine de l'adresse, sans port ni « www. » (comme siteHost()).
  UPDATE web_pageviews SET host = lower(substr(url, instr(url, '://') + 3)) WHERE instr(url, '://') > 0;
  UPDATE web_pageviews SET host = substr(host, 1, instr(host, '/') - 1) WHERE instr(host, '/') > 0;
  UPDATE web_pageviews SET host = substr(host, 1, instr(host, '?') - 1) WHERE instr(host, '?') > 0;
  UPDATE web_pageviews SET host = substr(host, 1, instr(host, '#') - 1) WHERE instr(host, '#') > 0;
  UPDATE web_pageviews SET host = substr(host, instr(host, '@') + 1) WHERE instr(host, '@') > 0;
  UPDATE web_pageviews SET host = substr(host, 1, instr(host, ':') - 1) WHERE instr(host, ':') > 0;
  UPDATE web_pageviews SET host = substr(host, 5) WHERE host LIKE 'www.%';
  UPDATE web_pageviews SET host = NULL WHERE host = '';
  CREATE INDEX idx_web_pageviews_host ON web_pageviews(account_id, host, created_at);

  INSERT OR IGNORE INTO web_sites (account_id, host, pageviews, first_seen, last_seen)
    SELECT account_id, host, COUNT(*), MIN(created_at), MAX(created_at)
      FROM web_pageviews WHERE host IS NOT NULL GROUP BY account_id, host;
  INSERT OR IGNORE INTO web_sites (account_id, host, pageviews, first_seen, last_seen)
    SELECT t.account_id, lower(j.value), 0, t.created_at, COALESCE(t.last_seen_at, t.created_at)
      FROM web_tracking t, json_each(CASE WHEN json_valid(t.site_hosts) THEN t.site_hosts ELSE '[]' END) j
     WHERE j.type = 'text' AND j.value != '';

  CREATE TABLE web_actions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    host TEXT NOT NULL,
    vid TEXT,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    form_key TEXT NOT NULL,
    label TEXT,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_web_actions_site ON web_actions(account_id, host, kind, form_key, created_at);
  CREATE INDEX idx_web_actions_contact ON web_actions(contact_id);
  CREATE INDEX idx_web_actions_created ON web_actions(created_at);

  -- « Repérer les actions automatiquement » (réglable par compte, activé par défaut).
  ALTER TABLE web_tracking ADD COLUMN capture_actions INTEGER NOT NULL DEFAULT 1;
  `,
  // « Connecter à Pingsell » (WordPress, PrestaShop) : codes à usage unique, stockés hachés (sha256).
  `
  CREATE TABLE connect_codes (
    code_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    site_host TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX idx_connect_codes_expires ON connect_codes(expires_at);
  `,
  // Campagne envoyée à des contacts choisis un par un (tableau JSON d'ids) au lieu de tous ou d'un segment.
  `ALTER TABLE campaigns ADD COLUMN contact_ids TEXT;`,
  // Logo de la boutique / entreprise (une image de la médiathèque), affiché dans l'application.
  `ALTER TABLE accounts ADD COLUMN logo_url TEXT;`,
  // Délivrabilité : pause automatique d'une campagne (taux de rebonds / blocages / plaintes trop haut),
  // contacts inactifs écartés à l'envoi, plainte « spam » rattachée au message.
  `
  ALTER TABLE campaigns ADD COLUMN paused_reason TEXT;
  ALTER TABLE campaigns ADD COLUMN guard_since TEXT;
  ALTER TABLE campaigns ADD COLUMN skipped_inactive INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN complained_at TEXT;
  `,
  // Journal des accès aux données personnelles des contacts (exigence Shopify « protected customer data ») :
  // qui a consulté, modifié, importé ou supprimé quoi, et d'où. Conservé 1 an.
  `
  CREATE TABLE data_access_log (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    user_id TEXT,
    api_key_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    route TEXT NOT NULL,
    ip TEXT,
    status INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_data_access_account ON data_access_log(account_id, created_at);
  CREATE INDEX idx_data_access_created ON data_access_log(created_at);
  `,
  // Mise en file des campagnes par petits lots : queued_at est posé quand tous les destinataires sont en file.
  `
  ALTER TABLE campaigns ADD COLUMN queued_at TEXT;
  UPDATE campaigns SET queued_at = COALESCE(sent_at, updated_at)
   WHERE EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = campaigns.id);
  `,
  // [envoi] Campagnes de 2 M de destinataires sans bloquer l'API ni remplir le disque.
  // Tout est rapide sur la base de production : uniquement des ADD COLUMN, des index et une petite table.
  //  - messages.html n'est plus rempli pour les messages de campagne ('' : rendu à l'envoi depuis campaigns.html).
  //  - messages.in_queue : 1 en file, 0 sorti de la file, NULL = ligne d'avant cette version. Les nouveaux index
  //    sont partiels sur cette colonne : les anciennes lignes (html de 143 Ko en pages de débordement, colonnes
  //    status / sent_at… placées après) ne sont jamais relues pour construire les index.
  //  - compteurs par campagne (statistiques, garde-fou, fin d'envoi) au lieu de recompter les messages à chaque tick ;
  //    counters_ok = 0 pour les campagnes existantes, rattrapées en tâche de fond par le worker (app_state.backfill_*).
  //  - events.message_id / campaign_id indexés (désinscriptions par campagne sans json_extract).
  //  - contacts.last_engaged_at / last_sent_at / sends_since_engaged : ordre d'envoi et « sunset » sans relire l'historique.
  //  - sends_daily : compteur du warm-up.
  `
  ALTER TABLE messages ADD COLUMN in_queue INTEGER;
  ALTER TABLE messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN next_attempt_at TEXT;
  CREATE INDEX idx_messages_queue ON messages(campaign_id) WHERE in_queue = 1;
  CREATE UNIQUE INDEX idx_messages_campaign_contact ON messages(campaign_id, contact_id)
    WHERE in_queue IS NOT NULL AND campaign_id IS NOT NULL AND contact_id IS NOT NULL;
  CREATE INDEX idx_messages_campaign_sent ON messages(campaign_id, sent_at) WHERE in_queue IS NOT NULL AND campaign_id IS NOT NULL;
  CREATE INDEX idx_messages_campaign_opened ON messages(campaign_id, opened_at) WHERE in_queue IS NOT NULL AND opened_at IS NOT NULL;
  CREATE INDEX idx_messages_campaign_clicked ON messages(campaign_id, clicked_at) WHERE in_queue IS NOT NULL AND clicked_at IS NOT NULL;
  CREATE INDEX idx_messages_campaign_failed ON messages(campaign_id) WHERE in_queue IS NOT NULL AND status IN ('failed', 'bounced');
  UPDATE OR IGNORE messages SET in_queue = 1 WHERE status = 'queued';

  ALTER TABLE campaigns ADD COLUMN deleted_at TEXT;
  ALTER TABLE campaigns ADD COLUMN purge_pending INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN lean INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN queue_cursor TEXT;
  ALTER TABLE campaigns ADD COLUMN queue_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN queue_retry_at TEXT;
  ALTER TABLE campaigns ADD COLUMN queue_error TEXT;
  ALTER TABLE campaigns ADD COLUMN counters_ok INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_total INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_queued INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_sent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_failed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_bounced INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_opened INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_clicked INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_complained INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN n_unsub INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN g_handled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN g_bounces INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN g_blocks INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE campaigns ADD COLUMN g_complaints INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_campaigns_status ON campaigns(status);

  CREATE TABLE campaign_hours (
    campaign_id TEXT NOT NULL,
    hour TEXT NOT NULL,
    opens INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, hour)
  ) WITHOUT ROWID;

  ALTER TABLE events ADD COLUMN message_id TEXT;
  ALTER TABLE events ADD COLUMN campaign_id TEXT;
  CREATE INDEX idx_events_message ON events(message_id) WHERE message_id IS NOT NULL;
  CREATE INDEX idx_events_campaign ON events(campaign_id, type) WHERE campaign_id IS NOT NULL;

  ALTER TABLE contacts ADD COLUMN last_engaged_at TEXT;
  ALTER TABLE contacts ADD COLUMN last_sent_at TEXT;
  ALTER TABLE contacts ADD COLUMN sends_since_engaged INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE sends_daily (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT);
  `,
  // [contacts/stats] Index « couvrants » pour les statistiques à des millions de messages (jamais de lecture
  // des lignes, donc jamais du html), index manquants des suppressions de contact (ON DELETE CASCADE / SET NULL),
  // nombre de contacts des segments mis en cache (recalculé en arrière-plan).
  `
  CREATE INDEX IF NOT EXISTS idx_messages_account_stats ON messages(account_id, sent_at, status, opened_at, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_messages_account_opened ON messages(account_id, opened_at, contact_id, campaign_id, automation_id) WHERE opened_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_messages_account_clicked ON messages(account_id, clicked_at, contact_id, campaign_id, automation_id) WHERE clicked_at IS NOT NULL;
  -- « Envoi » (outbox) : index sur une EXPRESSION, utilisé seulement par la requête qui l'écrit à l'identique
  -- (routes/misc.ts). Un index (account_id, created_at) ordinaire attirerait le planificateur sur d'autres requêtes
  -- (file d'envoi du worker, fiche contact) et lui ferait parcourir tous les messages du compte.
  CREATE INDEX IF NOT EXISTS idx_messages_outbox ON messages((account_id || ''), created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_campaign_stats ON messages(campaign_id, status, opened_at, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_messages_automation_stats ON messages(automation_id, sent_at, status, opened_at, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_push_messages_account_sent ON push_messages(account_id, sent_at, status, opened_at);
  CREATE INDEX IF NOT EXISTS idx_push_messages_account_opened ON push_messages(account_id, opened_at) WHERE opened_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_push_messages_automation ON push_messages(automation_id, sent_at, status, opened_at);
  CREATE INDEX IF NOT EXISTS idx_contacts_account_status_created ON contacts(account_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_runs_contact ON automation_runs(contact_id, status);
  CREATE INDEX IF NOT EXISTS idx_runs_automation_created ON automation_runs(automation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_app_inbox_contact_only ON app_inbox(contact_id);
  CREATE INDEX IF NOT EXISTS idx_app_users_contact ON app_users(contact_id);
  ALTER TABLE segments ADD COLUMN contacts_count INTEGER;
  ALTER TABLE segments ADD COLUMN counted_at TEXT;

  -- Recherche de contacts « contient » sans parcourir 2 M de lignes : index trigrammes (FTS5) de l'email et du
  -- nom, rowid = rowid du contact, tenu à jour par des triggers. Les contacts déjà là sont indexés en arrière-plan
  -- par petits lots (services/contacts.ts, startContactSearchBackfill) : rien n'est réécrit au démarrage.
  CREATE VIRTUAL TABLE contacts_fts USING fts5(email, name, content='', contentless_delete=1, tokenize='trigram');
  CREATE TABLE contacts_fts_state (id INTEGER PRIMARY KEY CHECK (id = 1), cursor INTEGER NOT NULL, done INTEGER NOT NULL);
  INSERT INTO contacts_fts_state (id, cursor, done) VALUES (1, 0, 0);
  CREATE TRIGGER contacts_fts_insert AFTER INSERT ON contacts BEGIN
    INSERT OR REPLACE INTO contacts_fts (rowid, email, name)
      VALUES (new.rowid, new.email, COALESCE(new.first_name, '') || ' ' || COALESCE(new.last_name, ''));
  END;
  CREATE TRIGGER contacts_fts_update AFTER UPDATE OF email, first_name, last_name ON contacts BEGIN
    INSERT OR REPLACE INTO contacts_fts (rowid, email, name)
      VALUES (new.rowid, new.email, COALESCE(new.first_name, '') || ' ' || COALESCE(new.last_name, ''));
  END;
  CREATE TRIGGER contacts_fts_delete AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE rowid = old.rowid;
  END;
  `,
  // [automatisations / push / Shopify / suivi du site] Montée en charge (2 M contacts, 2 M destinataires) :
  // - push : index des relances aux non-ouvreurs, de la file programmée (envoi intelligent) et du parcours des
  //   appareils par compte ; curseurs de mise en file (queue_cursor / queued_at) et de relance sur la campagne ;
  // - automatisations : les parcours d'une automatisation en pause sont « garés » (parked_at) et ne coûtent plus
  //   rien au worker ; un parcours en échec est réessayé (attempts / error) au lieu de bloquer les suivants ;
  // - webhooks sortants : boîte d'envoi écrite dans la même transaction que le parcours, signée (webhook_secret) ;
  // - paniers / suivi du site : index pour « commandé depuis ? » et pour la purge.
  // Aucune réécriture des grandes tables : index, colonnes ajoutées, et une mise à jour de push_campaigns (petite).
  `
  CREATE INDEX IF NOT EXISTS idx_push_messages_campaign_device ON push_messages(push_campaign_id, device_id, resend);
  CREATE INDEX IF NOT EXISTS idx_push_messages_campaign_opened ON push_messages(push_campaign_id, contact_id, opened_at);
  CREATE INDEX IF NOT EXISTS idx_push_messages_campaign_sent ON push_messages(push_campaign_id, resend, status, sent_at);
  CREATE INDEX IF NOT EXISTS idx_push_messages_due ON push_messages(status, scheduled_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_push_devices_account_active ON push_devices(account_id, active);
  CREATE INDEX IF NOT EXISTS idx_app_inbox_campaign_contact ON app_inbox(push_campaign_id, contact_id);
  ALTER TABLE push_campaigns ADD COLUMN queued_at TEXT;
  ALTER TABLE push_campaigns ADD COLUMN queue_cursor INTEGER;
  ALTER TABLE push_campaigns ADD COLUMN resend_cursor_at TEXT;
  ALTER TABLE push_campaigns ADD COLUMN resend_cursor_id INTEGER;
  -- Campagnes déjà mises en file avant cette version : ne jamais les remettre en file.
  UPDATE push_campaigns SET queued_at = COALESCE(sent_at, updated_at)
   WHERE status = 'sent'
      OR EXISTS (SELECT 1 FROM push_messages m WHERE m.push_campaign_id = push_campaigns.id)
      OR EXISTS (SELECT 1 FROM app_inbox i WHERE i.push_campaign_id = push_campaigns.id);

  ALTER TABLE automation_runs ADD COLUMN parked_at TEXT;
  ALTER TABLE automation_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE automation_runs ADD COLUMN error TEXT;
  CREATE INDEX IF NOT EXISTS idx_runs_due_live ON automation_runs(next_run_at) WHERE status = 'pending' AND parked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_runs_parked ON automation_runs(automation_id) WHERE parked_at IS NOT NULL;

  CREATE TABLE webhook_outbox (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    automation_id TEXT,
    contact_id TEXT,
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX idx_webhook_outbox_due ON webhook_outbox(status, next_attempt_at);
  CREATE INDEX idx_webhook_outbox_created ON webhook_outbox(created_at);
  ALTER TABLE accounts ADD COLUMN webhook_secret TEXT;

  CREATE INDEX IF NOT EXISTS idx_api_carts_email ON api_carts(account_id, email);
  CREATE INDEX IF NOT EXISTS idx_web_pageviews_created ON web_pageviews(created_at);
  CREATE INDEX IF NOT EXISTS idx_web_actions_vid ON web_actions(account_id, vid) WHERE vid IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_web_visitors_anonymous ON web_visitors(last_seen) WHERE contact_id IS NULL;
  `,
];

const BUSY_TIMEOUT_MS = 1000;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  // Une seule connexion sert tout le HTTP : attendre un verrou plus d'une seconde, c'est figer l'API.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  // WAL + NORMAL : pas de fsync à chaque commit (sûr en WAL, au pire on perd les derniers commits sur coupure de courant).
  db.exec('PRAGMA synchronous = NORMAL;');
  // Le fichier -wal est ramené à 64 Mo après chaque remise à zéro (sinon il garde sa taille maximale pour toujours).
  db.exec('PRAGMA journal_size_limit = 67108864;');
  db.exec('PRAGMA cache_size = -262144;'); // 256 Mo de cache de pages
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA mmap_size = 268435456;'); // 256 Mo lus via mmap (cache du noyau, partagé)
  // SQLite's LOWER() only folds ASCII: « Émile » must match « émile ».
  db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as Row).user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version];
    const startedAt = performance.now();
    const { sql, foreignKeysOff } = typeof migration === 'string' ? { sql: migration, foreignKeysOff: false } : migration;
    // Table rebuilds (SQLite's 12-step ALTER) need foreign keys off, which only works outside a transaction.
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(sql);
        if (foreignKeysOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migration ${version + 1}: ${broken.length} invalid foreign key(s)`);
        }
        db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    } finally {
      if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
    // Les migrations tournent au démarrage, avant le HTTP : une migration lente se voit ici.
    if (db.location()) console.info(`[db] migration ${version + 1}/${MIGRATIONS.length} : ${Math.round(performance.now() - startedAt)} ms`);
  }
}

export interface CheckpointResult {
  /** 1 si un lecteur (une sauvegarde en cours…) a empêché de vider complètement le WAL. */
  busy: number;
  /** Pages dans le WAL / pages recopiées dans la base, après la passe finale. */
  log: number;
  checkpointed: number;
  /** Taille du fichier -wal avant / après, en octets. */
  walBefore: number;
  walAfter: number;
  ms: number;
}

/** Taille du fichier -wal de la base (0 pour une base en mémoire ou sans WAL). */
export function walSizeBytes(db: DatabaseSync): number {
  const path = db.location();
  if (!path) return 0;
  try {
    return statSync(`${path}-wal`).size;
  } catch {
    return 0;
  }
}

/**
 * Vide le WAL dans la base puis le ramène à zéro (PRAGMA wal_checkpoint(TRUNCATE)), sans bloquer le HTTP :
 *  1. le gros du travail (recopier les pages) se fait en mode PASSIVE dans un thread avec sa propre connexion ;
 *  2. la passe finale TRUNCATE, sur la connexion principale, n'a plus que quelques pages à recopier et
 *     n'attend aucun lecteur (busy_timeout 0) : si une sauvegarde lit encore, on réessaiera plus tard.
 * Ne rejette jamais (renvoie null en cas d'échec) : on peut l'appeler sans await.
 */
export async function checkpointWal(db: DatabaseSync): Promise<CheckpointResult | null> {
  const path = db.location();
  if (!path) return null;
  const startedAt = performance.now();
  const walBefore = walSizeBytes(db);
  try {
    if (walBefore > 0) await runInDbThread(path, { op: 'checkpoint-passive' });
    if (!db.isOpen || db.isTransaction) return null;
    db.exec('PRAGMA busy_timeout = 0');
    let row: Row | undefined;
    try {
      row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as Row | undefined;
    } finally {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    }
    return {
      busy: Number(row?.busy ?? 0),
      log: Number(row?.log ?? 0),
      checkpointed: Number(row?.checkpointed ?? 0),
      walBefore,
      walAfter: walSizeBytes(db),
      ms: Math.round(performance.now() - startedAt),
    };
  } catch (err) {
    console.error(`[db] checkpoint du WAL : ${err instanceof Error ? err.message : String(err)}`);
    return null;
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

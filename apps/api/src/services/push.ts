import { createHash, createHmac, createSign, randomBytes, sign as cryptoSign, timingSafeEqual } from 'node:crypto';
import { connect as http2Connect, constants as http2Constants, type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { applyMergeTags } from './render.js';
import { compileRules, loadSegmentRules } from './segments.js';
import { zmsg } from '../lib/http.js';
import { t, withAccountLang } from '../i18n.js';
import { AdaptiveBatch } from './timeSlice.js';

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

export const fcmSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().includes('PRIVATE KEY'),
  token_uri: z.string().url().default('https://oauth2.googleapis.com/token'),
});
export type FcmCredentials = z.output<typeof fcmSchema>;

export const apnsSchema = z.object({
  key_p8: z.string().includes('PRIVATE KEY', zmsg('La clé .p8 doit contenir « BEGIN PRIVATE KEY »', 'The .p8 key must contain “BEGIN PRIVATE KEY”')),
  key_id: z.string().trim().regex(/^[A-Z0-9]{10}$/, zmsg('Key ID : 10 caractères (lettres majuscules et chiffres)', 'Key ID: 10 characters (uppercase letters and digits)')),
  team_id: z.string().trim().regex(/^[A-Z0-9]{10}$/, zmsg('Team ID : 10 caractères (lettres majuscules et chiffres)', 'Team ID: 10 characters (uppercase letters and digits)')),
  bundle_id: z.string().trim().min(3).max(200),
  production: z.boolean().default(true),
});
export type ApnsCredentials = z.output<typeof apnsSchema>;

export const expoSchema = z.object({ access_token: z.string().trim().max(200).optional() });
export type ExpoCredentials = z.output<typeof expoSchema>;

export interface PushConfig {
  app_key: string;
  fcm: FcmCredentials | null;
  apns: ApnsCredentials | null;
  expo: ExpoCredentials | null;
  /** HMAC key used by the merchant's backend to sign user identities (`user_hash`). */
  identity_secret: string;
  /** When true, the app must send a valid `user_hash` to link a device to an email / contact. */
  require_identity: boolean;
}

const newAppKey = () => `msvapp_${randomBytes(18).toString('base64url')}`;
const newIdentitySecret = () => `msvid_${randomBytes(24).toString('base64url')}`;

/** Push settings of an account; created on first access (with its public app key). */
export function ensurePushConfig(db: DatabaseSync, accountId: string): PushConfig {
  let row = get(db, 'SELECT * FROM push_config WHERE account_id = ?', accountId);
  if (!row) {
    run(db, 'INSERT INTO push_config (account_id, app_key, updated_at) VALUES (?, ?, ?)', accountId, newAppKey(), now());
    row = get(db, 'SELECT * FROM push_config WHERE account_id = ?', accountId)!;
  }
  let identitySecret = row.identity_secret ? String(row.identity_secret) : '';
  if (!identitySecret) {
    identitySecret = newIdentitySecret();
    run(db, 'UPDATE push_config SET identity_secret = ? WHERE account_id = ?', identitySecret, accountId);
  }
  return {
    app_key: String(row.app_key),
    fcm: parseJson<FcmCredentials | null>(row.fcm, null),
    apns: parseJson<ApnsCredentials | null>(row.apns, null),
    expo: parseJson<ExpoCredentials | null>(row.expo, null),
    identity_secret: identitySecret,
    require_identity: Number(row.require_identity) === 1,
  };
}

export function rotateIdentitySecret(db: DatabaseSync, accountId: string): void {
  ensurePushConfig(db, accountId);
  run(db, 'UPDATE push_config SET identity_secret = ?, updated_at = ? WHERE account_id = ?', newIdentitySecret(), now(), accountId);
}

export function setRequireIdentity(db: DatabaseSync, accountId: string, required: boolean): void {
  ensurePushConfig(db, accountId);
  run(db, 'UPDATE push_config SET require_identity = ?, updated_at = ? WHERE account_id = ?', required ? 1 : 0, now(), accountId);
}

/** HMAC-SHA256 (hex) of the email (lower-cased) or contact id, computed by the merchant's backend. */
export function identityHash(secret: string, identity: string): string {
  return createHmac('sha256', secret).update(identity).digest('hex');
}

/**
 * Checks the identity proof sent by the app. Linking a device to someone requires a valid `user_hash`
 * when the account enabled identity verification (otherwise anyone holding the public app key could
 * read another customer's in-app notifications).
 */
export function identityAllowed(cfg: PushConfig, input: Pick<DeviceInput, 'email' | 'contact_id' | 'user_hash'>): boolean {
  const identity = input.contact_id?.trim() || input.email?.trim().toLowerCase();
  if (!identity || !cfg.require_identity) return true;
  if (!input.user_hash) return false;
  const expected = Buffer.from(identityHash(cfg.identity_secret, identity));
  const given = Buffer.from(input.user_hash.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function rotateAppKey(db: DatabaseSync, accountId: string): string {
  ensurePushConfig(db, accountId);
  const key = newAppKey();
  run(db, 'UPDATE push_config SET app_key = ?, updated_at = ? WHERE account_id = ?', key, now(), accountId);
  return key;
}

export function savePushCredentials(
  db: DatabaseSync,
  accountId: string,
  patch: { fcm?: FcmCredentials | null; apns?: ApnsCredentials | null; expo?: ExpoCredentials | null },
): void {
  ensurePushConfig(db, accountId);
  for (const key of ['fcm', 'apns', 'expo'] as const) {
    if (patch[key] === undefined) continue;
    run(db, `UPDATE push_config SET ${key} = ?, updated_at = ? WHERE account_id = ?`, patch[key] ? JSON.stringify(patch[key]) : null, now(), accountId);
  }
}

/** Account id owning a public app key (`msvapp_…`), if any. */
export function accountForAppKey(db: DatabaseSync, key: string): string | undefined {
  return get<{ account_id: string }>(db, 'SELECT account_id FROM push_config WHERE app_key = ?', key)?.account_id;
}

/** Settings as shown to the merchant: secrets are never sent back. */
export function publicPushConfig(db: DatabaseSync, accountId: string, config: AppConfig) {
  const cfg = ensurePushConfig(db, accountId);
  const devices = all<{ platform: string; provider: string; n: number }>(
    db,
    'SELECT platform, provider, COUNT(*) AS n FROM push_devices WHERE account_id = ? AND active = 1 GROUP BY platform, provider',
    accountId,
  );
  const count = (filter: (d: { platform: string; provider: string }) => boolean) => devices.filter(filter).reduce((s, d) => s + Number(d.n), 0);
  return {
    app_key: cfg.app_key,
    mode: config.push.mode,
    fcm: cfg.fcm ? { configured: true, project_id: cfg.fcm.project_id, client_email: cfg.fcm.client_email } : { configured: false },
    apns: cfg.apns
      ? { configured: true, key_id: cfg.apns.key_id, team_id: cfg.apns.team_id, bundle_id: cfg.apns.bundle_id, production: cfg.apns.production }
      : { configured: false },
    expo: { configured: true, has_access_token: !!cfg.expo?.access_token },
    identity: { secret: cfg.identity_secret, required: cfg.require_identity },
    devices: {
      total: count(() => true),
      ios: count((d) => d.platform === 'ios'),
      android: count((d) => d.platform === 'android'),
      linked: scalar(db, 'SELECT COUNT(*) FROM push_devices WHERE account_id = ? AND active = 1 AND contact_id IS NOT NULL', accountId),
      by_provider: { fcm: count((d) => d.provider === 'fcm'), apns: count((d) => d.provider === 'apns'), expo: count((d) => d.provider === 'expo') },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

export const PLATFORMS = ['ios', 'android'] as const;
export const PROVIDERS = ['fcm', 'apns', 'expo'] as const;
export type PushProvider = (typeof PROVIDERS)[number];

export const deviceSchema = z.object({
  token: z.string().trim().min(8, zmsg('Jeton de notification invalide', 'Invalid notification token')).max(4096),
  platform: z.enum(PLATFORMS),
  provider: z.enum(PROVIDERS).optional(),
  email: z.string().trim().max(254).optional(),
  contact_id: z.string().trim().max(64).optional(),
  app_version: z.string().trim().max(40).optional(),
  /** HMAC-SHA256(identity_secret, email | contact_id), required when identity verification is on. */
  user_hash: z.string().trim().max(128).optional(),
});
export type DeviceInput = z.output<typeof deviceSchema>;

/** Expo tokens are recognisable; otherwise Android → FCM, iOS → APNs (an iOS app using Firebase sends provider: "fcm"). */
export function inferProvider(input: Pick<DeviceInput, 'token' | 'platform' | 'provider'>): PushProvider {
  if (input.provider) return input.provider;
  if (/^Expo(nent)?PushToken\[/.test(input.token)) return 'expo';
  return input.platform === 'android' ? 'fcm' : 'apns';
}

export function serializeDevice(row: Row) {
  return {
    id: String(row.id),
    platform: row.platform as 'ios' | 'android',
    provider: row.provider as PushProvider,
    token_preview: `${String(row.token).slice(0, 10)}…${String(row.token).slice(-6)}`,
    contact_id: (row.contact_id as string | null) ?? null,
    contact_email: (row.contact_email as string | null) ?? null,
    app_version: (row.app_version as string | null) ?? null,
    active: Number(row.active) === 1,
    created_at: String(row.created_at),
    last_seen_at: String(row.last_seen_at),
  };
}

/** Registers (or refreshes) a device token. The device is linked to an existing contact by id or email. */
export function registerDevice(db: DatabaseSync, accountId: string, input: DeviceInput) {
  const provider = inferProvider(input);
  let contactId: string | null = null;
  if (input.contact_id) {
    contactId = get<{ id: string }>(db, 'SELECT id FROM contacts WHERE id = ? AND account_id = ?', input.contact_id, accountId)?.id ?? null;
  } else if (input.email) {
    contactId =
      get<{ id: string }>(db, 'SELECT id FROM contacts WHERE account_id = ? AND email = ?', accountId, input.email.trim().toLowerCase())?.id ?? null;
  }
  const timestamp = now();
  const existing = get<{ id: string; contact_id: string | null }>(db, 'SELECT id, contact_id FROM push_devices WHERE account_id = ? AND token = ?', accountId, input.token);
  if (existing) {
    run(
      db,
      `UPDATE push_devices SET platform = ?, provider = ?, app_version = COALESCE(?, app_version),
              contact_id = CASE WHEN ? THEN ? ELSE contact_id END, active = 1, last_seen_at = ? WHERE id = ?`,
      input.platform,
      provider,
      input.app_version ?? null,
      // A new identity replaces the previous one (another customer signed in on this phone).
      input.email || input.contact_id ? 1 : 0,
      contactId,
      timestamp,
      existing.id,
    );
  } else {
    run(
      db,
      `INSERT INTO push_devices (id, account_id, contact_id, token, platform, provider, app_version, active, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      newId(),
      accountId,
      contactId,
      input.token,
      input.platform,
      provider,
      input.app_version ?? null,
      timestamp,
      timestamp,
    );
  }
  const row = get(
    db,
    'SELECT d.*, c.email AS contact_email FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.account_id = ? AND d.token = ?',
    accountId,
    input.token,
  )!;
  return { device: serializeDevice(row), created: !existing, linked: !!row.contact_id };
}

export function unregisterDevice(db: DatabaseSync, accountId: string, token: string): boolean {
  return run(db, 'UPDATE push_devices SET active = 0 WHERE account_id = ? AND token = ?', accountId, token) > 0;
}

/** The customer signed out: the device stays reachable but is no longer linked to them. */
export function logoutDevice(db: DatabaseSync, accountId: string, token: string): boolean {
  return run(db, 'UPDATE push_devices SET contact_id = NULL, last_seen_at = ? WHERE account_id = ? AND token = ?', now(), accountId, token) > 0;
}

/* -------------------------------------------------------------------------- */
/* In-app notification centre                                                 */
/* -------------------------------------------------------------------------- */

export function deviceByToken(db: DatabaseSync, accountId: string, token: string) {
  return get<{ id: string; contact_id: string | null }>(db, 'SELECT id, contact_id FROM push_devices WHERE account_id = ? AND token = ?', accountId, token);
}

/** Inbox scope of a device: its own messages plus, when signed in, every message of its contact. */
function inboxScope(device: { id: string; contact_id: string | null }): { sql: string; params: SQLInputValue[] } {
  return device.contact_id
    ? { sql: '(device_id = ? OR contact_id = ?)', params: [device.id, device.contact_id] }
    : { sql: 'device_id = ?', params: [device.id] };
}

export function inboxUnread(db: DatabaseSync, accountId: string, device: { id: string; contact_id: string | null }): number {
  const scope = inboxScope(device);
  return scalar(db, `SELECT COUNT(*) FROM app_inbox WHERE account_id = ? AND read_at IS NULL AND ${scope.sql}`, accountId, ...scope.params);
}

export function listInbox(db: DatabaseSync, accountId: string, device: { id: string; contact_id: string | null }, limit = 50, before?: string) {
  const scope = inboxScope(device);
  const rows = all(
    db,
    `SELECT id, title, body, image_url, url, created_at, read_at FROM app_inbox
      WHERE account_id = ? AND ${scope.sql}${before ? ' AND created_at < ?' : ''}
      ORDER BY created_at DESC LIMIT ?`,
    accountId,
    ...scope.params,
    ...(before ? [before] : []),
    limit,
  );
  return {
    data: rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      body: String(r.body),
      image_url: (r.image_url as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      created_at: String(r.created_at),
      read: !!r.read_at,
    })),
    unread: inboxUnread(db, accountId, device),
  };
}

/** Marks inbox items as read (all of them when `ids` is omitted). Returns the remaining unread count. */
export function markInboxRead(db: DatabaseSync, accountId: string, device: { id: string; contact_id: string | null }, ids?: string[]): number {
  const scope = inboxScope(device);
  if (ids && !ids.length) return inboxUnread(db, accountId, device);
  run(
    db,
    `UPDATE app_inbox SET read_at = ? WHERE account_id = ? AND read_at IS NULL AND ${scope.sql}${
      ids ? ` AND id IN (${ids.map(() => '?').join(',')})` : ''
    }`,
    now(),
    accountId,
    ...scope.params,
    ...(ids ?? []),
  );
  return inboxUnread(db, accountId, device);
}

export function removeInboxItems(db: DatabaseSync, accountId: string, device: { id: string; contact_id: string | null }, ids: string[]): number {
  if (!ids.length) return 0;
  const scope = inboxScope(device);
  return run(db, `DELETE FROM app_inbox WHERE account_id = ? AND ${scope.sql} AND id IN (${ids.map(() => '?').join(',')})`, accountId, ...scope.params, ...ids);
}

/* -------------------------------------------------------------------------- */
/* Messages, campaigns, audiences                                             */
/* -------------------------------------------------------------------------- */

export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('segment'), segment_id: z.string().min(1) }),
  z.object({ type: z.literal('tag'), tag: z.string().trim().min(1).max(64) }),
]);
export type PushAudience = z.output<typeof audienceSchema>;

export const pushContentSchema = z.object({
  title: z.string().trim().min(1, zmsg('Le titre est requis', 'Title is required')).max(120),
  body: z.string().trim().min(1, zmsg('Le texte est requis', 'Text is required')).max(500),
  image_url: z.string().trim().url().max(2000).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
});
export type PushContent = z.output<typeof pushContentSchema>;

/** `push` = system notification (lock screen, notification centre); `in_app` = notification centre inside the app. */
export const CHANNELS = ['push', 'in_app'] as const;
export type PushChannel = (typeof CHANNELS)[number];
export const channelsSchema = z
  .array(z.enum(CHANNELS))
  .min(1, zmsg('Choisissez au moins un canal : écran verrouillé ou dans l’app', 'Choose at least one channel: lock screen or in-app'))
  .transform((list) => [...new Set(list)]);

export interface Recipient {
  device_id: string;
  contact_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * SQL condition (on `d`, the device) of an audience; null when its segment no longer exists.
 * Correlated on the device's contact, so it can be evaluated a window of devices at a time.
 */
function audienceFilter(db: DatabaseSync, accountId: string, audience: PushAudience): { sql: string; params: SQLInputValue[] } | null {
  if (audience.type === 'segment') {
    const rules = loadSegmentRules(db, accountId, audience.segment_id);
    if (!rules) return null;
    const compiled = compileRules(rules);
    return {
      sql: ` AND EXISTS (SELECT 1 FROM contacts WHERE contacts.id = d.contact_id AND contacts.account_id = ? AND ${compiled.sql})`,
      params: [accountId, ...compiled.params],
    };
  }
  if (audience.type === 'tag') {
    return {
      sql: ` AND EXISTS (SELECT 1 FROM contacts WHERE contacts.id = d.contact_id AND contacts.account_id = ?
               AND EXISTS (SELECT 1 FROM json_each(contacts.tags) t WHERE lower(t.value) = lower(?)))`,
      params: [accountId, audience.tag],
    };
  }
  return { sql: '', params: [] };
}

const RECIPIENT_COLUMNS = `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.account_id = ? AND d.active = 1 AND (c.id IS NULL OR c.status != 'complained')`;

/** Active devices targeted by an audience (devices without a contact only match "all"). */
export function audienceDevices(db: DatabaseSync, accountId: string, audience: PushAudience): Recipient[] {
  const filter = audienceFilter(db, accountId, audience);
  if (!filter) return [];
  return all<Recipient>(db, `${RECIPIENT_COLUMNS}${filter.sql} ORDER BY d.created_at`, accountId, ...filter.params);
}

/** Number of devices an audience reaches, without loading them. */
export function audienceDeviceCount(db: DatabaseSync, accountId: string, audience: PushAudience): number {
  const filter = audienceFilter(db, accountId, audience);
  if (!filter) return 0;
  return scalar(db, `SELECT COUNT(*) FROM (${RECIPIENT_COLUMNS}${filter.sql})`, accountId, ...filter.params);
}

function personalise(text: string, r: Pick<Recipient, 'email' | 'first_name' | 'last_name'>): string {
  return applyMergeTags(text, { email: r.email ?? '', first_name: r.first_name, last_name: r.last_name }, '', 'text').trim();
}

function insertPushMessage(
  db: DatabaseSync,
  accountId: string,
  r: Recipient,
  content: PushContent,
  refs: { campaignId?: string | null; automationId?: string | null },
  inboxId: string | null,
  extra: { scheduledAt?: string | null; resend?: boolean } = {},
): void {
  run(
    db,
    `INSERT INTO push_messages (id, account_id, push_campaign_id, automation_id, device_id, contact_id, title, body, image_url, url, status, created_at, inbox_id, scheduled_at, resend)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    newId(),
    accountId,
    refs.campaignId ?? null,
    refs.automationId ?? null,
    r.device_id,
    r.contact_id,
    personalise(content.title, r),
    personalise(content.body, r),
    content.image_url ?? null,
    content.url ?? null,
    now(),
    inboxId,
    extra.scheduledAt ?? null,
    extra.resend ? 1 : 0,
  );
}

/* -------------------------------------------------------------------------- */
/* Smart send time                                                            */
/* -------------------------------------------------------------------------- */

/** Most frequent hour (UTC, 0-23) at which opens happened, for a contact or the whole account. */
function favouriteHour(db: DatabaseSync, accountId: string, contactId: string | null): number | null {
  const filter = contactId ? 'contact_id = ?' : 'account_id = ?';
  const id = contactId ?? accountId;
  const row = get<{ h: string; n: number }>(
    db,
    `SELECT h, COUNT(*) AS n FROM (
        SELECT strftime('%H', opened_at) AS h FROM push_messages WHERE ${filter} AND opened_at IS NOT NULL
        UNION ALL
        SELECT strftime('%H', opened_at) AS h FROM messages WHERE ${filter} AND opened_at IS NOT NULL
     ) GROUP BY h ORDER BY n DESC, h LIMIT 1`,
    id,
    id,
  );
  return row?.h ? Number(row.h) : null;
}

/**
 * Smart send time: the next occurrence (within 24 h) of the hour this customer usually opens
 * notifications or emails; the account's best hour for customers without history; now otherwise.
 */
export function smartSendTime(
  db: DatabaseSync,
  accountId: string,
  contactId: string | null,
  cache: Map<string, number | null> = new Map(),
  from = new Date(),
): string | null {
  const key = contactId ?? '';
  if (!cache.has(key)) cache.set(key, contactId ? favouriteHour(db, accountId, contactId) : null);
  if (!cache.has('__account')) cache.set('__account', favouriteHour(db, accountId, null));
  const hour = cache.get(key) ?? cache.get('__account') ?? null;
  if (hour === null) return null;
  const at = new Date(from);
  at.setUTCHours(hour, 0, 0, 0);
  if (at.getTime() <= from.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  // Already within the hour: send right away rather than tomorrow.
  if (at.getTime() - from.getTime() > 23 * 3_600_000) return null;
  return at.toISOString();
}

/**
 * Fans content out to recipients: one in-app inbox entry per person (per contact, or per anonymous
 * device) and one system push per device. Returns the number of push messages queued.
 */
export function queueContent(
  db: DatabaseSync,
  accountId: string,
  recipients: Recipient[],
  content: PushContent,
  refs: { campaignId?: string | null; automationId?: string | null },
  channels: readonly PushChannel[],
  scope: 'contact' | 'device' = 'contact',
  /**
   * `reuseCampaignInbox`: a campaign queued a window of devices at a time; a contact whose devices fall in two
   * windows keeps the inbox entry created by the first one (one entry per person and campaign).
   */
  options: { smart?: boolean; resend?: boolean; inboxId?: string | null; reuseCampaignInbox?: boolean } = {},
): { pushes: number; inbox: number } {
  const hours = new Map<string, number | null>();
  const groups = new Map<string, Recipient[]>();
  for (const r of recipients) {
    const key = scope === 'contact' && r.contact_id ? `c:${r.contact_id}` : `d:${r.device_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let pushes = 0;
  let inbox = 0;
  const timestamp = now();
  for (const [key, members] of groups) {
    const first = members[0];
    let inboxId: string | null = options.inboxId ?? null;
    const existing =
      options.reuseCampaignInbox && refs.campaignId && key.startsWith('c:') && channels.includes('in_app')
        ? get<{ id: string }>(db, 'SELECT id FROM app_inbox WHERE push_campaign_id = ? AND contact_id = ? LIMIT 1', refs.campaignId, first.contact_id)
        : undefined;
    if (existing) {
      inboxId = existing.id;
    } else if (channels.includes('in_app')) {
      inboxId = newId();
      const byContact = key.startsWith('c:');
      run(
        db,
        `INSERT INTO app_inbox (id, account_id, contact_id, device_id, push_campaign_id, automation_id, title, body, image_url, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        inboxId,
        accountId,
        byContact ? first.contact_id : null,
        byContact ? null : first.device_id,
        refs.campaignId ?? null,
        refs.automationId ?? null,
        personalise(content.title, first),
        personalise(content.body, first),
        content.image_url ?? null,
        content.url ?? null,
        timestamp,
      );
      inbox++;
    }
    if (channels.includes('push')) {
      const scheduledAt = options.smart ? smartSendTime(db, accountId, first.contact_id, hours) : null;
      for (const r of members) insertPushMessage(db, accountId, r, content, refs, inboxId, { scheduledAt, resend: options.resend });
      pushes += members.length;
    }
  }
  return { pushes, inbox };
}

/** Queues a push to every active device of a contact (automation step). Returns the number of devices. */
export function queuePushForContact(
  db: DatabaseSync,
  accountId: string,
  contactId: string,
  content: PushContent,
  automationId: string | null,
  channels: readonly PushChannel[] = CHANNELS,
): number {
  const recipients = all<Recipient>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d JOIN contacts c ON c.id = d.contact_id
      WHERE d.account_id = ? AND d.contact_id = ? AND d.active = 1`,
    accountId,
    contactId,
  );
  queueContent(db, accountId, recipients, content, { automationId }, channels);
  return recipients.length;
}

/** Queues a single test push to one device (sent on the next worker tick). */
export function queueTestPush(
  db: DatabaseSync,
  accountId: string,
  deviceId: string,
  content: PushContent,
  channels: readonly PushChannel[] = CHANNELS,
): boolean {
  const r = get<Recipient>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ? AND d.account_id = ? AND d.active = 1`,
    deviceId,
    accountId,
  );
  if (!r) return false;
  // A test only lands in this device's inbox, never in the whole contact's history.
  queueContent(db, accountId, [r], content, {}, channels, 'device');
  return true;
}

export function serializePushCampaign(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    title: String(row.title),
    body: String(row.body),
    image_url: (row.image_url as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    audience: parseJson<PushAudience>(row.audience, { type: 'all' }),
    channels: parseJson<PushChannel[]>(row.channels, [...CHANNELS]),
    send_mode: (row.send_mode === 'smart' ? 'smart' : 'now') as 'now' | 'smart',
    resend: {
      after_hours: row.resend_after_hours == null ? null : Number(row.resend_after_hours),
      title: (row.resend_title as string | null) ?? null,
      body: (row.resend_body as string | null) ?? null,
      queued_at: (row.resend_queued_at as string | null) ?? null,
    },
    status: row.status as 'draft' | 'sending' | 'sent',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    sent_at: (row.sent_at as string | null) ?? null,
  };
}

export function pushCampaignStats(db: DatabaseSync, campaignId: string) {
  const row = get<{ total: number; sent: number; failed: number; queued: number; opened: number }>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'queued') AS queued,
            SUM(opened_at IS NOT NULL) AS opened
       FROM push_messages WHERE push_campaign_id = ? AND resend = 0`,
    campaignId,
  );
  const resend = get<{ total: number; sent: number; opened: number }>(
    db,
    `SELECT COUNT(*) AS total, SUM(status = 'sent') AS sent, SUM(opened_at IS NOT NULL) AS opened
       FROM push_messages WHERE push_campaign_id = ? AND resend = 1`,
    campaignId,
  );
  const scheduled = scalar(db, "SELECT COUNT(*) FROM push_messages WHERE push_campaign_id = ? AND status = 'queued' AND scheduled_at > ?", campaignId, now());
  const resendSent = Number(resend?.sent ?? 0);
  const resendOpened = Number(resend?.opened ?? 0);
  const sent = Number(row?.sent ?? 0);
  const opened = Number(row?.opened ?? 0);
  const inbox = get<{ total: number; read: number }>(
    db,
    'SELECT COUNT(*) AS total, SUM(read_at IS NOT NULL) AS read FROM app_inbox WHERE push_campaign_id = ?',
    campaignId,
  );
  const inboxTotal = Number(inbox?.total ?? 0);
  const inboxRead = Number(inbox?.read ?? 0);
  return {
    in_app: { total: inboxTotal, read: inboxRead, read_rate: inboxTotal ? Math.round((inboxRead / inboxTotal) * 1000) / 10 : 0 },
    resend: { total: Number(resend?.total ?? 0), sent: resendSent, opened: resendOpened, open_rate: resendSent ? Math.round((resendOpened / resendSent) * 1000) / 10 : 0 },
    scheduled,
    total: Number(row?.total ?? 0),
    sent,
    failed: Number(row?.failed ?? 0),
    queued: Number(row?.queued ?? 0),
    opened,
    open_rate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
  };
}

/** Devices queued per transaction (sized for ~20 ms, COMMIT included), and longest stretch of queueing per call. */
const queueBatch = new AdaptiveBatch(250, 25, 2000);
const QUEUE_BUDGET_MS = 50;

/** Upper rowid of the next window of the account's active devices after `after` (MAX_SAFE_INTEGER: last one). */
function deviceWindow(db: DatabaseSync, accountId: string, after: number, size: number): number {
  const row = get<{ r: number }>(
    db,
    'SELECT rowid AS r FROM push_devices WHERE account_id = ? AND active = 1 AND rowid > ? ORDER BY rowid LIMIT 1 OFFSET ?',
    accountId,
    after,
    size - 1,
  );
  return row ? Number(row.r) : Number.MAX_SAFE_INTEGER;
}

/**
 * Queues messages for push campaigns in `sending` state, a window of devices per transaction (~20 ms), from a
 * cursor kept on the campaign (queue_cursor): ~50 ms per call at most, the rest on the next tick. The campaign
 * gets `queued_at` once every device was looked at (finalizePushCampaigns waits for it). Idempotent.
 */
export function queuePushCampaigns(db: DatabaseSync): number {
  const deadline = Date.now() + QUEUE_BUDGET_MS;
  queueBatch.start();
  const campaigns = all(db, "SELECT * FROM push_campaigns WHERE status = 'sending' AND queued_at IS NULL ORDER BY created_at").map((row) => ({
    ...serializePushCampaign(row),
    account_id: String(row.account_id),
    cursor: Number(row.queue_cursor ?? 0),
  }));
  let queued = 0;
  for (const c of campaigns) {
    if (Date.now() >= deadline) break;
    try {
      const filter = audienceFilter(db, c.account_id, c.audience);
      let cursor = c.cursor;
      let finished = false;
      while (!finished && queueBatch.fits(deadline)) {
        queueBatch.measure(() => transaction(db, () => {
          const end = filter ? deviceWindow(db, c.account_id, cursor, queueBatch.size) : Number.MAX_SAFE_INTEGER;
          const recipients = filter
            ? all<Recipient>(db, `${RECIPIENT_COLUMNS} AND d.rowid > ? AND d.rowid <= ?${filter.sql} ORDER BY d.rowid`, c.account_id, cursor, end, ...filter.params)
            : [];
          const result = queueContent(db, c.account_id, recipients, c, { campaignId: c.id }, c.channels, 'contact', {
            smart: c.send_mode === 'smart',
            reuseCampaignInbox: true,
          });
          queued += result.pushes;
          cursor = end;
          finished = end === Number.MAX_SAFE_INTEGER;
          if (!finished) {
            run(db, 'UPDATE push_campaigns SET queue_cursor = ? WHERE id = ?', end, c.id);
            return;
          }
          run(db, 'UPDATE push_campaigns SET queue_cursor = ?, queued_at = ? WHERE id = ?', end, now(), c.id);
          // In-app only (or nobody): nothing to deliver through Apple / Google, the campaign is done.
          const pushes = get(db, 'SELECT 1 FROM push_messages INDEXED BY idx_push_messages_campaign_sent WHERE push_campaign_id = ? AND resend = 0 LIMIT 1', c.id);
          if (!pushes) run(db, "UPDATE push_campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", now(), now(), c.id);
        }));
      }
    } catch (err) {
      // This campaign is retried on the next tick; the others go on.
      console.error(`[worker] mise en file de la campagne push ${c.id} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return queued;
}

/** Campaigns fully queued whose every first delivery left: `sent` (index probes only, whatever their size). */
export function finalizePushCampaigns(db: DatabaseSync): void {
  run(
    db,
    `UPDATE push_campaigns SET status = 'sent', sent_at = ?, updated_at = ?
      WHERE status = 'sending' AND queued_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM push_messages m INDEXED BY idx_push_messages_campaign_sent WHERE m.push_campaign_id = push_campaigns.id AND m.resend = 0)
        AND NOT EXISTS (SELECT 1 FROM push_messages m INDEXED BY idx_push_messages_campaign_sent
                         WHERE m.push_campaign_id = push_campaigns.id AND m.resend = 0 AND m.status = 'queued')`,
    now(),
    now(),
  );
}

/** Records an open reported by the app (idempotent). */
export function markPushOpened(db: DatabaseSync, accountId: string, messageId: string): boolean {
  const timestamp = now();
  const changed = run(db, 'UPDATE push_messages SET opened_at = COALESCE(opened_at, ?) WHERE id = ? AND account_id = ?', timestamp, messageId, accountId) > 0;
  // Opening the notification also reads it in the in-app notification centre.
  run(
    db,
    'UPDATE app_inbox SET read_at = COALESCE(read_at, ?) WHERE account_id = ? AND id = (SELECT inbox_id FROM push_messages WHERE id = ? AND account_id = ?)',
    timestamp,
    accountId,
    messageId,
    accountId,
  );
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

export interface PushPayload {
  messageId: string;
  token: string;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  /** In-app inbox entry linked to this notification, if any. */
  inboxId?: string | null;
  /** Unread in-app notifications, shown as the app icon badge. */
  badge?: number;
}

/** Android notification channel the SDK creates (high importance, visible on the lock screen). */
export const ANDROID_CHANNEL_ID = 'pingsell';

function payloadData(p: PushPayload): Record<string, string> {
  const data: Record<string, string> = { pingsell_message_id: p.messageId };
  if (p.inboxId) data.pingsell_inbox_id = p.inboxId;
  if (p.url) data.url = p.url;
  if (p.imageUrl) data.image_url = p.imageUrl;
  return data;
}

export type PushOutcome = { ok: true; providerId: string } | { ok: false; error: string; invalidToken: boolean };

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * Every call to Apple / Google / Expo gives up after this delay (body included): a provider that hangs
 * must never hold the worker. deliverPush adds an outer guard on top, whatever the provider.
 */
const PUSH_TIMEOUT_MS = 10_000;
const DELIVER_GUARD_MS = 15_000;

const fcmTokens = new Map<string, { token: string; expiresAt: number }>();

/** OAuth2 access token for the FCM HTTP v1 API, from a Google service account (JWT bearer grant). */
async function fcmAccessToken(creds: FcmCredentials): Promise<string> {
  const cacheKey = `${creds.client_email}:${createHash('sha256').update(creds.private_key).digest('base64url')}`;
  const cached = fcmTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: creds.token_uri,
      iat,
      exp: iat + 3600,
    }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(creds.private_key);
  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(t(`Authentification Firebase refusée : ${data.error_description ?? res.status}`, `Firebase authentication refused: ${data.error_description ?? res.status}`));
  fcmTokens.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

async function sendFcm(config: AppConfig, creds: FcmCredentials, p: PushPayload): Promise<PushOutcome> {
  const accessToken = await fcmAccessToken(creds);
  const data = payloadData(p);
  const res = await fetch(`${config.push.fcmUrl}/v1/projects/${encodeURIComponent(creds.project_id)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: p.token,
        notification: { title: p.title, body: p.body, ...(p.imageUrl ? { image: p.imageUrl } : {}) },
        data,
        android: {
          priority: 'high',
          notification: {
            channel_id: ANDROID_CHANNEL_ID,
            visibility: 'PUBLIC', // full content on the lock screen
            default_sound: true,
            ...(p.badge !== undefined ? { notification_count: p.badge } : {}),
          },
        },
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
          payload: {
            aps: { sound: 'default', 'mutable-content': 1, 'thread-id': 'pingsell', ...(p.badge !== undefined ? { badge: p.badge } : {}) },
          },
          ...(p.imageUrl ? { fcm_options: { image: p.imageUrl } } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    error?: { message?: string; status?: string; details?: Array<{ errorCode?: string }> };
  };
  if (res.ok && json.name) return { ok: true, providerId: json.name };
  const code = json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status ?? String(res.status);
  return {
    ok: false,
    error: `FCM ${code}${json.error?.message ? t(` : ${json.error.message}`, `: ${json.error.message}`) : ''}`,
    invalidToken: code === 'UNREGISTERED' || res.status === 404,
  };
}

const apnsTokens = new Map<string, { token: string; issuedAt: number }>();

/** Provider token for APNs (ES256 JWT, valid 1 h; refreshed every 50 min as Apple recommends). */
function apnsJwt(creds: ApnsCredentials): string {
  // The key itself is part of the cache key: replacing the .p8 must not reuse a token signed with the old one.
  const cacheKey = `${creds.team_id}:${creds.key_id}:${createHash('sha256').update(creds.key_p8).digest('base64url')}`;
  const cached = apnsTokens.get(cacheKey);
  if (cached && Date.now() - cached.issuedAt < 50 * 60_000) return cached.token;
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: creds.key_id }))}.${b64url(
    JSON.stringify({ iss: creds.team_id, iat: Math.floor(Date.now() / 1000) }),
  )}`;
  const signature = cryptoSign('sha256', Buffer.from(unsigned), { key: creds.key_p8, dsaEncoding: 'ieee-p1363' });
  const token = `${unsigned}.${b64url(signature)}`;
  apnsTokens.set(cacheKey, { token, issuedAt: Date.now() });
  return token;
}

/**
 * One HTTP/2 connection per APNs origin and signing key, reused for every notification (Apple asks providers
 * to keep connections open rather than open one per push). Dropped on error, GOAWAY or a minute idle.
 */
const apnsSessions = new Map<string, ClientHttp2Session>();

function apnsSession(origin: string, key: string): ClientHttp2Session {
  const cached = apnsSessions.get(key);
  if (cached && !cached.closed && !cached.destroyed) return cached;
  const session = http2Connect(origin);
  apnsSessions.set(key, session);
  const forget = () => {
    if (apnsSessions.get(key) === session) apnsSessions.delete(key);
  };
  session.on('error', () => {
    forget();
    session.destroy();
  });
  session.on('goaway', forget);
  session.on('close', forget);
  session.setTimeout(60_000, () => {
    forget();
    session.close();
  });
  // An idle connection never keeps the process alive.
  session.unref();
  return session;
}

function sendApns(config: AppConfig, creds: ApnsCredentials, p: PushPayload): Promise<PushOutcome> {
  const origin = creds.production ? config.push.apnsProductionUrl : config.push.apnsSandboxUrl;
  const body = JSON.stringify({
    aps: {
      alert: { title: p.title, body: p.body },
      sound: 'default',
      'mutable-content': 1,
      'thread-id': 'pingsell',
      'interruption-level': 'active',
      ...(p.badge !== undefined ? { badge: p.badge } : {}),
    },
    ...payloadData(p),
  });
  return new Promise((resolve) => {
    const session = apnsSession(origin, `${origin}|${creds.team_id}|${creds.key_id}`);
    let settled = false;
    let req: ClientHttp2Stream | undefined;
    const done = (outcome: PushOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.off('error', onSessionError);
      resolve(outcome);
    };
    const onSessionError = (err: Error) => done({ ok: false, error: t(`APNs injoignable : ${err.message}`, `APNs unreachable: ${err.message}`), invalidToken: false });
    const timer = setTimeout(() => {
      // Still connecting after the delay: that connection is useless, the next notification opens a new one.
      if (session.connecting) session.destroy();
      if (req && !req.closed) req.close(http2Constants.NGHTTP2_CANCEL);
      done({ ok: false, error: t('APNs : pas de réponse (délai dépassé)', 'APNs: no answer (timed out)'), invalidToken: false });
    }, PUSH_TIMEOUT_MS);
    session.once('error', onSessionError);
    try {
      req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(p.token)}`,
        authorization: `bearer ${apnsJwt(creds)}`,
        'apns-topic': creds.bundle_id,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (err) {
      session.destroy();
      return done({ ok: false, error: t(`APNs : ${(err as Error).message}`, `APNs: ${(err as Error).message}`), invalidToken: false });
    }
    let status = 0;
    let apnsId = '';
    let raw = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => {
      status = Number(headers[':status']);
      apnsId = String(headers['apns-id'] ?? '');
    });
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      if (status === 200) return done({ ok: true, providerId: apnsId || `apns_${p.messageId}` });
      const reason = (parseJson<{ reason?: string }>(raw, {}).reason ?? String(status)) || 'Erreur';
      done({
        ok: false,
        error: `APNs ${reason}`,
        invalidToken: status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason),
      });
    });
    req.on('error', (err) => done({ ok: false, error: t(`APNs : ${err.message}`, `APNs: ${err.message}`), invalidToken: false }));
    req.end(body);
  });
}

async function sendExpo(config: AppConfig, creds: ExpoCredentials | null, p: PushPayload): Promise<PushOutcome> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (creds?.access_token) headers.authorization = `Bearer ${creds.access_token}`;
  const res = await fetch(config.push.expoUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        to: p.token,
        title: p.title,
        body: p.body,
        sound: 'default',
        priority: 'high',
        channelId: ANDROID_CHANNEL_ID,
        ...(p.badge !== undefined ? { badge: p.badge } : {}),
        data: payloadData(p),
        ...(p.imageUrl ? { richContent: { image: p.imageUrl } } : {}),
      },
    ]),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }>;
    errors?: Array<{ message?: string }>;
  };
  const ticket = json.data?.[0];
  if (res.ok && ticket?.status === 'ok') return { ok: true, providerId: ticket.id ?? `expo_${p.messageId}` };
  const code = ticket?.details?.error ?? json.errors?.[0]?.message ?? String(res.status);
  return { ok: false, error: `Expo ${code}${ticket?.message ? t(` : ${ticket.message}`, `: ${ticket.message}`) : ''}`, invalidToken: code === 'DeviceNotRegistered' };
}

export async function deliverPush(config: AppConfig, cfg: PushConfig, provider: PushProvider, p: PushPayload): Promise<PushOutcome> {
  if (config.push.mode === 'log') {
    console.log(`[push:log] ${provider} → ${p.token.slice(0, 16)}… « ${p.title} » (${p.messageId})`);
    return { ok: true, providerId: `log_${p.messageId}` };
  }
  let guard: NodeJS.Timeout | undefined;
  try {
    const call = (async (): Promise<PushOutcome> => {
      if (provider === 'expo') return sendExpo(config, cfg.expo, p);
      if (provider === 'fcm') {
        if (!cfg.fcm) return { ok: false, error: t('Firebase (FCM) n’est pas configuré', 'Firebase (FCM) isn’t configured'), invalidToken: false };
        return sendFcm(config, cfg.fcm, p);
      }
      if (!cfg.apns) return { ok: false, error: t('Apple (APNs) n’est pas configuré', 'Apple (APNs) isn’t configured'), invalidToken: false };
      return sendApns(config, cfg.apns, p);
    })();
    // Outer guard: whatever the provider does, the worker gets an answer.
    const timeout = new Promise<PushOutcome>((resolve) => {
      guard = setTimeout(() => resolve({ ok: false, error: t(`${provider} : pas de réponse (délai dépassé)`, `${provider}: no answer (timed out)`), invalidToken: false }), DELIVER_GUARD_MS);
    });
    return await Promise.race([call, timeout]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), invalidToken: false };
  } finally {
    clearTimeout(guard);
  }
}

/** A batch stops taking new messages after this long (slow providers): the rest waits for the next tick. */
const BATCH_BUDGET_MS = 30_000;

type QueuedPush = {
  id: string;
  account_id: string;
  device_id: string;
  device_contact_id: string | null;
  token: string;
  provider: PushProvider;
  title: string;
  body: string;
  image_url: string | null;
  url: string | null;
  inbox_id: string | null;
};

/**
 * Sends queued push messages; invalid tokens deactivate their device. Returns the number processed.
 * Due smart-scheduled messages first, then the unscheduled queue: both read in index order, so millions of
 * notifications scheduled for later cost nothing here.
 */
export async function sendPushBatch(db: DatabaseSync, config: AppConfig, limit: number): Promise<number> {
  const cols = `SELECT m.id, m.account_id, m.device_id, d.contact_id AS device_contact_id, d.token, d.provider, m.title, m.body, m.image_url, m.url, m.inbox_id
       FROM push_messages m INDEXED BY idx_push_messages_due JOIN push_devices d ON d.id = m.device_id`;
  const batch = all<QueuedPush>(db, `${cols} WHERE m.status = 'queued' AND m.scheduled_at <= ? ORDER BY m.scheduled_at LIMIT ?`, now(), limit);
  if (batch.length < limit) batch.push(...all<QueuedPush>(db, `${cols} WHERE m.status = 'queued' AND m.scheduled_at IS NULL ORDER BY m.created_at LIMIT ?`, limit - batch.length));
  const configs = new Map<string, PushConfig>();
  const started = Date.now();
  let processed = 0;
  for (const m of batch) {
    if (Date.now() - started > BATCH_BUDGET_MS) break;
    processed++;
    try {
      let cfg = configs.get(m.account_id);
      if (!cfg) {
        cfg = ensurePushConfig(db, m.account_id);
        configs.set(m.account_id, cfg);
      }
      // Delivery errors are stored for the merchant: written in the account's language.
      const outcome = await withAccountLang(db, m.account_id, () =>
        deliverPush(config, cfg, m.provider, {
          messageId: m.id,
          token: m.token,
          title: m.title,
          body: m.body,
          imageUrl: m.image_url,
          url: m.url,
          inboxId: m.inbox_id,
          badge: inboxUnread(db, m.account_id, { id: m.device_id, contact_id: m.device_contact_id }),
        }),
      );
      if (outcome.ok) {
        run(db, "UPDATE push_messages SET status = 'sent', provider_id = ?, error = NULL, sent_at = ? WHERE id = ?", outcome.providerId, now(), m.id);
      } else {
        run(db, "UPDATE push_messages SET status = 'failed', error = ? WHERE id = ?", outcome.error.slice(0, 1000), m.id);
        if (outcome.invalidToken) run(db, 'UPDATE push_devices SET active = 0 WHERE id = ?', m.device_id);
      }
    } catch (err) {
      // One broken row (deleted config, bad data) is marked failed and never blocks the queue.
      run(db, "UPDATE push_messages SET status = 'failed', error = ? WHERE id = ? AND status = 'queued'", (err instanceof Error ? err.message : String(err)).slice(0, 1000), m.id);
    }
  }
  return processed;
}

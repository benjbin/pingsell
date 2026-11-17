import { createSign, randomBytes, sign as cryptoSign } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { applyMergeTags } from './render.js';
import { compileRules, loadSegmentRules } from './segments.js';

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
  key_p8: z.string().includes('PRIVATE KEY', { message: 'La clé .p8 doit contenir « BEGIN PRIVATE KEY »' }),
  key_id: z.string().trim().regex(/^[A-Z0-9]{10}$/, 'Key ID : 10 caractères (lettres majuscules et chiffres)'),
  team_id: z.string().trim().regex(/^[A-Z0-9]{10}$/, 'Team ID : 10 caractères (lettres majuscules et chiffres)'),
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
}

const newAppKey = () => `msvapp_${randomBytes(18).toString('base64url')}`;

/** Push settings of an account; created on first access (with its public app key). */
export function ensurePushConfig(db: DatabaseSync, accountId: string): PushConfig {
  let row = get(db, 'SELECT * FROM push_config WHERE account_id = ?', accountId);
  if (!row) {
    run(db, 'INSERT INTO push_config (account_id, app_key, updated_at) VALUES (?, ?, ?)', accountId, newAppKey(), now());
    row = get(db, 'SELECT * FROM push_config WHERE account_id = ?', accountId)!;
  }
  return {
    app_key: String(row.app_key),
    fcm: parseJson<FcmCredentials | null>(row.fcm, null),
    apns: parseJson<ApnsCredentials | null>(row.apns, null),
    expo: parseJson<ExpoCredentials | null>(row.expo, null),
  };
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
  token: z.string().trim().min(8, 'Jeton de notification invalide').max(4096),
  platform: z.enum(PLATFORMS),
  provider: z.enum(PROVIDERS).optional(),
  email: z.string().trim().max(254).optional(),
  contact_id: z.string().trim().max(64).optional(),
  app_version: z.string().trim().max(40).optional(),
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
      `UPDATE push_devices SET platform = ?, provider = ?, app_version = COALESCE(?, app_version), contact_id = COALESCE(?, contact_id),
              active = 1, last_seen_at = ? WHERE id = ?`,
      input.platform,
      provider,
      input.app_version ?? null,
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
  title: z.string().trim().min(1, 'Le titre est requis').max(120),
  body: z.string().trim().min(1, 'Le texte est requis').max(500),
  image_url: z.string().trim().url().max(2000).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
});
export type PushContent = z.output<typeof pushContentSchema>;

interface Recipient {
  device_id: string;
  contact_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** Active devices targeted by an audience (devices without a contact only match "all"). */
export function audienceDevices(db: DatabaseSync, accountId: string, audience: PushAudience): Recipient[] {
  let filter = '';
  const params: SQLInputValue[] = [accountId];
  if (audience.type === 'segment') {
    const rules = loadSegmentRules(db, accountId, audience.segment_id);
    if (!rules) return [];
    const compiled = compileRules(rules);
    filter = ` AND d.contact_id IN (SELECT id FROM contacts WHERE account_id = ? AND ${compiled.sql})`;
    params.push(accountId, ...compiled.params);
  } else if (audience.type === 'tag') {
    filter = ` AND d.contact_id IN (SELECT id FROM contacts WHERE account_id = ? AND EXISTS (SELECT 1 FROM json_each(contacts.tags) t WHERE lower(t.value) = lower(?)))`;
    params.push(accountId, audience.tag);
  }
  return all<Recipient>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.account_id = ? AND d.active = 1${filter}
      ORDER BY d.created_at`,
    ...params,
  );
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
): void {
  run(
    db,
    `INSERT INTO push_messages (id, account_id, push_campaign_id, automation_id, device_id, contact_id, title, body, image_url, url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
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
  );
}

/** Queues a push to every active device of a contact (automation step). Returns the number of devices. */
export function queuePushForContact(
  db: DatabaseSync,
  accountId: string,
  contactId: string,
  content: PushContent,
  automationId: string | null,
): number {
  const recipients = all<Recipient>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d JOIN contacts c ON c.id = d.contact_id
      WHERE d.account_id = ? AND d.contact_id = ? AND d.active = 1`,
    accountId,
    contactId,
  );
  for (const r of recipients) insertPushMessage(db, accountId, r, content, { automationId });
  return recipients.length;
}

/** Queues a single test push to one device (sent on the next worker tick). */
export function queueTestPush(db: DatabaseSync, accountId: string, deviceId: string, content: PushContent): boolean {
  const r = get<Recipient>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id WHERE d.id = ? AND d.account_id = ? AND d.active = 1`,
    deviceId,
    accountId,
  );
  if (!r) return false;
  insertPushMessage(db, accountId, r, content, {});
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
       FROM push_messages WHERE push_campaign_id = ?`,
    campaignId,
  );
  const sent = Number(row?.sent ?? 0);
  const opened = Number(row?.opened ?? 0);
  return {
    total: Number(row?.total ?? 0),
    sent,
    failed: Number(row?.failed ?? 0),
    queued: Number(row?.queued ?? 0),
    opened,
    open_rate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
  };
}

/** Queues messages for push campaigns in `sending` state (idempotent). */
export function queuePushCampaigns(db: DatabaseSync): number {
  const campaigns = all(
    db,
    `SELECT * FROM push_campaigns c WHERE c.status = 'sending' AND NOT EXISTS (SELECT 1 FROM push_messages m WHERE m.push_campaign_id = c.id)`,
  ).map(serializePushCampaign);
  let queued = 0;
  for (const c of campaigns) {
    transaction(db, () => {
      const accountId = String(get<{ account_id: string }>(db, 'SELECT account_id FROM push_campaigns WHERE id = ?', c.id)!.account_id);
      const recipients = audienceDevices(db, accountId, c.audience);
      for (const r of recipients) insertPushMessage(db, accountId, r, c, { campaignId: c.id });
      if (!recipients.length) run(db, "UPDATE push_campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", now(), now(), c.id);
      queued += recipients.length;
    });
  }
  return queued;
}

export function finalizePushCampaigns(db: DatabaseSync): void {
  run(
    db,
    `UPDATE push_campaigns SET status = 'sent', sent_at = ?, updated_at = ?
      WHERE status = 'sending'
        AND EXISTS (SELECT 1 FROM push_messages m WHERE m.push_campaign_id = push_campaigns.id)
        AND NOT EXISTS (SELECT 1 FROM push_messages m WHERE m.push_campaign_id = push_campaigns.id AND m.status = 'queued')`,
    now(),
    now(),
  );
}

/** Records an open reported by the app (idempotent). */
export function markPushOpened(db: DatabaseSync, accountId: string, messageId: string): boolean {
  return run(db, 'UPDATE push_messages SET opened_at = COALESCE(opened_at, ?) WHERE id = ? AND account_id = ?', now(), messageId, accountId) > 0;
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
}

export type PushOutcome = { ok: true; providerId: string } | { ok: false; error: string; invalidToken: boolean };

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

const fcmTokens = new Map<string, { token: string; expiresAt: number }>();

/** OAuth2 access token for the FCM HTTP v1 API, from a Google service account (JWT bearer grant). */
async function fcmAccessToken(creds: FcmCredentials): Promise<string> {
  const cached = fcmTokens.get(creds.client_email);
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
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Authentification Firebase refusée : ${data.error_description ?? res.status}`);
  fcmTokens.set(creds.client_email, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

async function sendFcm(config: AppConfig, creds: FcmCredentials, p: PushPayload): Promise<PushOutcome> {
  const accessToken = await fcmAccessToken(creds);
  const data: Record<string, string> = { missive_message_id: p.messageId };
  if (p.url) data.url = p.url;
  const res = await fetch(`${config.push.fcmUrl}/v1/projects/${encodeURIComponent(creds.project_id)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: p.token,
        notification: { title: p.title, body: p.body, ...(p.imageUrl ? { image: p.imageUrl } : {}) },
        data,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default', 'mutable-content': 1 } }, ...(p.imageUrl ? { fcm_options: { image: p.imageUrl } } : {}) },
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    error?: { message?: string; status?: string; details?: Array<{ errorCode?: string }> };
  };
  if (res.ok && json.name) return { ok: true, providerId: json.name };
  const code = json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status ?? String(res.status);
  return {
    ok: false,
    error: `FCM ${code}${json.error?.message ? ` : ${json.error.message}` : ''}`,
    invalidToken: code === 'UNREGISTERED' || res.status === 404,
  };
}

const apnsTokens = new Map<string, { token: string; issuedAt: number }>();

/** Provider token for APNs (ES256 JWT, valid 1 h; refreshed every 50 min as Apple recommends). */
function apnsJwt(creds: ApnsCredentials): string {
  const cacheKey = `${creds.team_id}:${creds.key_id}`;
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

function sendApns(config: AppConfig, creds: ApnsCredentials, p: PushPayload): Promise<PushOutcome> {
  const origin = creds.production ? config.push.apnsProductionUrl : config.push.apnsSandboxUrl;
  const body = JSON.stringify({
    aps: { alert: { title: p.title, body: p.body }, sound: 'default', 'mutable-content': 1 },
    missive_message_id: p.messageId,
    ...(p.url ? { url: p.url } : {}),
    ...(p.imageUrl ? { image_url: p.imageUrl } : {}),
  });
  return new Promise((resolve) => {
    const session = http2Connect(origin);
    const done = (outcome: PushOutcome) => {
      session.close();
      resolve(outcome);
    };
    session.on('error', (err) => done({ ok: false, error: `APNs injoignable : ${err.message}`, invalidToken: false }));
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${encodeURIComponent(p.token)}`,
      authorization: `bearer ${apnsJwt(creds)}`,
      'apns-topic': creds.bundle_id,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
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
    req.on('error', (err) => done({ ok: false, error: `APNs : ${err.message}`, invalidToken: false }));
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
        data: { missive_message_id: p.messageId, ...(p.url ? { url: p.url } : {}) },
        ...(p.imageUrl ? { richContent: { image: p.imageUrl } } : {}),
      },
    ]),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }>;
    errors?: Array<{ message?: string }>;
  };
  const ticket = json.data?.[0];
  if (res.ok && ticket?.status === 'ok') return { ok: true, providerId: ticket.id ?? `expo_${p.messageId}` };
  const code = ticket?.details?.error ?? json.errors?.[0]?.message ?? String(res.status);
  return { ok: false, error: `Expo ${code}${ticket?.message ? ` : ${ticket.message}` : ''}`, invalidToken: code === 'DeviceNotRegistered' };
}

export async function deliverPush(config: AppConfig, cfg: PushConfig, provider: PushProvider, p: PushPayload): Promise<PushOutcome> {
  if (config.push.mode === 'log') {
    console.log(`[push:log] ${provider} → ${p.token.slice(0, 16)}… « ${p.title} » (${p.messageId})`);
    return { ok: true, providerId: `log_${p.messageId}` };
  }
  try {
    if (provider === 'expo') return await sendExpo(config, cfg.expo, p);
    if (provider === 'fcm') {
      if (!cfg.fcm) return { ok: false, error: 'Firebase (FCM) n’est pas configuré', invalidToken: false };
      return await sendFcm(config, cfg.fcm, p);
    }
    if (!cfg.apns) return { ok: false, error: 'Apple (APNs) n’est pas configuré', invalidToken: false };
    return await sendApns(config, cfg.apns, p);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), invalidToken: false };
  }
}

/** Sends queued push messages; invalid tokens deactivate their device. Returns the number processed. */
export async function sendPushBatch(db: DatabaseSync, config: AppConfig, limit: number): Promise<number> {
  const batch = all<{
    id: string;
    account_id: string;
    device_id: string;
    token: string;
    provider: PushProvider;
    title: string;
    body: string;
    image_url: string | null;
    url: string | null;
  }>(
    db,
    `SELECT m.id, m.account_id, m.device_id, d.token, d.provider, m.title, m.body, m.image_url, m.url
       FROM push_messages m JOIN push_devices d ON d.id = m.device_id
      WHERE m.status = 'queued' ORDER BY m.created_at LIMIT ?`,
    limit,
  );
  const configs = new Map<string, PushConfig>();
  for (const m of batch) {
    let cfg = configs.get(m.account_id);
    if (!cfg) {
      cfg = ensurePushConfig(db, m.account_id);
      configs.set(m.account_id, cfg);
    }
    const outcome = await deliverPush(config, cfg, m.provider, {
      messageId: m.id,
      token: m.token,
      title: m.title,
      body: m.body,
      imageUrl: m.image_url,
      url: m.url,
    });
    if (outcome.ok) {
      run(db, "UPDATE push_messages SET status = 'sent', provider_id = ?, error = NULL, sent_at = ? WHERE id = ?", outcome.providerId, now(), m.id);
    } else {
      run(db, "UPDATE push_messages SET status = 'failed', error = ? WHERE id = ?", outcome.error.slice(0, 1000), m.id);
      if (outcome.invalidToken) run(db, 'UPDATE push_devices SET active = 0 WHERE id = ?', m.device_id);
    }
  }
  return batch.length;
}

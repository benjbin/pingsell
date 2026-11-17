import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, forbidden, HttpError, listResponse, notFound, pagination, parse } from '../lib/http.js';
import {
  accountForAppKey,
  apnsSchema,
  audienceDevices,
  audienceSchema,
  channelsSchema,
  deviceByToken,
  deviceSchema,
  ensurePushConfig,
  identityAllowed,
  listInbox,
  logoutDevice,
  markInboxRead,
  removeInboxItems,
  rotateIdentitySecret,
  setRequireIdentity,
  expoSchema,
  fcmSchema,
  markPushOpened,
  publicPushConfig,
  pushCampaignStats,
  pushContentSchema,
  queueTestPush,
  registerDevice,
  rotateAppKey,
  savePushCredentials,
  serializeDevice,
  serializePushCampaign,
  unregisterDevice,
  type FcmCredentials,
} from '../services/push.js';
import {
  activeDeviceCount,
  contactIdFor,
  promptEventSchema,
  promptSchema,
  promptSettings,
  promptStats,
  recordPromptEvent,
  savePromptSettings,
  sendTransactionalPush,
  trackAppUser,
  transactionalSchema,
} from '../services/pushGrowth.js';
import { fireTrigger } from '../services/automations.js';

type Params = { Params: { id: string } };

const configSchema = z.object({
  /** Firebase service-account JSON (as downloaded from the Firebase console), or null to remove. */
  fcm: z.string().max(20_000).nullable().optional(),
  apns: apnsSchema.nullable().optional(),
  expo: expoSchema.nullable().optional(),
});

const campaignSchema = pushContentSchema.extend({
  name: z.string().trim().min(1, 'Le nom est requis').max(200),
  audience: audienceSchema.default({ type: 'all' }),
  channels: channelsSchema.default(['push', 'in_app']),
  /** `smart` delivers to each customer at the hour they usually open (within 24 h). */
  send_mode: z.enum(['now', 'smart']).default('now'),
  /** Reminder sent to customers who did not open the notification after this delay. */
  resend_after_hours: z.number().int().min(1).max(168).nullable().default(null),
  resend_title: z.string().trim().max(120).nullable().optional(),
  resend_body: z.string().trim().max(500).nullable().optional(),
});

const identifySchema = z
  .object({
    email: z.string().trim().max(254).optional(),
    contact_id: z.string().trim().max(64).optional(),
    user_hash: z.string().trim().max(128).optional(),
    token: z.string().trim().min(8).max(4096).optional(),
  })
  .refine((v) => v.email || v.contact_id, { message: 'Indiquez email ou contact_id' });

const tokenSchema = z.object({ token: z.string().trim().min(8).max(4096) });
const openedSchema = z.object({ message_id: z.string().trim().min(1).max(64) });
const testSchema = pushContentSchema.extend({ device_id: z.string().min(1), channels: channelsSchema.default(['push', 'in_app']) });
const inboxQuerySchema = z.object({
  token: z.string().trim().min(8).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().max(40).optional(),
});
const inboxReadSchema = tokenSchema.partial().extend({ ids: z.array(z.string().min(1).max(64)).max(200).optional() });
const inboxRemoveSchema = tokenSchema.partial().extend({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) });

function parseFcm(raw: string): FcmCredentials {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest('Le fichier de compte de service Firebase doit être un JSON valide');
  }
  const result = fcmSchema.safeParse(json);
  if (!result.success) throw badRequest('Compte de service Firebase incomplet : project_id, client_email et private_key sont requis');
  return result.data;
}

/** Public routes used by the merchant's mobile app, authenticated with its public app key (`msvapp_…`). */
export async function pushAppRoutes(app: FastifyInstance, { db, kickWorker }: Deps) {
  const appAccount = (request: FastifyRequest): string => {
    const header = String(request.headers.authorization ?? request.headers['x-missive-app-key'] ?? '');
    const key = header.replace(/^Bearer\s+/i, '').trim();
    const accountId = key.startsWith('msvapp_') ? accountForAppKey(db, key) : undefined;
    if (!accountId) throw new HttpError(401, "Clé d'application invalide");
    return accountId;
  };

  /** The device push token identifies the phone for its inbox (header `X-Missive-Device`, or `token`). */
  const appDevice = (request: FastifyRequest, accountId: string, bodyToken?: string) => {
    const token = String(request.headers['x-missive-device'] ?? bodyToken ?? '').trim();
    if (!token) throw badRequest('Jeton de l’appareil manquant (en-tête X-Missive-Device)');
    const device = deviceByToken(db, accountId, token);
    if (!device) throw notFound('Appareil inconnu : enregistrez-le d’abord avec POST /push/app/devices');
    return device;
  };

  app.post('/push/app/devices', async (request, reply) => {
    const accountId = appAccount(request);
    const input = parse(deviceSchema, request.body);
    if (!identityAllowed(ensurePushConfig(db, accountId), input)) {
      throw new HttpError(401, 'Signature d’identité (user_hash) manquante ou invalide');
    }
    const contactId = contactIdFor(db, accountId, input);
    // First reachable device of this customer → `push_subscribed` automations.
    const hadDevice = contactId ? activeDeviceCount(db, accountId, contactId) > 0 : true;
    const result = registerDevice(db, accountId, input);
    if (contactId && result.device.contact_id === contactId) {
      trackAppUser(db, accountId, contactId);
      if (!hadDevice) fireTrigger(db, accountId, contactId, 'push_subscribed', { platform: input.platform });
      kickWorker();
    }
    return reply.code(result.created ? 201 : 200).send({ id: result.device.id, provider: result.device.provider, linked: result.linked });
  });

  /* Pre-permission screen (shown by the SDK before the system dialog) */

  app.get('/push/app/config', async (request) => {
    const accountId = appAccount(request);
    return { prompt: promptSettings(db, accountId) };
  });

  app.post('/push/app/prompt', async (request) => {
    const accountId = appAccount(request);
    recordPromptEvent(db, accountId, parse(promptEventSchema, request.body));
    return { ok: true };
  });

  /** The customer signed in to the app (even with notifications off): `app_signed_in` automations. */
  app.post('/push/app/identify', async (request) => {
    const accountId = appAccount(request);
    const input = parse(identifySchema, request.body ?? {});
    if (!identityAllowed(ensurePushConfig(db, accountId), input)) {
      throw new HttpError(401, 'Signature d’identité (user_hash) manquante ou invalide');
    }
    const contactId = contactIdFor(db, accountId, input);
    if (!contactId) return { ok: true, known: false, first: false };
    const { first } = trackAppUser(db, accountId, contactId);
    const token = String(request.headers['x-missive-device'] ?? input.token ?? '').trim();
    if (token) run(db, 'UPDATE push_devices SET contact_id = ?, last_seen_at = ? WHERE account_id = ? AND token = ?', contactId, now(), accountId, token);
    kickWorker();
    return { ok: true, known: true, first };
  });

  app.post('/push/app/devices/unregister', async (request) => {
    const accountId = appAccount(request);
    return { ok: unregisterDevice(db, accountId, parse(tokenSchema, request.body).token) };
  });

  // The customer signed out of the app: keep the device, drop the link to their contact.
  app.post('/push/app/devices/logout', async (request) => {
    const accountId = appAccount(request);
    return { ok: logoutDevice(db, accountId, parse(tokenSchema, request.body).token) };
  });

  /* In-app notification centre */

  app.get('/push/app/inbox', async (request) => {
    const accountId = appAccount(request);
    const q = parse(inboxQuerySchema, request.query);
    return listInbox(db, accountId, appDevice(request, accountId, q.token), q.limit, q.before);
  });

  app.get('/push/app/inbox/unread', async (request) => {
    const accountId = appAccount(request);
    const q = parse(inboxQuerySchema, request.query);
    return { unread: listInbox(db, accountId, appDevice(request, accountId, q.token), 1).unread };
  });

  app.post('/push/app/inbox/read', async (request) => {
    const accountId = appAccount(request);
    const body = parse(inboxReadSchema, request.body ?? {});
    return { unread: markInboxRead(db, accountId, appDevice(request, accountId, body.token), body.ids) };
  });

  app.post('/push/app/inbox/delete', async (request) => {
    const accountId = appAccount(request);
    const body = parse(inboxRemoveSchema, request.body ?? {});
    const device = appDevice(request, accountId, body.token);
    const removed = removeInboxItems(db, accountId, device, body.ids);
    return { removed, unread: markInboxRead(db, accountId, device, []) };
  });

  app.post('/push/app/opened', async (request) => {
    const accountId = appAccount(request);
    const ok = markPushOpened(db, accountId, parse(openedSchema, request.body).message_id);
    kickWorker();
    return { ok };
  });
}

/** Authenticated push routes (session or secret API key). */
export async function pushRoutes(app: FastifyInstance, { db, config, kickWorker }: Deps) {
  const assertManager = (request: FastifyRequest) => {
    if (!request.userId) return; // secret API key = account level
    const role = get<{ role: string }>(db, 'SELECT role FROM users WHERE id = ?', request.userId)?.role;
    if (role === 'editor') throw forbidden('Les réglages push sont réservés au propriétaire et aux administrateurs');
  };

  /* ---- Settings ---- */

  const fullConfig = (accountId: string) => ({
    ...publicPushConfig(db, accountId, config),
    prompt: promptSettings(db, accountId),
    prompt_stats: promptStats(db, accountId),
    app_users: scalar(db, 'SELECT COUNT(*) FROM app_users WHERE account_id = ?', accountId),
  });

  app.get('/push/config', async (request) => fullConfig(request.accountId));

  app.put('/push/config/prompt', async (request) => {
    assertManager(request);
    savePromptSettings(db, request.accountId, parse(promptSchema, request.body));
    return fullConfig(request.accountId);
  });

  /* ---- Transactional: one customer, right away (secret API key from the merchant's backend) ---- */

  app.post('/push/send', async (request, reply) => {
    const result = sendTransactionalPush(db, request.accountId, parse(transactionalSchema, request.body));
    if (!result) throw notFound('Contact introuvable');
    kickWorker();
    return reply.code(202).send({ ok: true, ...result });
  });

  app.put('/push/config', async (request) => {
    assertManager(request);
    const body = parse(configSchema, request.body);
    savePushCredentials(db, request.accountId, {
      fcm: body.fcm === undefined ? undefined : body.fcm === null ? null : parseFcm(body.fcm),
      apns: body.apns,
      expo: body.expo,
    });
    return fullConfig(request.accountId);
  });

  app.put('/push/config/identity', async (request) => {
    assertManager(request);
    setRequireIdentity(db, request.accountId, parse(z.object({ required: z.boolean() }), request.body).required);
    return fullConfig(request.accountId);
  });

  app.post('/push/config/rotate-identity-secret', async (request) => {
    assertManager(request);
    rotateIdentitySecret(db, request.accountId);
    return fullConfig(request.accountId);
  });

  app.post('/push/config/rotate-app-key', async (request) => {
    assertManager(request);
    rotateAppKey(db, request.accountId);
    return fullConfig(request.accountId);
  });

  /* ---- Devices ---- */

  app.get('/push/devices', async (request) => {
    const p = pagination(request.query);
    const rows = all(
      db,
      `SELECT d.*, c.email AS contact_email FROM push_devices d LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.account_id = ? AND d.active = 1 ORDER BY d.last_seen_at DESC LIMIT ? OFFSET ?`,
      request.accountId,
      p.limit,
      p.offset,
    );
    const total = scalar(db, 'SELECT COUNT(*) FROM push_devices WHERE account_id = ? AND active = 1', request.accountId);
    return listResponse(rows.map(serializeDevice), total, p);
  });

  // Server-side registration (merchant back-office, secret API key).
  app.post('/push/devices', async (request, reply) => {
    const result = registerDevice(db, request.accountId, parse(deviceSchema, request.body));
    return reply.code(result.created ? 201 : 200).send(result.device);
  });

  app.post('/push/devices/unregister', async (request) => ({
    ok: unregisterDevice(db, request.accountId, parse(tokenSchema, request.body).token),
  }));

  app.delete<Params>('/push/devices/:id', async (request, reply) => {
    const changed = run(db, 'UPDATE push_devices SET active = 0 WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!changed) throw notFound('Appareil introuvable');
    return reply.code(204).send();
  });

  app.post('/push/test', async (request) => {
    const body = parse(testSchema, request.body);
    if (!queueTestPush(db, request.accountId, body.device_id, body, body.channels)) throw notFound('Appareil introuvable');
    kickWorker();
    return { ok: true };
  });

  /* ---- Campaigns ---- */

  const findCampaign = (accountId: string, id: string) => {
    const row = get(db, 'SELECT * FROM push_campaigns WHERE id = ? AND account_id = ?', id, accountId);
    if (!row) throw notFound('Campagne push introuvable');
    return serializePushCampaign(row);
  };
  const withStats = (c: ReturnType<typeof serializePushCampaign>) => ({ ...c, stats: pushCampaignStats(db, c.id) });

  app.post('/push/audience-count', async (request) => {
    const audience = parse(z.object({ audience: audienceSchema }), request.body).audience;
    return { devices: audienceDevices(db, request.accountId, audience).length };
  });

  app.get('/push/campaigns', async (request) => {
    const p = pagination(request.query);
    const rows = all(db, 'SELECT * FROM push_campaigns WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', request.accountId, p.limit, p.offset);
    const total = scalar(db, 'SELECT COUNT(*) FROM push_campaigns WHERE account_id = ?', request.accountId);
    return listResponse(rows.map(serializePushCampaign).map(withStats), total, p);
  });

  app.get<Params>('/push/campaigns/:id', async (request) => withStats(findCampaign(request.accountId, request.params.id)));

  app.post('/push/campaigns', async (request, reply) => {
    const body = parse(campaignSchema, request.body);
    if (body.audience.type === 'segment' && !get(db, 'SELECT 1 FROM segments WHERE id = ? AND account_id = ?', body.audience.segment_id, request.accountId)) {
      throw badRequest('Segment introuvable');
    }
    const id = newId();
    const timestamp = now();
    run(
      db,
      `INSERT INTO push_campaigns (id, account_id, name, title, body, image_url, url, audience, channels, send_mode,
              resend_after_hours, resend_title, resend_body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      request.accountId,
      body.name,
      body.title,
      body.body,
      body.image_url ?? null,
      body.url ?? null,
      JSON.stringify(body.audience),
      JSON.stringify(body.channels),
      body.send_mode,
      body.resend_after_hours,
      body.resend_title || null,
      body.resend_body || null,
      timestamp,
      timestamp,
    );
    return reply.code(201).send(withStats(findCampaign(request.accountId, id)));
  });

  app.patch<Params>('/push/campaigns/:id', async (request) => {
    const current = findCampaign(request.accountId, request.params.id);
    if (current.status !== 'draft') throw badRequest('Seul un brouillon peut être modifié');
    const body = parse(campaignSchema.partial(), request.body);
    const merged = {
      ...current,
      ...body,
      resend_after_hours: body.resend_after_hours !== undefined ? body.resend_after_hours : current.resend.after_hours,
      resend_title: body.resend_title !== undefined ? body.resend_title : current.resend.title,
      resend_body: body.resend_body !== undefined ? body.resend_body : current.resend.body,
    };
    run(
      db,
      `UPDATE push_campaigns SET name = ?, title = ?, body = ?, image_url = ?, url = ?, audience = ?, channels = ?, send_mode = ?,
              resend_after_hours = ?, resend_title = ?, resend_body = ?, updated_at = ? WHERE id = ?`,
      merged.name,
      merged.title,
      merged.body,
      merged.image_url ?? null,
      merged.url ?? null,
      JSON.stringify(merged.audience),
      JSON.stringify(merged.channels),
      merged.send_mode,
      merged.resend_after_hours ?? null,
      merged.resend_title || null,
      merged.resend_body || null,
      now(),
      current.id,
    );
    return withStats(findCampaign(request.accountId, current.id));
  });

  app.delete<Params>('/push/campaigns/:id', async (request, reply) => {
    const current = findCampaign(request.accountId, request.params.id);
    if (current.status === 'sending') throw badRequest("Une campagne en cours d'envoi ne peut pas être supprimée");
    run(db, 'DELETE FROM push_campaigns WHERE id = ?', current.id);
    return reply.code(204).send();
  });

  app.post<Params>('/push/campaigns/:id/send', async (request) => {
    const current = findCampaign(request.accountId, request.params.id);
    if (current.status !== 'draft') throw badRequest('Cette campagne a déjà été envoyée');
    if (!audienceDevices(db, request.accountId, current.audience).length) throw badRequest("Aucun appareil ne correspond à cette audience");
    run(db, "UPDATE push_campaigns SET status = 'sending', updated_at = ? WHERE id = ?", now(), current.id);
    kickWorker();
    return withStats(findCampaign(request.accountId, current.id));
  });
}

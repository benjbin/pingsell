import { z } from 'zod';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync } from '../db.js';
import { fireTrigger } from './automations.js';
import { CHANNELS, ensurePushConfig, queueContent, type PushChannel, type PushContent } from './push.js';
import { zmsg } from '../lib/http.js';
import { t } from '../i18n.js';

/* -------------------------------------------------------------------------- */
/* Pre-permission prompt                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Screen the app shows before the system permission dialog. iOS only lets an app ask once:
 * explaining first, and only asking customers who said yes, protects that single chance.
 */
export const promptSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1, zmsg('Le titre est requis', 'Title is required')).max(80),
  body: z.string().trim().min(1, zmsg('Le message est requis', 'Message is required')).max(300),
  accept_label: z.string().trim().min(1).max(30),
  decline_label: z.string().trim().min(1).max(30),
  /** Show it from the Nth app launch (1 = first launch). */
  min_launches: z.number().int().min(1).max(20),
  /** After "Plus tard", wait this many days before asking again. */
  cooldown_days: z.number().int().min(1).max(90),
  image_url: z.string().trim().url().max(2000).nullable().optional(),
});
export type PromptSettings = z.output<typeof promptSchema>;

/** Default pre-permission screen, in the current language (until the merchant saves their own). */
export const defaultPrompt = (): PromptSettings => ({
  enabled: true,
  title: t('Ne ratez aucune bonne affaire', 'Never miss a great deal'),
  body: t(
    'Activez les notifications pour suivre vos commandes et recevoir nos offres en avant-première. Promis, pas plus de deux par semaine.',
    'Turn on notifications to track your orders and get early access to our offers. We promise, no more than two a week.',
  ),
  accept_label: t('Activer', 'Turn on'),
  decline_label: t('Plus tard', 'Not now'),
  min_launches: 1,
  cooldown_days: 7,
  image_url: null,
});

export function promptSettings(db: DatabaseSync, accountId: string): PromptSettings {
  ensurePushConfig(db, accountId);
  const raw = get<{ prompt: string | null }>(db, 'SELECT prompt FROM push_config WHERE account_id = ?', accountId)?.prompt;
  return { ...defaultPrompt(), ...parseJson<Partial<PromptSettings>>(raw, {}) };
}

export function savePromptSettings(db: DatabaseSync, accountId: string, settings: PromptSettings): PromptSettings {
  ensurePushConfig(db, accountId);
  run(db, 'UPDATE push_config SET prompt = ?, updated_at = ? WHERE account_id = ?', JSON.stringify(settings), now(), accountId);
  return promptSettings(db, accountId);
}

export const PROMPT_EVENTS = ['shown', 'accepted', 'declined', 'granted', 'denied'] as const;
export const promptEventSchema = z.object({
  event: z.enum(PROMPT_EVENTS),
  platform: z.enum(['ios', 'android']).optional(),
});

export function recordPromptEvent(db: DatabaseSync, accountId: string, input: z.output<typeof promptEventSchema>): void {
  run(
    db,
    'INSERT INTO push_prompt_events (id, account_id, event, platform, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    accountId,
    input.event,
    input.platform ?? null,
    now(),
  );
}

const rate = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);

/** Opt-in funnel over the last `days` days: prompt shown → "Activer" → permission granted by the OS. */
export function promptStats(db: DatabaseSync, accountId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = all<{ event: string; n: number }>(
    db,
    'SELECT event, COUNT(*) AS n FROM push_prompt_events WHERE account_id = ? AND created_at >= ? GROUP BY event',
    accountId,
    since,
  );
  const n = (event: string) => Number(rows.find((r) => r.event === event)?.n ?? 0);
  const shown = n('shown');
  const accepted = n('accepted');
  const granted = n('granted');
  return {
    days,
    shown,
    accepted,
    declined: n('declined'),
    granted,
    denied: n('denied'),
    accept_rate: rate(accepted, shown),
    /** Share of customers who saw the screen and ended up with notifications on. */
    opt_in_rate: rate(granted, shown),
  };
}

/* -------------------------------------------------------------------------- */
/* Resend to non-openers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * For campaigns with a resend delay: X hours after each notification was delivered, sends the
 * reminder to the devices of customers who neither opened it nor read it in the app.
 * A campaign is closed for resends once it is fully delivered and every delivery is past the delay.
 */
export function processPushResends(db: DatabaseSync): number {
  const campaigns = all<{
    id: string;
    account_id: string;
    status: string;
    title: string;
    body: string;
    image_url: string | null;
    url: string | null;
    resend_after_hours: number;
    resend_title: string | null;
    resend_body: string | null;
  }>(
    db,
    `SELECT id, account_id, status, title, body, image_url, url, resend_after_hours, resend_title, resend_body
       FROM push_campaigns
      WHERE resend_after_hours IS NOT NULL AND resend_queued_at IS NULL AND status IN ('sending','sent')`,
  );
  let queued = 0;
  for (const c of campaigns) {
    const threshold = new Date(Date.now() - Number(c.resend_after_hours) * 3_600_000).toISOString();
    transaction(db, () => {
      const due = all<{ id: string; device_id: string; contact_id: string | null; inbox_id: string | null; email: string | null; first_name: string | null; last_name: string | null }>(
        db,
        `SELECT m.id, m.device_id, m.contact_id, m.inbox_id, ct.email, ct.first_name, ct.last_name
           FROM push_messages m
           JOIN push_devices d ON d.id = m.device_id AND d.active = 1
           LEFT JOIN contacts ct ON ct.id = m.contact_id
          WHERE m.push_campaign_id = ? AND m.resend = 0 AND m.status = 'sent' AND m.sent_at <= ?
            AND NOT EXISTS (SELECT 1 FROM push_messages r WHERE r.push_campaign_id = m.push_campaign_id AND r.resend = 1 AND r.device_id = m.device_id)
            AND NOT EXISTS (
              SELECT 1 FROM push_messages o WHERE o.push_campaign_id = m.push_campaign_id AND o.opened_at IS NOT NULL
                 AND (o.device_id = m.device_id OR (m.contact_id IS NOT NULL AND o.contact_id = m.contact_id)))
            AND NOT EXISTS (SELECT 1 FROM app_inbox i WHERE i.id = m.inbox_id AND i.read_at IS NOT NULL)
            AND (ct.id IS NULL OR ct.status = 'subscribed')`,
        c.id,
        threshold,
      );
      for (const m of due) {
        const content: PushContent = {
          title: c.resend_title || c.title,
          body: c.resend_body || c.body,
          image_url: c.image_url,
          url: c.url,
        };
        // Same inbox entry: opening the reminder reads the original message in the app.
        insertResend(db, c.account_id, c.id, m, content);
        queued++;
      }
      const pending = scalar(
        db,
        `SELECT COUNT(*) FROM push_messages WHERE push_campaign_id = ? AND resend = 0
            AND (status = 'queued' OR (status = 'sent' AND sent_at > ?))`,
        c.id,
        threshold,
      );
      if (c.status === 'sent' && pending === 0) run(db, 'UPDATE push_campaigns SET resend_queued_at = ? WHERE id = ?', now(), c.id);
    });
  }
  return queued;
}

function insertResend(
  db: DatabaseSync,
  accountId: string,
  campaignId: string,
  m: { device_id: string; contact_id: string | null; inbox_id: string | null; email: string | null; first_name: string | null; last_name: string | null },
  content: PushContent,
): void {
  queueContent(
    db,
    accountId,
    [{ device_id: m.device_id, contact_id: m.contact_id, email: m.email, first_name: m.first_name, last_name: m.last_name }],
    content,
    { campaignId },
    ['push'],
    'device',
    { resend: true, inboxId: m.inbox_id },
  );
}

/* -------------------------------------------------------------------------- */
/* App triggers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The customer is signed in to the merchant's app. The first time a contact is seen in the app,
 * `app_signed_in` automations start (welcome series, app-only discount…).
 */
export function trackAppUser(db: DatabaseSync, accountId: string, contactId: string): { first: boolean } {
  const timestamp = now();
  const first =
    run(
      db,
      'INSERT INTO app_users (account_id, contact_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      accountId,
      contactId,
      timestamp,
      timestamp,
    ) > 0;
  if (first) fireTrigger(db, accountId, contactId, 'app_signed_in', {});
  else run(db, 'UPDATE app_users SET last_seen_at = ? WHERE account_id = ? AND contact_id = ?', timestamp, accountId, contactId);
  return { first };
}

/** Active devices of a contact (used to detect the first one: `push_subscribed`). */
export function activeDeviceCount(db: DatabaseSync, accountId: string, contactId: string): number {
  return scalar(db, 'SELECT COUNT(*) FROM push_devices WHERE account_id = ? AND contact_id = ? AND active = 1', accountId, contactId);
}

export function contactIdFor(db: DatabaseSync, accountId: string, input: { email?: string; contact_id?: string }): string | null {
  if (input.contact_id) {
    return get<{ id: string }>(db, 'SELECT id FROM contacts WHERE id = ? AND account_id = ?', input.contact_id, accountId)?.id ?? null;
  }
  if (input.email) {
    return get<{ id: string }>(db, 'SELECT id FROM contacts WHERE account_id = ? AND email = ?', accountId, input.email.trim().toLowerCase())?.id ?? null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Transactional push                                                         */
/* -------------------------------------------------------------------------- */

export const transactionalSchema = z
  .object({
    email: z.string().trim().max(254).optional(),
    contact_id: z.string().trim().max(64).optional(),
    title: z.string().trim().min(1, zmsg('Le titre est requis', 'Title is required')).max(120),
    body: z.string().trim().min(1, zmsg('Le message est requis', 'Message is required')).max(500),
    url: z.string().trim().max(2000).nullable().optional(),
    image_url: z.string().trim().url().max(2000).nullable().optional(),
    channels: z.array(z.enum(CHANNELS)).min(1).optional(),
  })
  .refine((v) => v.email || v.contact_id, zmsg('Indiquez email ou contact_id', 'Provide email or contact_id'));

/**
 * One notification to one customer, sent right away (order shipped, appointment reminder,
 * password reset…). Transactional: it ignores the marketing subscription status.
 */
export function sendTransactionalPush(
  db: DatabaseSync,
  accountId: string,
  input: z.output<typeof transactionalSchema>,
): { contact_id: string; devices: number; in_app: boolean } | null {
  const contactId = contactIdFor(db, accountId, input);
  if (!contactId) return null;
  const channels: PushChannel[] = input.channels ? [...new Set(input.channels)] : [...CHANNELS];
  const recipients = all<{ device_id: string; contact_id: string; email: string; first_name: string | null; last_name: string | null }>(
    db,
    `SELECT d.id AS device_id, d.contact_id, c.email, c.first_name, c.last_name
       FROM push_devices d JOIN contacts c ON c.id = d.contact_id
      WHERE d.account_id = ? AND d.contact_id = ? AND d.active = 1 AND c.status != 'complained'`,
    accountId,
    contactId,
  );
  const result = queueContent(db, accountId, recipients, input, {}, channels);
  return { contact_id: contactId, devices: result.pushes, in_app: result.inbox > 0 };
}

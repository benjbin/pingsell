import type { AppConfig } from '../config.js';
import { get, newId, now, run, transaction, type DatabaseSync, type Row } from '../db.js';
import { currentLang, withAccountLang } from '../i18n.js';
import { personalizeEmail, prepareTemplate, renderEmail, type MergeContact, type RenderedEmail } from './render.js';
import { accountFromEmail } from './sendingDomains.js';
import { campaignLanguage, sameLanguage, sourceHash, type TranslationSource } from './translate.js';

export interface Sender {
  name: string;
  email: string;
}

/** Default sender for an account: its name + its own verified address, else the platform default. */
export function accountSender(db: DatabaseSync, config: AppConfig, accountId: string): Sender {
  const row = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', accountId);
  return { name: row?.name ?? 'Pingsell', email: accountFromEmail(db, config, accountId) };
}

export interface CreateMessageInput {
  accountId: string;
  campaignId?: string | null;
  automationId?: string | null;
  contactId?: string | null;
  contact: MergeContact;
  subject: string;
  html: string;
  /** `html` is already a prepared template (prepareTemplate, e.g. a campaign translation): only personalized. */
  prepared?: boolean;
  preheader?: string | null;
  senderName: string;
  status?: 'queued' | 'sent' | 'failed';
  createdAt?: string;
}

/**
 * Renders the email for one recipient and stores it as a message row (queued by default).
 * Automation / transactional / test emails keep their rendered HTML; campaign recipients are queued by
 * queueCampaign without it (rendered at send time from campaigns.html, see renderCampaignMessage).
 */
export function createMessage(
  db: DatabaseSync,
  config: AppConfig,
  input: CreateMessageInput,
): { id: string; rendered: RenderedEmail } {
  const id = newId();
  // Footer texts follow the account's language when rendered by the worker.
  const rendered = withAccountLang(db, input.accountId, () => {
    const base = { messageId: id, publicUrl: config.publicUrl, subject: input.subject, preheader: input.preheader, contact: input.contact };
    return input.prepared ? personalizeEmail(input.html, base) : renderEmail({ ...base, html: input.html, senderName: input.senderName });
  });
  const status = input.status ?? 'queued';
  run(
    db,
    `INSERT INTO messages (id, account_id, campaign_id, automation_id, contact_id, to_email, subject, html, status, in_queue, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.accountId,
    input.campaignId ?? null,
    input.automationId ?? null,
    input.contactId ?? null,
    input.contact.email,
    rendered.subject,
    rendered.html,
    status,
    status === 'queued' ? 1 : 0,
    input.createdAt ?? now(),
  );
  return { id, rendered };
}

/* ------------------------------------------------------------ campaign counters */

/**
 * Per-campaign counters (campaigns.n_* and the guard's g_*), kept up to date on every status change so that
 * statistics, the guard and the end-of-sending check never recount millions of messages.
 *
 * Campaigns created before the counters (counters_ok = 0) are caught up by the worker's background walk over
 * the old messages (app_state.backfill_cursor = last rowid counted). A change on one of their messages only
 * counts once the walk has passed it, otherwise the walk would count it twice.
 */
export type CampaignCounter =
  | 'n_total'
  | 'n_queued'
  | 'n_sent'
  | 'n_failed'
  | 'n_bounced'
  | 'n_opened'
  | 'n_clicked'
  | 'n_complained'
  | 'n_unsub';
export type GuardCounter = 'g_handled' | 'g_bounces' | 'g_blocks' | 'g_complaints';

const COUNTABLE = `(counters_ok = 1 OR ? <= COALESCE((SELECT CAST(value AS INTEGER) FROM app_state WHERE key = 'backfill_cursor'), -1))`;

const STATUS_COUNTER: Record<string, CampaignCounter> = {
  queued: 'n_queued',
  sent: 'n_sent',
  failed: 'n_failed',
  bounced: 'n_bounced',
};

/**
 * Adds `deltas` to a campaign's counters. Guard counters only count emails sent since the last resume
 * (`sentAt` >= guard_since), like the guard always did.
 */
export function bumpCampaign(
  db: DatabaseSync,
  campaignId: string | null,
  rowid: number,
  deltas: Partial<Record<CampaignCounter, number>>,
  guard?: { sentAt: string | null; deltas: Partial<Record<GuardCounter, number>> },
): void {
  if (!campaignId) return;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(deltas)) {
    if (!v) continue;
    sets.push(`${k} = ${k} + ?`);
    params.push(v);
  }
  if (guard?.sentAt) {
    for (const [k, v] of Object.entries(guard.deltas)) {
      if (!v) continue;
      sets.push(`${k} = ${k} + CASE WHEN guard_since IS NULL OR ? >= guard_since THEN ? ELSE 0 END`);
      params.push(guard.sentAt, v);
    }
  }
  if (!sets.length) return;
  run(db, `UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND ${COUNTABLE}`, ...params, campaignId, rowid);
}

/** Opens / clicks per hour of a campaign (the report's timeline). */
export function bumpCampaignHour(db: DatabaseSync, campaignId: string | null, rowid: number, at: string, field: 'opens' | 'clicks'): void {
  if (!campaignId) return;
  run(
    db,
    `INSERT INTO campaign_hours (campaign_id, hour, opens, clicks)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND ${COUNTABLE})
     ON CONFLICT (campaign_id, hour) DO UPDATE SET opens = opens + excluded.opens, clicks = clicks + excluded.clicks`,
    campaignId,
    `${at.slice(0, 13)}:00:00.000Z`,
    field === 'opens' ? 1 : 0,
    field === 'clicks' ? 1 : 0,
    campaignId,
    rowid,
  );
}

export interface MessageMeta {
  rid: number;
  id: string;
  account_id: string;
  campaign_id: string | null;
  automation_id: string | null;
  contact_id: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  complained_at: string | null;
}

export function messageMeta(db: DatabaseSync, messageId: string): MessageMeta | undefined {
  return get<MessageMeta>(
    db,
    `SELECT rowid AS rid, id, account_id, campaign_id, automation_id, contact_id, status, error, sent_at, opened_at, clicked_at, complained_at
       FROM messages WHERE id = ?`,
    messageId,
  );
}

/** Moves a message from its current status to `to`, keeping the campaign counters right. */
function statusDeltas(from: string, to: string): Partial<Record<CampaignCounter, number>> {
  if (from === to) return {};
  const d: Partial<Record<CampaignCounter, number>> = {};
  if (STATUS_COUNTER[from]) d[STATUS_COUNTER[from]] = -1;
  if (STATUS_COUNTER[to]) d[STATUS_COUNTER[to]] = (d[STATUS_COUNTER[to]] ?? 0) + 1;
  return d;
}

/** Sending engagement on the contact: drives the sending order and the sunset of the next campaigns. */
function noteSentToContact(db: DatabaseSync, contactId: string | null, at: string): void {
  if (contactId) run(db, 'UPDATE contacts SET last_sent_at = ?, sends_since_engaged = sends_since_engaged + 1 WHERE id = ?', at, contactId);
}

export function noteEngagement(db: DatabaseSync, contactId: string | null, at: string): void {
  if (contactId) run(db, "UPDATE contacts SET last_engaged_at = MAX(COALESCE(last_engaged_at, ''), ?), sends_since_engaged = 0 WHERE id = ?", at, contactId);
}

export function markSent(db: DatabaseSync, messageId: string, providerId: string): void {
  const m = messageMeta(db, messageId);
  if (!m) return;
  const at = now();
  transaction(db, () => {
    run(
      db,
      `UPDATE messages SET status = 'sent', provider_id = ?, error = NULL, sent_at = ?, next_attempt_at = NULL,
              in_queue = CASE WHEN in_queue IS NULL THEN NULL ELSE 0 END
        WHERE id = ?`,
      providerId,
      at,
      messageId,
    );
    bumpCampaign(db, m.campaign_id, m.rid, statusDeltas(m.status, 'sent'), { sentAt: at, deltas: { g_handled: m.sent_at ? 0 : 1 } });
    noteSentToContact(db, m.contact_id, at);
  });
}

/** Permanent failure (or a recipient skipped before sending: unsubscribed, bounced, deleted…). */
export function markFailed(db: DatabaseSync, messageId: string, error: string): void {
  const m = messageMeta(db, messageId);
  if (!m) return;
  transaction(db, () => {
    run(
      db,
      `UPDATE messages SET status = 'failed', error = ?, next_attempt_at = NULL,
              in_queue = CASE WHEN in_queue IS NULL THEN NULL ELSE 0 END
        WHERE id = ?`,
      error.slice(0, 1000),
      messageId,
    );
    bumpCampaign(db, m.campaign_id, m.rid, statusDeltas(m.status, 'failed'));
  });
}

/** Transient failure: the message stays queued and is tried again after `retryAt`. */
export function markRetry(db: DatabaseSync, messageId: string, error: string, retryAt: string): void {
  run(db, "UPDATE messages SET error = ?, next_attempt_at = ? WHERE id = ? AND status = 'queued'", error.slice(0, 1000), retryAt, messageId);
}

/** Bounce / complaint transitions (see bounces.ts). */
export function markBounced(db: DatabaseSync, m: MessageMeta, error: string | null): void {
  run(db, "UPDATE messages SET status = 'bounced', error = ?, in_queue = CASE WHEN in_queue IS NULL THEN NULL ELSE 0 END WHERE id = ?", error, m.id);
  bumpCampaign(db, m.campaign_id, m.rid, statusDeltas(m.status, 'bounced'), { sentAt: m.sent_at, deltas: { g_bounces: m.status === 'bounced' ? 0 : 1 } });
}

export function markSoftBounced(db: DatabaseSync, m: MessageMeta, error: string | null): void {
  if (m.status !== 'sent') return;
  run(db, "UPDATE messages SET status = 'failed', error = ? WHERE id = ? AND status = 'sent'", error, m.id);
  const block = /^5\.7\./.test(error ?? '') ? 1 : 0;
  bumpCampaign(db, m.campaign_id, m.rid, statusDeltas('sent', 'failed'), { sentAt: m.sent_at, deltas: { g_blocks: block } });
}

export function markComplained(db: DatabaseSync, m: MessageMeta): void {
  if (m.complained_at) return;
  run(db, 'UPDATE messages SET complained_at = ? WHERE id = ? AND complained_at IS NULL', now(), m.id);
  bumpCampaign(db, m.campaign_id, m.rid, { n_complained: 1 }, { sentAt: m.sent_at, deltas: { g_complaints: 1 } });
}

/** First open of a message (pixel, or implied by a click). Returns false if it was already opened. */
export function markOpened(db: DatabaseSync, m: Pick<MessageMeta, 'rid' | 'id' | 'campaign_id' | 'contact_id'>, at: string): boolean {
  if (!run(db, 'UPDATE messages SET opened_at = ? WHERE id = ? AND opened_at IS NULL', at, m.id)) return false;
  bumpCampaign(db, m.campaign_id, m.rid, { n_opened: 1 });
  bumpCampaignHour(db, m.campaign_id, m.rid, at, 'opens');
  noteEngagement(db, m.contact_id, at);
  return true;
}

/** Click: marks the first click (and the open it implies). */
export function markClicked(db: DatabaseSync, m: Pick<MessageMeta, 'rid' | 'id' | 'campaign_id' | 'contact_id'>, at: string): { opened: boolean } {
  const opened = markOpened(db, m, at);
  if (run(db, 'UPDATE messages SET clicked_at = ? WHERE id = ? AND clicked_at IS NULL', at, m.id)) {
    bumpCampaign(db, m.campaign_id, m.rid, { n_clicked: 1 });
    bumpCampaignHour(db, m.campaign_id, m.rid, at, 'clicks');
  }
  noteEngagement(db, m.contact_id, at);
  return { opened };
}

/* ------------------------------------------------------------ campaign rendering */

export interface CampaignTemplateRow {
  id: string;
  account_id: string;
  subject: string;
  preheader: string | null;
  html: string | null;
  from_name: string | null;
  language: string | null;
  auto_translate: number;
  translated_at: string | null;
}

interface PreparedTemplate {
  source: string;
  lang: string;
  senderName: string;
  prepared: string;
  subject: string;
  preheader: string | null;
  /** Empreinte du modèle + objet + pré-en-tête : une traduction n'est utilisée que pour cette version-là. */
  hash: string;
}

interface TranslationRow {
  source_hash: string;
  subject: string;
  preheader: string | null;
  html: string;
}

/** Traductions lues récemment ((campagne, version, langue) → ligne ou null), pour ne pas relire 2 M fois la base. */
const translations = new Map<string, TranslationRow | null>();
const TRANSLATION_CACHE = 256;

function translationFor(db: DatabaseSync, c: CampaignTemplateRow, lang: string): TranslationRow | null {
  const key = `${c.id}|${c.translated_at ?? ''}|${lang}`;
  if (translations.has(key)) return translations.get(key)!;
  const row =
    get<TranslationRow>(db, 'SELECT source_hash, subject, preheader, html FROM campaign_translations WHERE campaign_id = ? AND lang = ?', c.id, lang) ?? null;
  translations.set(key, row);
  if (translations.size > TRANSLATION_CACHE) translations.delete(translations.keys().next().value!);
  return row;
}

/** Oublie les traductions en mémoire d'une campagne (après un aperçu traduit, une nouvelle version…). */
export function forgetTranslations(campaignId: string): void {
  for (const key of [...translations.keys()]) if (key.startsWith(`${campaignId}|`)) translations.delete(key);
}

/** Contact-independent rendering of the last campaigns used (one ~150 KB string each). */
const templates = new Map<string, PreparedTemplate>();
const TEMPLATE_CACHE = 32;

export function loadCampaignTemplate(db: DatabaseSync, campaignId: string): CampaignTemplateRow | undefined {
  return get<CampaignTemplateRow>(
    db,
    'SELECT id, account_id, subject, preheader, html, from_name, language, auto_translate, translated_at FROM campaigns WHERE id = ?',
    campaignId,
  );
}

/** Must run inside the account's language (withAccountLang). */
function preparedFor(db: DatabaseSync, config: AppConfig, c: CampaignTemplateRow): PreparedTemplate {
  const source = c.html ?? '';
  const lang = currentLang();
  const hit = templates.get(c.id);
  if (hit && hit.source === source && hit.lang === lang && hit.subject === c.subject && hit.preheader === c.preheader) {
    // Refresh its place in the LRU order.
    templates.delete(c.id);
    templates.set(c.id, hit);
    return hit;
  }
  // The same sender name queueCampaign used to pass to createMessage.
  const senderName = c.from_name || accountSender(db, config, c.account_id).name;
  const prepared = prepareTemplate(source, senderName);
  const entry = { source, lang, senderName, prepared, subject: c.subject, preheader: c.preheader, hash: sourceHash(prepared, c.subject, c.preheader) };
  templates.set(c.id, entry);
  if (templates.size > TEMPLATE_CACHE) templates.delete(templates.keys().next().value!);
  return entry;
}

export interface RenderableMessage {
  id: string;
  account_id: string;
  campaign_id: string | null;
  contact_id: string | null;
  to_email: string;
}

/**
 * Renders a campaign message the way createMessage used to store it (same messageId-based links, footer,
 * pixel), from the campaign's HTML and the contact's current merge fields. null if the campaign is gone.
 */
export function renderCampaignMessage(
  db: DatabaseSync,
  config: AppConfig,
  m: RenderableMessage,
  preload: { campaign?: CampaignTemplateRow; contact?: MergeContact | null; language?: string | null } = {},
): RenderedEmail | null {
  if (!m.campaign_id) return null;
  const campaign = preload.campaign ?? loadCampaignTemplate(db, m.campaign_id);
  if (!campaign) return null;
  let contact = preload.contact;
  if (contact === undefined) {
    contact = m.contact_id
      ? (get<MergeContact & { language: string | null }>(db, 'SELECT email, first_name, last_name, language FROM contacts WHERE id = ?', m.contact_id) ?? null)
      : null;
  }
  const merge: MergeContact = contact ?? { email: m.to_email };
  const contactLang = preload.language !== undefined ? preload.language : ((contact as { language?: string | null } | null)?.language ?? null);
  return withAccountLang(db, m.account_id, () => {
    const t = preparedFor(db, config, campaign);
    let { prepared } = t;
    let subject = campaign.subject;
    let preheader = campaign.preheader;
    // Traduction automatique : la version de la langue du contact, si elle a été faite pour ce modèle-ci.
    if (campaign.auto_translate && contactLang && !sameLanguage(contactLang, campaignLanguage(db, campaign))) {
      const tr = translationFor(db, campaign, contactLang);
      if (tr && tr.source_hash === t.hash) {
        prepared = tr.html;
        subject = tr.subject;
        preheader = tr.preheader;
      }
    }
    return personalizeEmail(prepared, { messageId: m.id, publicUrl: config.publicUrl, subject, preheader, contact: merge });
  });
}

/** Le modèle commun d'une campagne, tel que les destinataires le reçoivent (pour le traduire). */
export function campaignTranslationSource(db: DatabaseSync, config: AppConfig, c: CampaignTemplateRow): TranslationSource {
  return withAccountLang(db, c.account_id, () => {
    const t = preparedFor(db, config, c);
    const account = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', c.account_id)?.name;
    const keep = [...new Set([t.senderName, account].filter((v): v is string => Boolean(v)))];
    return { prepared: t.prepared, subject: c.subject, preheader: c.preheader, hash: t.hash, keep };
  });
}

/** The HTML of a message: stored for automation / test / old campaign emails, rendered again otherwise. */
export function messageHtml(db: DatabaseSync, config: AppConfig, row: Row): string {
  const stored = typeof row.html === 'string' ? row.html : '';
  if (stored || !row.campaign_id) return stored;
  return (
    renderCampaignMessage(db, config, {
      id: String(row.id),
      account_id: String(row.account_id),
      campaign_id: String(row.campaign_id),
      contact_id: (row.contact_id as string | null) ?? null,
      to_email: String(row.to_email),
    })?.html ?? ''
  );
}

/** `html` overrides the stored HTML (pass messageHtml() for campaign messages, which store none). */
export function serializeMessage(row: Row, includeHtml: boolean, html?: string) {
  const base = {
    id: String(row.id),
    campaign_id: (row.campaign_id as string | null) ?? null,
    automation_id: (row.automation_id as string | null) ?? null,
    contact_id: (row.contact_id as string | null) ?? null,
    to_email: String(row.to_email),
    subject: String(row.subject),
    status: String(row.status),
    provider_id: (row.provider_id as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    opened_at: (row.opened_at as string | null) ?? null,
    clicked_at: (row.clicked_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
  return includeHtml ? { ...base, html: html ?? String(row.html ?? '') } : base;
}

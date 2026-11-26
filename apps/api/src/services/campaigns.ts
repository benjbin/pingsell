import type { AppConfig } from '../config.js';
import { all, get, now, run, scalar, transaction, type DatabaseSync, type Row } from '../db.js';
import { compileRules, loadSegmentRules, type CompiledRules } from './segments.js';
import { bumpCampaign } from './messages.js';
import { renderSubject } from './render.js';
import { AUDIENCE_START, SUNSET_DAYS, audiencePage, parsePauseReason, type AudienceCursor, type Recipient } from './deliverability.js';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignStatsSummary {
  recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
}

export interface CampaignStatsDetail extends CampaignStatsSummary {
  failed: number;
  unsubscribed: number;
  timeline: { hour: string; opens: number; clicks: number }[];
}

export function serializeCampaign(row: Row) {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name),
    subject: String(row.subject ?? ''),
    preheader: (row.preheader as string | null) ?? null,
    from_name: (row.from_name as string | null) ?? null,
    from_email: (row.from_email as string | null) ?? null,
    html: (row.html as string | null) ?? null,
    design: (row.design as string | null) ?? null,
    segment_id: (row.segment_id as string | null) ?? null,
    contact_ids: parseIds(row.contact_ids),
    status: row.status as CampaignStatus,
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    /** Why the sending is on hold (automatic guard or by hand); null while it runs. */
    paused: parsePauseReason(row.paused_reason),
    /** Inactive contacts left out of the send (mailed many times, never opened). */
    skipped_inactive: Number(row.skipped_inactive ?? 0),
    /** Langue dans laquelle la campagne est écrite (null : celle du compte). */
    language: (row.language as string | null) ?? null,
    /** Traduite automatiquement dans la langue de chaque contact. */
    auto_translate: Number(row.auto_translate ?? 0) === 1,
    translated_at: (row.translated_at as string | null) ?? null,
    translate_error: (row.translate_error as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function parseIds(v: unknown): string[] | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const ids = JSON.parse(v);
    // [] is kept: "chosen contacts" with nobody chosen must reach nobody, never fall back to everyone.
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export const rate = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 10000) / 10000 : 0);

const EMPTY_SUMMARY: CampaignStatsSummary = { recipients: 0, sent: 0, opened: 0, clicked: 0, open_rate: 0, click_rate: 0 };

interface CounterRow {
  id: string;
  counters_ok: number;
  n_total: number;
  n_queued: number;
  n_sent: number;
  n_failed: number;
  n_bounced: number;
  n_opened: number;
  n_clicked: number;
  n_unsub: number;
}

const COUNTER_COLS = 'id, counters_ok, n_total, n_queued, n_sent, n_failed, n_bounced, n_opened, n_clicked, n_unsub';

export function campaignCounters(db: DatabaseSync, campaignId: string): CounterRow | undefined {
  return get<CounterRow>(db, `SELECT ${COUNTER_COLS} FROM campaigns WHERE id = ?`, campaignId);
}

function summary(recipients: number, sent: number, opened: number, clicked: number): CampaignStatsSummary {
  return { recipients, sent, opened, clicked, open_rate: rate(opened, sent), click_rate: rate(clicked, sent) };
}

/**
 * Stats for many campaigns: read from the counters kept on each campaign (no scan of the messages).
 * Campaigns the worker has not caught up yet (sent before the counters existed) are counted the old way.
 */
export function campaignStatsMap(db: DatabaseSync, campaignIds: string[]): Map<string, CampaignStatsSummary> {
  const map = new Map<string, CampaignStatsSummary>();
  if (!campaignIds.length) return map;
  const placeholders = campaignIds.map(() => '?').join(',');
  const legacy: string[] = [];
  for (const c of all<CounterRow>(db, `SELECT ${COUNTER_COLS} FROM campaigns WHERE id IN (${placeholders})`, ...campaignIds)) {
    if (Number(c.counters_ok)) map.set(c.id, summary(Number(c.n_total), Number(c.n_sent), Number(c.n_opened), Number(c.n_clicked)));
    else legacy.push(c.id);
  }
  if (!legacy.length) return map;
  const rows = all<{ campaign_id: string; recipients: number; sent: number; opened: number; clicked: number }>(
    db,
    `SELECT campaign_id,
            COUNT(*) AS recipients,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
       FROM messages WHERE campaign_id IN (${legacy.map(() => '?').join(',')}) GROUP BY campaign_id`,
    ...legacy,
  );
  for (const r of rows) map.set(r.campaign_id, summary(Number(r.recipients ?? 0), Number(r.sent ?? 0), Number(r.opened ?? 0), Number(r.clicked ?? 0)));
  return map;
}

export function campaignStatsSummary(db: DatabaseSync, campaignId: string): CampaignStatsSummary {
  return campaignStatsMap(db, [campaignId]).get(campaignId) ?? { ...EMPTY_SUMMARY };
}

const HOUR_MS = 3_600_000;
const MAX_FILLED_HOURS = 168;

function hourKey(iso: string): string {
  return `${iso.slice(0, 13)}:00:00.000Z`;
}

export function campaignStatsDetail(db: DatabaseSync, campaignId: string): CampaignStatsDetail {
  const summary = campaignStatsSummary(db, campaignId);
  const counters = campaignCounters(db, campaignId);
  const buckets = new Map<string, { opens: number; clicks: number }>();
  let failed: number;
  let unsubscribed: number;
  if (counters && Number(counters.counters_ok)) {
    failed = Number(counters.n_failed);
    unsubscribed = Number(counters.n_unsub);
    for (const r of all<{ hour: string; opens: number; clicks: number }>(db, 'SELECT hour, opens, clicks FROM campaign_hours WHERE campaign_id = ?', campaignId)) {
      if (Number(r.opens) || Number(r.clicks)) buckets.set(r.hour, { opens: Number(r.opens), clicks: Number(r.clicks) });
    }
  } else {
    // Not caught up yet by the worker: counted from the messages (bounded: older campaigns only).
    failed = scalar(db, "SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status = 'failed'", campaignId);
    unsubscribed = legacyUnsubscribes(db, campaignId);
    const add = (key: string, field: 'opens' | 'clicks', n: number) => {
      const b = buckets.get(key) ?? { opens: 0, clicks: 0 };
      b[field] += n;
      buckets.set(key, b);
    };
    for (const r of all<{ h: string; n: number }>(
      db,
      `SELECT substr(opened_at, 1, 13) AS h, COUNT(*) AS n FROM messages
        WHERE campaign_id = ? AND opened_at IS NOT NULL GROUP BY h`,
      campaignId,
    )) add(`${r.h}:00:00.000Z`, 'opens', Number(r.n));
    for (const r of all<{ h: string; n: number }>(
      db,
      `SELECT substr(clicked_at, 1, 13) AS h, COUNT(*) AS n FROM messages
        WHERE campaign_id = ? AND clicked_at IS NOT NULL GROUP BY h`,
      campaignId,
    )) add(`${r.h}:00:00.000Z`, 'clicks', Number(r.n));
  }

  const timeline: CampaignStatsDetail['timeline'] = [];
  const keys = [...buckets.keys()].sort();
  if (keys.length) {
    const campaign = get<{ sent_at: string | null }>(db, 'SELECT sent_at FROM campaigns WHERE id = ?', campaignId);
    const startKey = campaign?.sent_at && hourKey(campaign.sent_at) < keys[0] ? hourKey(campaign.sent_at) : keys[0];
    const start = Date.parse(startKey);
    const end = Date.parse(keys[keys.length - 1]);
    const span = Math.round((end - start) / HOUR_MS) + 1;
    if (span <= MAX_FILLED_HOURS) {
      for (let t = start; t <= end; t += HOUR_MS) {
        const key = new Date(t).toISOString();
        const b = buckets.get(key) ?? { opens: 0, clicks: 0 };
        timeline.push({ hour: key, opens: b.opens, clicks: b.clicks });
      }
    } else {
      for (const key of keys) timeline.push({ hour: key, ...buckets.get(key)! });
    }
  }

  return { ...summary, failed, unsubscribed, timeline };
}

/**
 * Unsubscribes recorded before events had a campaign_id column: read from the JSON, limited to this account's
 * unsubscribe events since the campaign was created (index range), never joined with the messages.
 */
function legacyUnsubscribes(db: DatabaseSync, campaignId: string): number {
  const c = get<{ account_id: string; created_at: string }>(db, 'SELECT account_id, created_at FROM campaigns WHERE id = ?', campaignId);
  if (!c) return 0;
  return scalar(
    db,
    `SELECT COUNT(DISTINCT contact_id) FROM events
      WHERE account_id = ? AND type = 'unsubscribe' AND created_at >= ?
        AND (campaign_id = ? OR (campaign_id IS NULL AND json_extract(data, '$.campaign_id') = ?))`,
    c.account_id,
    c.created_at,
    campaignId,
    campaignId,
  );
}

/**
 * SQL filter selecting the audience of a campaign (chosen contacts, segment rules, or everyone) — always subscribed only:
 * an unsubscribed contact never gets a campaign, even when picked by hand.
 */
export function audienceFilter(db: DatabaseSync, accountId: string, segmentId: string | null, contactIds?: string[] | null): CompiledRules | undefined {
  if (contactIds && !contactIds.length) return { sql: '0', params: [] };
  if (contactIds?.length) return { sql: `id IN (${contactIds.map(() => '?').join(',')}) AND status = 'subscribed'`, params: contactIds };
  if (!segmentId) return { sql: "status = 'subscribed'", params: [] };
  const rules = loadSegmentRules(db, accountId, segmentId);
  if (!rules) return undefined;
  const compiled = compileRules(rules);
  return { sql: `${compiled.sql} AND status = 'subscribed'`, params: compiled.params };
}

export function audienceCount(db: DatabaseSync, accountId: string, segmentId: string | null, contactIds?: string[] | null): number {
  const filter = audienceFilter(db, accountId, segmentId, contactIds);
  if (!filter) return 0;
  return scalar(db, `SELECT COUNT(*) FROM contacts WHERE account_id = ? AND ${filter.sql}`, accountId, ...filter.params);
}

/** Whether the audience has at least one subscribed contact: stops at the first one instead of counting 2 M rows. */
export function audienceExists(db: DatabaseSync, accountId: string, segmentId: string | null, contactIds?: string[] | null): boolean {
  const filter = audienceFilter(db, accountId, segmentId, contactIds);
  if (!filter) return false;
  return !!get(db, `SELECT 1 AS x FROM contacts WHERE account_id = ? AND ${filter.sql} LIMIT 1`, accountId, ...filter.params);
}

/** Longest stretch the queueing may hold the event loop before letting requests through. */
const QUEUE_SLICE_MS = 40;
/** Chosen contacts are read by chunks of this many ids. */
const CHOSEN_CHUNK = 400;

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * UUID v7 (time-ordered, 74 random bits): consecutive messages land side by side in the primary-key index
 * instead of all over it, so a queueing slice dirties (and writes to the WAL) far fewer pages.
 */
export function timeOrderedId(at = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ms = at;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Creates one queued message per recipient for a campaign in `sending` state, in short transactions
 * that yield to the event loop between them, so the API keeps answering while a large campaign is queued.
 *
 * The audience is paged (contacts index range, never loaded whole), the position is saved with each slice
 * (campaigns.queue_cursor) so a restart resumes where it stopped, and a unique index on (campaign, contact)
 * makes a recipient impossible to queue twice. Messages are stored without their HTML: the worker renders
 * each one from campaigns.html right before handing it to the provider. `queued_at` marks the end.
 */
export async function queueCampaign(db: DatabaseSync, config: AppConfig, campaignId: string, opts: { aborted?: () => boolean } = {}): Promise<number> {
  const row = get(db, "SELECT * FROM campaigns WHERE id = ? AND status = 'sending' AND queued_at IS NULL AND deleted_at IS NULL", campaignId);
  if (!row) return 0;
  const campaign = serializeCampaign(row);
  let cursor: AudienceCursor | null = parseCursor(row.queue_cursor);

  if (!cursor) {
    cursor = { ...AUDIENCE_START, at: Date.now() };
    // First run: counters start from zero. A campaign half-queued by an older version keeps counters_ok = 0
    // (the worker's catch-up counts its old messages).
    const legacy = get(db, 'SELECT 1 AS x FROM messages WHERE campaign_id = ? LIMIT 1', campaignId);
    if (legacy) run(db, 'UPDATE campaigns SET skipped_inactive = 0, queue_cursor = ? WHERE id = ?', JSON.stringify(cursor), campaignId);
    else {
      run(
        db,
        `UPDATE campaigns SET skipped_inactive = 0, queue_cursor = ?, lean = 1, counters_ok = 1,
                n_total = 0, n_queued = 0, n_sent = 0, n_failed = 0, n_bounced = 0, n_opened = 0, n_clicked = 0,
                n_complained = 0, n_unsub = 0, g_handled = 0, g_bounces = 0, g_blocks = 0, g_complaints = 0
          WHERE id = ?`,
        JSON.stringify(cursor),
        campaignId,
      );
      run(db, 'DELETE FROM campaign_hours WHERE campaign_id = ?', campaignId);
    }
  }

  const filter = audienceFilter(db, campaign.account_id, campaign.segment_id, campaign.contact_ids);
  const chosen = campaign.contact_ids?.length ? campaign.contact_ids : null;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO messages (id, account_id, campaign_id, contact_id, to_email, subject, html, status, in_queue, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', 'queued', 1, ?)`,
  );
  const publicUrl = config.publicUrl;

  let queued = 0;
  // Work budget of one transaction, adjusted so work + COMMIT (writing the touched index pages to the WAL)
  // stays around QUEUE_SLICE_MS.
  let budget = QUEUE_SLICE_MS / 2;
  while (filter && cursor) {
    // Worker shutting down: the cursor is saved, the next start resumes from there.
    if (opts.aborted?.()) return queued;
    // Stop if the campaign was stopped or deleted meanwhile.
    if (!get(db, "SELECT 1 AS ok FROM campaigns WHERE id = ? AND status = 'sending' AND deleted_at IS NULL", campaignId)) return queued;
    const sliceStart = Date.now();
    transaction(db, () => {
      const until = Date.now() + budget;
      const createdAt = now();
      let inserted = 0;
      let skipped = 0;
      const add = (contacts: Recipient[]) => {
        for (const contact of contacts) {
          const id = timeOrderedId();
          const subject = renderSubject(campaign.subject, contact, publicUrl, id);
          inserted += Number(insert.run(id, campaign.account_id, campaignId, contact.id, contact.email, subject, createdAt).changes);
        }
      };
      do {
        if (chosen) {
          // Hand-picked contacts (at most a few thousand): in the order chosen, nobody left out by the sunset.
          const ids = chosen.slice(cursor!.after, cursor!.after + CHOSEN_CHUNK);
          add(
            all<Recipient>(
              db,
              `SELECT id, email, first_name, last_name FROM contacts
                WHERE account_id = ? AND status = 'subscribed' AND id IN (${ids.map(() => '?').join(',')})`,
              campaign.account_id,
              ...ids,
            ),
          );
          const after: number = cursor!.after + CHOSEN_CHUNK;
          cursor = after < chosen.length ? { tier: 0, after } : null;
        } else {
          // Engaged contacts first, long-inactive contacts left out (see deliverability.ts).
          const page = audiencePage(db, campaign.account_id, filter, cursor!, { sunset: true, campaignId });
          add(page.recipients);
          skipped += page.skipped;
          cursor = page.next;
        }
      } while (cursor && Date.now() < until);
      run(
        db,
        `UPDATE campaigns SET queue_cursor = ?, skipped_inactive = skipped_inactive + ?,
                n_total = n_total + CASE WHEN counters_ok = 1 THEN ? ELSE 0 END,
                n_queued = n_queued + CASE WHEN counters_ok = 1 THEN ? ELSE 0 END
          WHERE id = ?`,
        cursor ? JSON.stringify(cursor) : null,
        skipped,
        inserted,
        inserted,
        campaignId,
      );
      queued += inserted;
    });
    const took = Date.now() - sliceStart;
    budget = took > QUEUE_SLICE_MS ? Math.max(2, budget * 0.7) : took < QUEUE_SLICE_MS * 0.6 ? Math.min(QUEUE_SLICE_MS, budget * 1.2) : budget;
    await yieldToEventLoop();
  }

  const any = get(db, 'SELECT 1 AS x FROM messages WHERE campaign_id = ? LIMIT 1', campaignId);
  if (!any) {
    run(db, "UPDATE campaigns SET status = 'failed', queued_at = ?, queue_cursor = NULL, updated_at = ? WHERE id = ?", now(), now(), campaignId);
    return 0;
  }
  run(db, 'UPDATE campaigns SET queued_at = ?, queue_cursor = NULL WHERE id = ?', now(), campaignId);
  return queued;
}

function parseCursor(v: unknown): AudienceCursor | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const c = JSON.parse(v) as AudienceCursor;
    return typeof c?.tier === 'number' && typeof c?.after === 'number' ? c : null;
  } catch {
    return null;
  }
}

/** Is there still something to send for this campaign? (index probe on the queue) */
export function hasQueue(db: DatabaseSync, campaignId: string): boolean {
  // INDEXED BY: otherwise idx_messages_campaign walks every message the campaign already sent (see worker.ts, COLS).
  return !!get(db, 'SELECT 1 AS x FROM messages INDEXED BY idx_messages_queue WHERE in_queue = 1 AND campaign_id = ? LIMIT 1', campaignId);
}

/** Whether at least one email of the campaign left (sent, or sent then bounced). */
export function anySent(db: DatabaseSync, campaignId: string): boolean {
  const c = campaignCounters(db, campaignId);
  if (c && Number(c.counters_ok)) return Number(c.n_sent) + Number(c.n_bounced) > 0;
  return !!get(db, "SELECT 1 AS x FROM messages WHERE campaign_id = ? AND status IN ('sent', 'bounced') LIMIT 1", campaignId);
}

/** Marks `sending` campaigns as `sent` (or `failed`) once no message is left in the queue. One index probe per campaign. */
export function finalizeCampaigns(db: DatabaseSync): void {
  const rows = all<{ id: string }>(db, "SELECT id FROM campaigns WHERE status = 'sending' AND queued_at IS NOT NULL");
  const timestamp = now();
  for (const r of rows) {
    if (hasQueue(db, r.id)) continue;
    const status = anySent(db, r.id) ? 'sent' : 'failed';
    run(db, "UPDATE campaigns SET status = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'", status, timestamp, timestamp, r.id);
  }
}

/**
 * Stop: the campaign ends at once with what already left (the worker no longer picks its queue up),
 * the emails not sent yet are deleted afterwards in small chunks (purgeStoppedQueues).
 */
export function stopCampaign(db: DatabaseSync, campaignId: string): void {
  const status = anySent(db, campaignId) ? 'sent' : 'failed';
  run(
    db,
    `UPDATE campaigns SET status = ?, paused_reason = NULL, purge_pending = 1, queue_cursor = NULL,
            queued_at = COALESCE(queued_at, ?), sent_at = COALESCE(sent_at, ?), updated_at = ?
      WHERE id = ?`,
    status,
    now(),
    now(),
    now(),
    campaignId,
  );
}

function backfillCursor(db: DatabaseSync): number {
  const row = get<{ value: string }>(db, "SELECT value FROM app_state WHERE key = 'backfill_cursor'");
  return row ? Number(row.value) : -1;
}

const PURGE_SLICE_MS = 40;

/** Deletes the queues left by stopped campaigns, a chunk at a time. */
export async function purgeStoppedQueues(db: DatabaseSync, budgetMs = 200): Promise<number> {
  const started = Date.now();
  let deleted = 0;
  // Chunk size adapts so each transaction stays around PURGE_SLICE_MS (a delete touches every index of the row).
  let chunk = 100;
  for (const c of all<{ id: string; counters_ok: number }>(db, "SELECT id, counters_ok FROM campaigns WHERE purge_pending = 1 AND status != 'sending'")) {
    for (;;) {
      const t = Date.now();
      const done = transaction(db, () => {
        const rows = all<{ rid: number }>(db, 'SELECT rowid AS rid FROM messages INDEXED BY idx_messages_queue WHERE in_queue = 1 AND campaign_id = ? LIMIT ?', c.id, chunk);
        if (!rows.length) {
          run(db, 'UPDATE campaigns SET purge_pending = 0 WHERE id = ?', c.id);
          return true;
        }
        const rids = rows.map((r) => r.rid);
        run(db, `DELETE FROM messages WHERE rowid IN (${rids.map(() => '?').join(',')})`, ...rids);
        // A campaign from before the counters only has its counted messages taken off.
        const cursor = Number(c.counters_ok) ? Infinity : backfillCursor(db);
        const counted = rids.filter((r) => r <= cursor).length;
        if (counted) bumpCampaign(db, c.id, -1, { n_total: -counted, n_queued: -counted });
        deleted += rids.length;
        return false;
      });
      const took = Date.now() - t;
      chunk = took > PURGE_SLICE_MS ? Math.max(20, Math.floor(chunk / 2)) : took < PURGE_SLICE_MS / 3 ? Math.min(2000, chunk * 2) : chunk;
      if (done || Date.now() - started > budgetMs) break;
      await yieldToEventLoop();
    }
    if (Date.now() - started > budgetMs) break;
  }
  return deleted;
}

/* ---------------------------------------------------------- catch-up of older data */

const BACKFILL_SLICE_MS = 40;
const BACKFILL_CHUNK = 25; // old messages carry ~150 KB of HTML each: small chunks

interface LegacyRow {
  rid: number;
  campaign_id: string | null;
  contact_id: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  complained_at: string | null;
}

/**
 * One-off background walk over the messages written before the counters existed: fills the counters of the
 * campaigns from back then (counters_ok = 0) and the engagement columns of their contacts. Restart-safe: the
 * position is saved with each chunk (app_state.backfill_cursor); returns true once everything is caught up.
 */
export async function backfillLegacy(db: DatabaseSync, budgetMs = 400): Promise<boolean> {
  const state = (key: string) => get<{ value: string }>(db, 'SELECT value FROM app_state WHERE key = ?', key)?.value;
  if (state('backfill_done')) return true;
  const setState = (key: string, value: string | number) => run(db, 'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', key, String(value));
  if (state('backfill_max_rowid') === undefined) {
    transaction(db, () => {
      setState('backfill_max_rowid', scalar(db, 'SELECT COALESCE(MAX(rowid), 0) FROM messages'));
      setState('backfill_cursor', 0);
    });
  }
  const max = Number(state('backfill_max_rowid'));
  const legacy = new Map(
    all<{ id: string; guard_since: string | null }>(db, 'SELECT id, guard_since FROM campaigns WHERE counters_ok = 0').map((c) => [c.id, c.guard_since]),
  );
  const sunsetSince = new Date(Date.now() - SUNSET_DAYS * 86_400_000).toISOString();
  const started = Date.now();

  for (;;) {
    const finished = transaction(db, () => {
      const until = Date.now() + BACKFILL_SLICE_MS;
      let cursor = Number(state('backfill_cursor') ?? 0);
      const camp = new Map<string, Record<string, number>>();
      const hours = new Map<string, { opens: number; clicks: number }>();
      const contacts = new Map<string, { sent: string | null; engaged: string | null; unopened: number }>();
      let rows: LegacyRow[] = [];
      do {
        rows = all<LegacyRow>(
          db,
          `SELECT rowid AS rid, campaign_id, contact_id, status, error, sent_at, opened_at, clicked_at, complained_at
             FROM messages WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`,
          cursor,
          max,
          BACKFILL_CHUNK,
        );
        for (const m of rows) {
          cursor = m.rid;
          if (m.contact_id && (m.status === 'sent' || m.status === 'bounced' || m.sent_at)) {
            const c = contacts.get(m.contact_id) ?? { sent: null, engaged: null, unopened: 0 };
            const engaged = m.clicked_at && (!m.opened_at || m.clicked_at > m.opened_at) ? m.clicked_at : m.opened_at;
            if (m.sent_at && (!c.sent || m.sent_at > c.sent)) c.sent = m.sent_at;
            if (engaged && (!c.engaged || engaged > c.engaged)) c.engaged = engaged;
            if (!engaged && m.sent_at && m.sent_at >= sunsetSince) c.unopened++;
            contacts.set(m.contact_id, c);
          }
          if (!m.campaign_id || !legacy.has(m.campaign_id)) continue;
          const since = legacy.get(m.campaign_id);
          const d = camp.get(m.campaign_id) ?? {};
          const inc = (k: string, n = 1) => (d[k] = (d[k] ?? 0) + n);
          inc('n_total');
          if (m.status === 'queued') inc('n_queued');
          else if (m.status === 'sent') inc('n_sent');
          else if (m.status === 'failed') inc('n_failed');
          else if (m.status === 'bounced') inc('n_bounced');
          if (m.opened_at) inc('n_opened');
          if (m.clicked_at) inc('n_clicked');
          if (m.complained_at) inc('n_complained');
          if (m.sent_at && m.status !== 'queued' && (!since || m.sent_at >= since)) {
            inc('g_handled');
            if (m.status === 'bounced') inc('g_bounces');
            if (m.status === 'failed' && /^5\.7\./.test(m.error ?? '')) inc('g_blocks');
            if (m.complained_at) inc('g_complaints');
          }
          camp.set(m.campaign_id, d);
          for (const [at, field] of [
            [m.opened_at, 'opens'],
            [m.clicked_at, 'clicks'],
          ] as const) {
            if (!at) continue;
            const key = `${m.campaign_id}|${at.slice(0, 13)}:00:00.000Z`;
            const h = hours.get(key) ?? { opens: 0, clicks: 0 };
            h[field]++;
            hours.set(key, h);
          }
        }
      } while (rows.length === BACKFILL_CHUNK && Date.now() < until);

      for (const [id, c] of contacts) {
        run(
          db,
          `UPDATE contacts SET last_sent_at = CASE WHEN ? IS NOT NULL AND (last_sent_at IS NULL OR last_sent_at < ?) THEN ? ELSE last_sent_at END,
                  last_engaged_at = CASE WHEN ? IS NOT NULL AND (last_engaged_at IS NULL OR last_engaged_at < ?) THEN ? ELSE last_engaged_at END,
                  sends_since_engaged = sends_since_engaged + ?
            WHERE id = ?`,
          c.sent,
          c.sent,
          c.sent,
          c.engaged,
          c.engaged,
          c.engaged,
          c.unopened,
          id,
        );
      }
      for (const [id, d] of camp) {
        const keys = Object.keys(d);
        run(db, `UPDATE campaigns SET ${keys.map((k) => `${k} = ${k} + ?`).join(', ')} WHERE id = ? AND counters_ok = 0`, ...keys.map((k) => d[k]), id);
      }
      for (const [key, h] of hours) {
        const [campaignId, hour] = key.split('|');
        run(
          db,
          `INSERT INTO campaign_hours (campaign_id, hour, opens, clicks) VALUES (?, ?, ?, ?)
           ON CONFLICT (campaign_id, hour) DO UPDATE SET opens = opens + excluded.opens, clicks = clicks + excluded.clicks`,
          campaignId,
          hour,
          h.opens,
          h.clicks,
        );
      }
      setState('backfill_cursor', cursor);
      if (rows.length === BACKFILL_CHUNK) return false;

      // Walk over: unsubscribes of the older campaigns, then their counters are live.
      for (const id of legacy.keys()) {
        run(db, 'UPDATE campaigns SET n_unsub = ?, counters_ok = 1 WHERE id = ? AND counters_ok = 0', legacyUnsubscribes(db, id), id);
      }
      setState('backfill_done', now());
      return true;
    });
    if (finished) return true;
    if (Date.now() - started > budgetMs) return false;
    await yieldToEventLoop();
  }
}

import type { AppConfig } from '../config.js';
import { all, get, now, run, scalar, transaction, type DatabaseSync, type Row } from '../db.js';
import { compileRules, loadSegmentRules, type CompiledRules } from './segments.js';
import { accountSender, createMessage } from './messages.js';
import { orderedRecipients, parsePauseReason } from './deliverability.js';

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

/** Aggregated stats for many campaigns in a single query. */
export function campaignStatsMap(db: DatabaseSync, campaignIds: string[]): Map<string, CampaignStatsSummary> {
  const map = new Map<string, CampaignStatsSummary>();
  if (!campaignIds.length) return map;
  const placeholders = campaignIds.map(() => '?').join(',');
  const rows = all<{ campaign_id: string; recipients: number; sent: number; opened: number; clicked: number }>(
    db,
    `SELECT campaign_id,
            COUNT(*) AS recipients,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
       FROM messages WHERE campaign_id IN (${placeholders}) GROUP BY campaign_id`,
    ...campaignIds,
  );
  for (const r of rows) {
    const sent = Number(r.sent ?? 0);
    const opened = Number(r.opened ?? 0);
    const clicked = Number(r.clicked ?? 0);
    map.set(r.campaign_id, {
      recipients: Number(r.recipients ?? 0),
      sent,
      opened,
      clicked,
      open_rate: rate(opened, sent),
      click_rate: rate(clicked, sent),
    });
  }
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
  const failed = scalar(db, "SELECT COUNT(*) FROM messages WHERE campaign_id = ? AND status = 'failed'", campaignId);
  const unsubscribed = scalar(
    db,
    `SELECT COUNT(DISTINCT e.contact_id) FROM events e
       JOIN messages m ON m.id = json_extract(e.data, '$.message_id')
      WHERE e.type = 'unsubscribe' AND m.campaign_id = ?`,
    campaignId,
  );

  const buckets = new Map<string, { opens: number; clicks: number }>();
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

/** Longest stretch the queueing may hold the event loop before letting requests through. */
const QUEUE_SLICE_MS = 50;

/**
 * Creates one queued message per recipient for a campaign in `sending` state, in short transactions
 * that yield to the event loop between them, so the API keeps answering while a large campaign is queued.
 * Resumable: recipients that already have a message are skipped, and `queued_at` marks the end.
 */
export async function queueCampaign(db: DatabaseSync, config: AppConfig, campaignId: string): Promise<number> {
  const row = get(db, "SELECT * FROM campaigns WHERE id = ? AND status = 'sending' AND queued_at IS NULL", campaignId);
  if (!row) return 0;
  const campaign = serializeCampaign(row);

  const filter = audienceFilter(db, campaign.account_id, campaign.segment_id, campaign.contact_ids);
  // Engaged contacts first, mailbox providers interleaved, long-inactive contacts left out
  // (except when chosen by hand: then the merchant decided).
  const { recipients, skipped } = filter
    ? orderedRecipients(db, campaign.account_id, filter, { sunset: !campaign.contact_ids?.length })
    : { recipients: [], skipped: 0 };
  run(db, 'UPDATE campaigns SET skipped_inactive = ? WHERE id = ?', skipped, campaignId);

  const done = new Set(
    all<{ contact_id: string | null }>(db, 'SELECT contact_id FROM messages WHERE campaign_id = ?', campaignId).map((r) => r.contact_id),
  );
  if (!recipients.length && !done.size) {
    run(db, "UPDATE campaigns SET status = 'failed', queued_at = ?, updated_at = ? WHERE id = ?", now(), now(), campaignId);
    return 0;
  }
  const senderName = campaign.from_name || accountSender(db, config, campaign.account_id).name;
  let queued = 0;
  let i = 0;
  while (i < recipients.length) {
    // Stop if the campaign was cancelled or deleted meanwhile.
    if (!get(db, "SELECT 1 AS ok FROM campaigns WHERE id = ? AND status = 'sending'", campaignId)) return queued;
    transaction(db, () => {
      const until = Date.now() + QUEUE_SLICE_MS;
      do {
        const contact = recipients[i++];
        if (done.has(contact.id)) continue;
        createMessage(db, config, {
          accountId: campaign.account_id,
          campaignId,
          contactId: contact.id,
          contact,
          subject: campaign.subject,
          html: campaign.html ?? '',
          preheader: campaign.preheader,
          senderName,
        });
        queued++;
      } while (i < recipients.length && Date.now() < until);
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  run(db, 'UPDATE campaigns SET queued_at = ? WHERE id = ?', now(), campaignId);
  return queued;
}

/** Marks `sending` campaigns as `sent` (or `failed`) once no message is left in the queue. */
export function finalizeCampaigns(db: DatabaseSync): void {
  const rows = all<{ id: string; total: number; queued: number; sent: number }>(
    db,
    `SELECT c.id,
            COUNT(m.id) AS total,
            SUM(CASE WHEN m.status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN m.status = 'sent' THEN 1 ELSE 0 END) AS sent
       FROM campaigns c JOIN messages m ON m.campaign_id = c.id
      WHERE c.status = 'sending' AND c.queued_at IS NOT NULL
      GROUP BY c.id`,
  );
  const timestamp = now();
  for (const r of rows) {
    if (Number(r.total) === 0 || Number(r.queued) > 0) continue;
    const status = Number(r.sent) > 0 ? 'sent' : 'failed';
    run(db, 'UPDATE campaigns SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?', status, timestamp, timestamp, r.id);
  }
}

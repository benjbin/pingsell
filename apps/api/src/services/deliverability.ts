import { all, now, run, type DatabaseSync, type SQLInputValue } from '../db.js';

/**
 * Keeps big sends out of the spam folder.
 *
 *  - Order: engaged contacts first (they open, which builds the reputation the rest will ride on),
 *    then new / never-mailed contacts, then the cold ones. Inside each group contacts come in the order
 *    they were added, which is unrelated to their mailbox provider: Gmail, Outlook, Orange… each get a
 *    steady flow in proportion instead of 100 000 emails in a row.
 *  - Sunset: contacts mailed again and again without a single open or click are left out
 *    (they hurt the sender's reputation and are often spam traps). Hand-picked contacts are never left out.
 *  - Guard: a campaign pauses itself as soon as its hard-bounce, block or spam-complaint rate goes
 *    over the mailbox providers' red lines, before the domain's reputation is burnt.
 *
 * Engagement is read from the contact itself (contacts.last_engaged_at / last_sent_at / sends_since_engaged,
 * kept up to date on every send, open and click) so ordering 2 million contacts never scans the message history.
 */

const DAY_MS = 86_400_000;

/** Engaged = opened or clicked within this many days. */
export const ENGAGED_DAYS = 90;
/** Sunset: at least this many emails since the last open or click, and none within SUNSET_DAYS. */
export const SUNSET_MIN_SENT = 5;
export const SUNSET_DAYS = 180;

export interface Recipient {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

/** Where the paging of an audience stands: the group being queued and the last contact rowid seen in it. */
export interface AudienceCursor {
  tier: number;
  after: number;
  /** When queueing started (ms): fixes the tier boundaries for the whole walk. */
  at?: number;
}

export const AUDIENCE_START: AudienceCursor = { tier: 0, after: 0 };
const TIERS = 3;

/**
 * One page of a campaign's audience in sending order: scans at most `scan` (250) subscribed contacts of the account
 * (an index range, whatever the segment's selectivity) and returns those of the current group that match `filter`.
 * `next` is null once the last group is done. `filter` is the SQL audience filter on `contacts` (see audienceFilter).
 */
export function audiencePage(
  db: DatabaseSync,
  accountId: string,
  filter: { sql: string; params: SQLInputValue[] },
  cursor: AudienceCursor,
  opts: { sunset: boolean; at?: number; scan?: number; campaignId?: string },
): { recipients: Recipient[]; skipped: number; next: AudienceCursor | null } {
  const at = opts.at ?? cursor.at ?? Date.now();
  const scan = opts.scan ?? 250;
  const engagedSince = new Date(at - ENGAGED_DAYS * DAY_MS).toISOString();
  const sunsetSince = new Date(at - SUNSET_DAYS * DAY_MS).toISOString();
  const rows = all<Recipient & { rid: number; tier: number; sunset: number }>(
    db,
    `SELECT rowid AS rid, id, email, first_name, last_name,
            CASE WHEN (${filter.sql}) THEN
              CASE WHEN COALESCE(last_engaged_at, '') >= ? THEN 0 WHEN last_sent_at IS NULL THEN 1 ELSE 2 END
            ELSE -1 END AS tier,
            CASE WHEN sends_since_engaged >= ? AND COALESCE(last_engaged_at, '') < ? THEN 1 ELSE 0 END AS sunset
       FROM contacts
      WHERE account_id = ? AND status = 'subscribed' AND rowid > ?${
        opts.campaignId ? ' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = ? AND m.contact_id = contacts.id AND m.in_queue IS NOT NULL)' : ''
      }
      ORDER BY rowid LIMIT ?`,
    ...filter.params,
    engagedSince,
    SUNSET_MIN_SENT,
    sunsetSince,
    accountId,
    cursor.after,
    ...(opts.campaignId ? [opts.campaignId] : []),
    scan,
  );
  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const r of rows) {
    // A later pass also takes contacts whose tier went down after an earlier pass went past them
    // (e.g. a cold contact who opened an older email meanwhile): nobody is left out. The unique index on
    // (campaign, contact) and the NOT EXISTS above keep anyone from being queued twice.
    if (r.tier < 0 || r.tier > cursor.tier) continue;
    if (opts.sunset && r.sunset) {
      skipped++;
      continue;
    }
    recipients.push({ id: r.id, email: r.email, first_name: r.first_name, last_name: r.last_name });
  }
  let next: AudienceCursor | null;
  if (rows.length === scan) next = { tier: cursor.tier, after: rows[rows.length - 1].rid, at };
  else next = cursor.tier + 1 < TIERS ? { tier: cursor.tier + 1, after: 0, at } : null;
  return { recipients, skipped, next };
}

/* ---------------------------------------------------------------- guard */

export type PauseKind = 'bounces' | 'blocks' | 'complaints' | 'manual';

export interface PauseReason {
  kind: PauseKind;
  /** Problem emails / emails handled since the campaign started (or was last resumed). */
  count?: number;
  of?: number;
  rate?: number;
  at: string;
}

/** Red lines. Each needs a minimum count so a single unlucky email never pauses a campaign. */
export const GUARD = {
  bounces: { rate: 0.05, min: 10 }, // addresses that don't exist: a dirty list
  blocks: { rate: 0.1, min: 10 }, // refused for policy / reputation (5.7.x): the providers are pushing back
  complaints: { rate: 0.003, min: 3 }, // "this is spam": Gmail and Yahoo's limit is 0.3 %
} as const;

export function parsePauseReason(v: unknown): PauseReason | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const r = JSON.parse(v) as PauseReason;
    return r && typeof r.kind === 'string' ? r : null;
  } catch {
    return null;
  }
}

export interface GuardStats {
  handled: number;
  bounces: number;
  blocks: number;
  complaints: number;
}

/** The first red line crossed, or null. */
export function crossedLine(s: GuardStats): Omit<PauseReason, 'at'> | null {
  for (const kind of ['complaints', 'bounces', 'blocks'] as const) {
    const count = s[kind];
    const rate = s.handled ? count / s.handled : 0;
    if (count >= GUARD[kind].min && rate >= GUARD[kind].rate) return { kind, count, of: s.handled, rate: Math.round(rate * 10000) / 10000 };
  }
  return null;
}

/**
 * Pauses every sending campaign that crossed a red line. Returns the campaigns paused.
 * Reads the guard counters kept on the campaign (g_*, reset on resume): one small query whatever the campaign size.
 * Campaigns from before the counters are guarded as soon as the worker has caught their counters up.
 */
export function guardCampaigns(db: DatabaseSync): Array<{ id: string; name: string; reason: PauseReason }> {
  const paused: Array<{ id: string; name: string; reason: PauseReason }> = [];
  const campaigns = all<{ id: string; name: string } & GuardStats>(
    db,
    `SELECT id, name, g_handled AS handled, g_bounces AS bounces, g_blocks AS blocks, g_complaints AS complaints
       FROM campaigns WHERE status = 'sending' AND paused_reason IS NULL AND counters_ok = 1`,
  );
  for (const c of campaigns) {
    const line = crossedLine({ handled: Number(c.handled), bounces: Number(c.bounces), blocks: Number(c.blocks), complaints: Number(c.complaints) });
    if (!line) continue;
    const reason: PauseReason = { ...line, at: now() };
    run(db, 'UPDATE campaigns SET paused_reason = ?, updated_at = ? WHERE id = ? AND paused_reason IS NULL', JSON.stringify(reason), now(), c.id);
    paused.push({ id: c.id, name: c.name, reason });
  }
  return paused;
}

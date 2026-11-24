import { all, get, now, run, type DatabaseSync, type SQLInputValue } from '../db.js';

/**
 * Keeps big sends out of the spam folder.
 *
 *  - Order: engaged contacts first (they open, which builds the reputation the rest will ride on),
 *    then new / never-mailed contacts, then the cold ones. Inside each group the mailbox providers
 *    are interleaved in proportion, so Gmail, Outlook, Orange… each get a steady flow instead of
 *    100 000 emails in a row.
 *  - Sunset: contacts mailed again and again without a single open or click are left out
 *    (they hurt the sender's reputation and are often spam traps). Hand-picked contacts are never left out.
 *  - Guard: a campaign pauses itself as soon as its hard-bounce, block or spam-complaint rate goes
 *    over the mailbox providers' red lines, before the domain's reputation is burnt.
 */

const DAY_MS = 86_400_000;

/** Engaged = opened or clicked within this many days. */
export const ENGAGED_DAYS = 90;
/** Sunset: at least this many emails over SUNSET_DAYS without any open or click. */
export const SUNSET_MIN_SENT = 5;
export const SUNSET_DAYS = 180;

export interface Recipient {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

/**
 * The audience of a campaign in sending order, plus how many inactive contacts were left out.
 * `filter` is the SQL audience filter on `contacts` (see audienceFilter).
 */
export function orderedRecipients(
  db: DatabaseSync,
  accountId: string,
  filter: { sql: string; params: SQLInputValue[] },
  opts: { sunset: boolean; at?: number },
): { recipients: Recipient[]; skipped: number } {
  const at = opts.at ?? Date.now();
  const engagedSince = new Date(at - ENGAGED_DAYS * DAY_MS).toISOString();
  const sunsetSince = new Date(at - SUNSET_DAYS * DAY_MS).toISOString();
  const rows = all<Recipient & { tier: number; sunset: number }>(
    db,
    `WITH aud AS (
        SELECT id, email, first_name, last_name, created_at,
               lower(substr(email, instr(email, '@') + 1)) AS dom
          FROM contacts WHERE account_id = ? AND ${filter.sql}
     ),
     eng AS (
        SELECT m.contact_id,
               MAX(COALESCE(m.clicked_at, m.opened_at)) AS last_eng,
               SUM(CASE WHEN m.sent_at >= ? THEN 1 ELSE 0 END) AS recent_sent
          FROM messages m JOIN aud ON aud.id = m.contact_id
         WHERE m.status IN ('sent', 'bounced')
         GROUP BY m.contact_id
     ),
     scored AS (
        SELECT aud.*,
               CASE WHEN eng.last_eng >= ? THEN 0
                    WHEN eng.contact_id IS NULL THEN 1
                    ELSE 2 END AS tier,
               CASE WHEN COALESCE(eng.recent_sent, 0) >= ? AND (eng.last_eng IS NULL OR eng.last_eng < ?) THEN 1 ELSE 0 END AS sunset
          FROM aud LEFT JOIN eng ON eng.contact_id = aud.id
     )
     SELECT id, email, first_name, last_name, tier, sunset,
            (ROW_NUMBER() OVER (PARTITION BY tier, dom ORDER BY created_at, id) * 1.0)
              / COUNT(*) OVER (PARTITION BY tier, dom) AS spread
       FROM scored
      ORDER BY tier, spread, dom`,
    accountId,
    ...filter.params,
    sunsetSince,
    engagedSince,
    SUNSET_MIN_SENT,
    sunsetSince,
  );
  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (opts.sunset && r.sunset) {
      skipped++;
      continue;
    }
    recipients.push({ id: r.id, email: r.email, first_name: r.first_name, last_name: r.last_name });
  }
  return { recipients, skipped };
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

export function guardStats(db: DatabaseSync, campaignId: string, since: string | null): GuardStats {
  const row = get<GuardStats>(
    db,
    `SELECT COUNT(*) AS handled,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounces,
            SUM(CASE WHEN status = 'failed' AND error LIKE '5.7.%' THEN 1 ELSE 0 END) AS blocks,
            SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complaints
       FROM messages
      WHERE campaign_id = ? AND sent_at IS NOT NULL AND status IN ('sent', 'bounced', 'failed')${since ? ' AND sent_at >= ?' : ''}`,
    campaignId,
    ...(since ? [since] : []),
  );
  return { handled: Number(row?.handled ?? 0), bounces: Number(row?.bounces ?? 0), blocks: Number(row?.blocks ?? 0), complaints: Number(row?.complaints ?? 0) };
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

/** Pauses every sending campaign that crossed a red line. Returns the campaigns paused. */
export function guardCampaigns(db: DatabaseSync): Array<{ id: string; name: string; reason: PauseReason }> {
  const paused: Array<{ id: string; name: string; reason: PauseReason }> = [];
  const campaigns = all<{ id: string; name: string; guard_since: string | null }>(
    db,
    "SELECT id, name, guard_since FROM campaigns WHERE status = 'sending' AND paused_reason IS NULL",
  );
  for (const c of campaigns) {
    const line = crossedLine(guardStats(db, c.id, c.guard_since));
    if (!line) continue;
    const reason: PauseReason = { ...line, at: now() };
    run(db, 'UPDATE campaigns SET paused_reason = ?, updated_at = ? WHERE id = ? AND paused_reason IS NULL', JSON.stringify(reason), now(), c.id);
    paused.push({ id: c.id, name: c.name, reason });
  }
  return paused;
}

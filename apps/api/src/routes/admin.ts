import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { all, get, scalar, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { platformAdminEmails } from '../services/platformAdmin.js';
import type { Deps } from '../deps.js';
import { notFound, parse } from '../lib/http.js';
import { t } from '../i18n.js';

/**
 * « Administration » : read-only, cross-account dashboard for whoever runs the Pingsell platform
 * (not a merchant's account admin). Access is granted by the PLATFORM_ADMIN_EMAILS env var only
 * (comma-separated user emails); API keys never qualify. For anyone else every /admin route except
 * /admin/access answers the regular 404, so the feature stays invisible.
 *
 * Never returned: passwords, sessions, API key values, access tokens, contacts' personal data
 * (failed recipients are masked: « b•••@gmail.com »).
 */

const DAY_MS = 86_400_000;
const INTEGRATIONS = ['shopify', 'wordpress', 'prestashop', 'api', 'tracking', 'push'] as const;
type Integration = (typeof INTEGRATIONS)[number];

const daysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const timeseriesSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) });
const accountsSchema = z.object({
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['created_at', 'last_seen', 'contacts', 'emails_30d', 'bounce_rate']).default('created_at'),
  order: z.enum(['desc', 'asc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const activitySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const idSchema = z.object({ id: z.string().min(1).max(100) });

const adminEmails = platformAdminEmails;

export function isPlatformAdmin(db: DatabaseSync, request: FastifyRequest): boolean {
  // A session belongs to a user; an API key acts as the whole account and is never an admin.
  if (!request.userId || request.apiKeyId) return false;
  const allowed = adminEmails();
  if (!allowed.length) return false;
  const email = get<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', request.userId)?.email;
  return !!email && allowed.includes(email.trim().toLowerCase());
}

/** « bob@gmail.com » → « b•••@gmail.com ». */
export function maskEmail(email: string | null | undefined): string {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${value[0]}•••${value.slice(at)}`;
}

/** Bounce diagnostics often quote the recipient: mask every address found in the text. */
const maskEmailsIn = (text: string) =>
  text.replace(/([A-Za-z0-9._%+=-])[A-Za-z0-9._%+=-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, '$1•••@$2');

const iso = (ms: number) => new Date(ms).toISOString();
const startOfUtcDay = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const num = (v: unknown) => Number(v ?? 0) || 0;
const ratio = (n: number, d: number) => (d > 0 ? Math.min(1, Math.max(0, n / d)) : null);

/* ───────────── Accounts ───────────── */

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  language: string;
  users: number;
  contacts: number;
  contacts_subscribed: number;
  emails_total: number;
  emails_30d: number;
  bounce_rate_30d: number | null;
  complaints_30d: number;
  campaigns: number;
  automations_active: number;
  sites: number;
  pageviews_30d: number;
  integrations: Integration[];
  sending_domain: { domain: string; verified: boolean } | null;
  health: 'ok' | 'warning' | 'risk';
}

/**
 * Per-account figures, aggregated once per table (GROUP BY account_id) and joined to accounts,
 * so a page, a sort or a filter over every account stays a single query. `sent_at` counts use the
 * (account_id, sent_at) index alone; bounces are « hard » bounces (status = 'bounced');
 * complaints are contacts marked « complained » during the window (no per-message record exists).
 */
function accountQuery(since: string, filter: string, order: string) {
  const sql = `
    WITH
      u AS (SELECT account_id, COUNT(*) AS n, MAX(last_seen_at) AS seen FROM users GROUP BY account_id),
      c AS (SELECT account_id, COUNT(*) AS n, SUM(status = 'subscribed') AS sub FROM contacts GROUP BY account_id),
      cc AS (SELECT account_id, COUNT(*) AS n FROM contacts WHERE status = 'complained' AND updated_at >= ? GROUP BY account_id),
      m AS (SELECT account_id, COUNT(*) AS total, SUM(sent_at >= ?) AS recent FROM messages WHERE sent_at IS NOT NULL GROUP BY account_id),
      b AS (SELECT account_id, COUNT(*) AS n FROM messages WHERE status = 'bounced' AND sent_at >= ? GROUP BY account_id),
      cp AS (SELECT account_id, COUNT(*) AS n FROM campaigns GROUP BY account_id),
      au AS (SELECT account_id, COUNT(*) AS n FROM automations WHERE status = 'active' GROUP BY account_id),
      s AS (SELECT account_id, COUNT(*) AS n FROM web_sites GROUP BY account_id),
      pv AS (SELECT account_id, COUNT(*) AS n FROM web_pageviews WHERE created_at >= ? GROUP BY account_id)
    SELECT * FROM (
      SELECT a.id, a.name, a.email, a.created_at, u.seen AS last_seen_at, a.language,
             COALESCE(u.n, 0) AS users, COALESCE(c.n, 0) AS contacts, COALESCE(c.sub, 0) AS contacts_subscribed,
             COALESCE(m.total, 0) AS emails_total, COALESCE(m.recent, 0) AS emails_30d,
             CASE WHEN COALESCE(m.recent, 0) > 0 THEN COALESCE(b.n, 0) * 1.0 / m.recent END AS bounce_rate_30d,
             COALESCE(cc.n, 0) AS complaints_30d, COALESCE(cp.n, 0) AS campaigns, COALESCE(au.n, 0) AS automations_active,
             COALESCE(s.n, 0) AS sites, COALESCE(pv.n, 0) AS pageviews_30d,
             sd.domain AS sd_domain, sd.status AS sd_status
        FROM accounts a
        LEFT JOIN u ON u.account_id = a.id
        LEFT JOIN c ON c.account_id = a.id
        LEFT JOIN cc ON cc.account_id = a.id
        LEFT JOIN m ON m.account_id = a.id
        LEFT JOIN b ON b.account_id = a.id
        LEFT JOIN cp ON cp.account_id = a.id
        LEFT JOIN au ON au.account_id = a.id
        LEFT JOIN s ON s.account_id = a.id
        LEFT JOIN pv ON pv.account_id = a.id
        LEFT JOIN sending_domains sd ON sd.account_id = a.id
    ) r
    WHERE ${filter}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  return { sql, params: [since, since, since, since] as SQLInputValue[] };
}

/** Same search on the list and its total: account name, account email or any member's email. */
const SEARCH_SQL = `(instr(ulower(r.name), ?) > 0 OR instr(ulower(r.email), ?) > 0
  OR EXISTS (SELECT 1 FROM users x WHERE x.account_id = r.id AND instr(ulower(x.email), ?) > 0))`;
const RISK_SQL = `(r.bounce_rate_30d > 0.05 OR (r.emails_30d > 0 AND r.complaints_30d * 1.0 / r.emails_30d > 0.003))`;

/** UNION of (account_id, integration) pairs actually in use; `scope` restricts to some accounts. */
function integrationPairsSql(scope: string) {
  return `
    SELECT account_id, 'shopify' AS k FROM integrations WHERE provider = 'shopify' ${scope}
    UNION
    SELECT account_id, CASE WHEN label LIKE 'WordPress · %' THEN 'wordpress'
                            WHEN label LIKE 'PrestaShop · %' THEN 'prestashop' ELSE 'api' END AS k
      FROM api_keys WHERE (label LIKE 'WordPress · %' OR label LIKE 'PrestaShop · %' OR last_used_at IS NOT NULL) ${scope}
    UNION
    SELECT account_id, 'tracking' AS k FROM web_sites WHERE 1 ${scope}
    UNION
    SELECT account_id, 'push' AS k FROM push_devices WHERE active = 1 ${scope}`;
}

function health(row: { bounce_rate_30d: number | null; complaints_30d: number; emails_30d: number; active: boolean }): AccountRow['health'] {
  const bounce = row.bounce_rate_30d ?? 0;
  const complaints = row.emails_30d > 0 ? row.complaints_30d / row.emails_30d : 0;
  if (bounce > 0.05 || complaints > 0.003) return 'risk';
  if (bounce > 0.02 || !row.active) return 'warning';
  return 'ok';
}

function loadAccounts(db: DatabaseSync, filter: string, filterParams: SQLInputValue[], order: string, limit: number, offset: number): AccountRow[] {
  const since = iso(Date.now() - 30 * DAY_MS);
  const q = accountQuery(since, filter, order);
  const rows = all<Row>(db, q.sql, ...q.params, ...filterParams, limit, offset);
  if (!rows.length) return [];

  const ids = JSON.stringify(rows.map((r) => r.id));
  const used = new Map<string, Set<string>>();
  const scope = 'AND account_id IN (SELECT value FROM json_each(?))';
  for (const p of all<{ account_id: string; k: string }>(db, integrationPairsSql(scope), ids, ids, ids, ids)) {
    if (!used.has(p.account_id)) used.set(p.account_id, new Set());
    used.get(p.account_id)!.add(p.k);
  }

  return rows.map((r) => {
    const id = String(r.id);
    const emails30 = num(r.emails_30d);
    const pageviews30 = num(r.pageviews_30d);
    const lastSeen = (r.last_seen_at as string | null) ?? null;
    const createdAt = String(r.created_at);
    const bounceRate = r.bounce_rate_30d == null ? null : Number(r.bounce_rate_30d);
    const complaints30 = num(r.complaints_30d);
    // « Active »: a member seen, an email sent or a page viewed in the last 30 days (or a new account).
    const active = emails30 > 0 || pageviews30 > 0 || (lastSeen != null && lastSeen >= since) || createdAt >= since;
    const inUse = used.get(id);
    return {
      id,
      name: String(r.name),
      email: String(r.email),
      created_at: createdAt,
      last_seen_at: lastSeen,
      language: String(r.language ?? 'fr'),
      users: num(r.users),
      contacts: num(r.contacts),
      contacts_subscribed: num(r.contacts_subscribed),
      emails_total: num(r.emails_total),
      emails_30d: emails30,
      bounce_rate_30d: bounceRate,
      complaints_30d: complaints30,
      campaigns: num(r.campaigns),
      automations_active: num(r.automations_active),
      sites: num(r.sites),
      pageviews_30d: pageviews30,
      integrations: INTEGRATIONS.filter((k) => inUse?.has(k)),
      sending_domain: r.sd_domain ? { domain: String(r.sd_domain), verified: r.sd_status === 'verified' } : null,
      health: health({ bounce_rate_30d: bounceRate, complaints_30d: complaints30, emails_30d: emails30, active }),
    };
  });
}

/* ───────────── Time series ───────────── */

const SERIES = ['accounts', 'contacts', 'emails_sent', 'opens', 'clicks', 'bounces', 'pageviews', 'site_actions', 'push_sent'] as const;
type SeriesKey = (typeof SERIES)[number];

/** One zero-filled entry per UTC day, oldest first, `days` entries ending today. */
function timeseries(db: DatabaseSync, days: number, accountId: string | null) {
  const first = startOfUtcDay(Date.now()) - (days - 1) * DAY_MS;
  const since = iso(first);
  const out = new Map<string, Record<SeriesKey, number>>();
  for (let i = 0; i < days; i++) {
    out.set(iso(first + i * DAY_MS).slice(0, 10), Object.fromEntries(SERIES.map((k) => [k, 0])) as Record<SeriesKey, number>);
  }
  const extra = accountId ? [accountId] : [];
  const add = (key: SeriesKey, table: string, col: string, where = '', idCol = 'account_id') => {
    const scope = accountId ? `AND ${idCol} = ?` : '';
    const rows = all<{ d: string; n: number }>(
      db,
      `SELECT substr(${col}, 1, 10) AS d, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? ${where} ${scope} GROUP BY d`,
      since,
      ...extra,
    );
    for (const r of rows) {
      const day = out.get(r.d);
      if (day) day[key] += num(r.n);
    }
  };
  add('accounts', 'accounts', 'created_at', '', 'id');
  add('contacts', 'contacts', 'created_at');
  add('emails_sent', 'messages', 'sent_at');
  add('opens', 'events', 'created_at', "AND type = 'open'");
  add('clicks', 'events', 'created_at', "AND type = 'click'");
  add('bounces', 'messages', 'sent_at', "AND status = 'bounced'");
  add('pageviews', 'web_pageviews', 'created_at');
  add('site_actions', 'web_actions', 'created_at');
  add('push_sent', 'push_messages', 'sent_at', "AND status = 'sent'");
  return [...out].map(([date, values]) => ({ date, ...values }));
}

/* ───────────── Overview ───────────── */

/** Counts for one window [start, end). Every subquery is index-friendly (status/created_at, account_id/sent_at). */
function periodCounts(db: DatabaseSync, start: string, end: string) {
  const w = [start, end];
  const row = get<Row>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM accounts WHERE created_at >= ? AND created_at < ?) AS new_accounts,
       (SELECT COUNT(*) FROM (
          SELECT account_id FROM users WHERE last_seen_at >= ? AND last_seen_at < ?
          UNION SELECT account_id FROM messages WHERE sent_at >= ? AND sent_at < ?
          UNION SELECT account_id FROM web_pageviews WHERE created_at >= ? AND created_at < ?)) AS active_accounts,
       (SELECT COUNT(*) FROM contacts WHERE created_at >= ? AND created_at < ?) AS contacts_added,
       (SELECT COUNT(*) FROM messages WHERE sent_at >= ? AND sent_at < ?) AS emails_sent,
       (SELECT COUNT(*) FROM messages WHERE status = 'failed' AND created_at >= ? AND created_at < ?) AS emails_failed,
       (SELECT COUNT(*) FROM messages WHERE status = 'bounced' AND sent_at >= ? AND sent_at < ?) AS bounces,
       (SELECT COUNT(*) FROM contacts WHERE status = 'complained' AND updated_at >= ? AND updated_at < ?) AS complaints,
       (SELECT COUNT(*) FROM events WHERE type = 'open' AND created_at >= ? AND created_at < ?) AS opens,
       (SELECT COUNT(*) FROM events WHERE type = 'click' AND created_at >= ? AND created_at < ?) AS clicks,
       (SELECT COUNT(*) FROM events WHERE type = 'unsubscribe' AND created_at >= ? AND created_at < ?) AS unsubscribes,
       (SELECT COUNT(*) FROM push_messages WHERE status = 'sent' AND sent_at >= ? AND sent_at < ?) AS push_sent,
       (SELECT COUNT(*) FROM web_pageviews WHERE created_at >= ? AND created_at < ?) AS pageviews,
       (SELECT COUNT(*) FROM web_actions WHERE created_at >= ? AND created_at < ?) AS site_actions,
       (SELECT COUNT(*) FROM automation_runs WHERE created_at >= ? AND created_at < ?) AS automation_runs,
       (SELECT COUNT(*) FROM campaigns WHERE status = 'sent' AND sent_at >= ? AND sent_at < ?) AS campaigns_sent`,
    ...Array.from({ length: 17 }, () => w).flat(),
  )!;
  const keys = [
    'new_accounts', 'active_accounts', 'contacts_added', 'emails_sent', 'emails_failed', 'bounces', 'complaints',
    'opens', 'clicks', 'unsubscribes', 'push_sent', 'pageviews', 'site_actions', 'automation_runs', 'campaigns_sent',
  ] as const;
  return Object.fromEntries(keys.map((k) => [k, num(row[k])])) as Record<(typeof keys)[number], number>;
}

function overview(db: DatabaseSync, days: number, deps: Deps) {
  const nowMs = Date.now();
  const end = iso(nowMs + 1000);
  const start = iso(nowMs - days * DAY_MS);
  const prevStart = iso(nowMs - 2 * days * DAY_MS);

  const tot = get<Row>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM contacts) AS contacts,
       (SELECT COUNT(*) FROM contacts WHERE status = 'subscribed') AS contacts_subscribed,
       (SELECT COUNT(*) FROM campaigns) AS campaigns,
       (SELECT COUNT(*) FROM campaigns WHERE status = 'sent') AS campaigns_sent,
       (SELECT COUNT(*) FROM automations) AS automations,
       (SELECT COUNT(*) FROM automations WHERE status = 'active') AS automations_active,
       (SELECT COUNT(*) FROM api_keys) AS api_keys,
       (SELECT COUNT(*) FROM web_sites) AS sites,
       (SELECT COUNT(*) FROM sending_domains) AS sending_domains,
       (SELECT COUNT(*) FROM sending_domains WHERE status = 'verified') AS sending_domains_verified,
       (SELECT COUNT(*) FROM push_devices WHERE active = 1) AS push_devices,
       (SELECT COUNT(*) FROM email_templates) AS email_templates,
       (SELECT COUNT(*) FROM messages WHERE sent_at IS NOT NULL) AS emails_sent`,
  )!;
  const totalKeys = [
    'accounts', 'users', 'contacts', 'contacts_subscribed', 'campaigns', 'campaigns_sent', 'automations', 'automations_active',
    'api_keys', 'sites', 'sending_domains', 'sending_domains_verified', 'push_devices', 'email_templates', 'emails_sent',
  ] as const;

  const period = periodCounts(db, start, end);
  const previous = periodCounts(db, prevStart, start);
  const delivered = Math.max(0, period.emails_sent - period.bounces);

  const integrations = Object.fromEntries(INTEGRATIONS.map((k) => [k, 0])) as Record<Integration, number>;
  for (const r of all<{ k: Integration; n: number }>(db, `SELECT k, COUNT(DISTINCT account_id) AS n FROM (${integrationPairsSql('')}) GROUP BY k`)) {
    if (r.k in integrations) integrations[r.k] = num(r.n);
  }

  const queued = get<{ n: number; oldest: string | null }>(db, "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM messages WHERE status = 'queued'");
  const pageCount = scalar(db, 'PRAGMA page_count');
  const pageSize = scalar(db, 'PRAGMA page_size');

  return {
    generated_at: iso(nowMs),
    days,
    totals: Object.fromEntries(totalKeys.map((k) => [k, num(tot[k])])),
    period,
    previous,
    rates: {
      // Delivered (sent minus hard bounces) over everything attempted (sent + failed).
      delivery: ratio(delivered, period.emails_sent + period.emails_failed),
      bounce: ratio(period.bounces, period.emails_sent),
      complaint: ratio(period.complaints, period.emails_sent),
      open: ratio(period.opens, delivered),
      click: ratio(period.clicks, delivered),
      unsubscribe: ratio(period.unsubscribes, delivered),
    },
    integrations,
    queue: {
      queued: num(queued?.n),
      queued_oldest_at: queued?.oldest ?? null,
      runs_pending: scalar(db, "SELECT COUNT(*) FROM automation_runs WHERE status = 'pending'"),
      runs_overdue: scalar(db, "SELECT COUNT(*) FROM automation_runs WHERE status = 'pending' AND next_run_at < ?", iso(nowMs - 10 * 60_000)),
      failed_24h: scalar(db, "SELECT COUNT(*) FROM messages WHERE status = 'failed' AND created_at >= ?", iso(nowMs - DAY_MS)),
    },
    system: {
      db_size_bytes: pageCount * pageSize,
      uptime_s: Math.round(process.uptime()),
      node: process.version,
      commit: process.env.SOURCE_COMMIT ?? process.env.GIT_SHA ?? null,
      email_provider: deps.config.emailProvider,
      warmup_start: deps.config.warmup?.startDate ?? null,
    },
  };
}

/* ───────────── Activity ───────────── */

type ActivityType =
  | 'account_created' | 'user_joined' | 'campaign_sent' | 'automation_created'
  | 'integration_connected' | 'domain_verified' | 'site_detected';

const quote = (s: unknown) => t(`« ${String(s)} »`, `“${String(s)}”`);

function activity(db: DatabaseSync, limit: number) {
  const items: Array<{ at: string; type: ActivityType; account_id: string; account_name: string; detail: string }> = [];
  const pull = (type: ActivityType, sql: string, detail: (r: Row) => string) => {
    for (const r of all<Row>(db, sql, limit)) {
      items.push({ at: String(r.at), type, account_id: String(r.account_id), account_name: String(r.account_name ?? ''), detail: detail(r) });
    }
  };
  const join = 'JOIN accounts a ON a.id = x.account_id';
  pull('account_created', 'SELECT a.created_at AS at, a.id AS account_id, a.name AS account_name, a.email FROM accounts a ORDER BY a.created_at DESC LIMIT ?',
    (r) => t(`Nouveau compte · ${r.email}`, `New account · ${r.email}`));
  pull('user_joined', `SELECT x.created_at AS at, x.account_id, a.name AS account_name, x.name, x.role FROM users x ${join} WHERE x.role != 'owner' ORDER BY x.created_at DESC LIMIT ?`,
    (r) => t(`${r.name} a rejoint l’équipe (${r.role})`, `${r.name} joined the team (${r.role})`));
  pull('campaign_sent', `SELECT x.sent_at AS at, x.account_id, a.name AS account_name, x.name FROM campaigns x ${join} WHERE x.status = 'sent' AND x.sent_at IS NOT NULL ORDER BY x.sent_at DESC LIMIT ?`,
    (r) => t(`Campagne ${quote(r.name)} envoyée`, `Campaign ${quote(r.name)} sent`));
  pull('automation_created', `SELECT x.created_at AS at, x.account_id, a.name AS account_name, x.name, x.trigger FROM automations x ${join} ORDER BY x.created_at DESC LIMIT ?`,
    (r) => t(`Automatisation ${quote(r.name)} (${r.trigger})`, `Automation ${quote(r.name)} (${r.trigger})`));
  pull('integration_connected', `SELECT x.created_at AS at, x.account_id, a.name AS account_name, x.provider, x.shop_domain FROM integrations x ${join} ORDER BY x.created_at DESC LIMIT ?`,
    (r) => (r.shop_domain ? `${r.provider} · ${r.shop_domain}` : String(r.provider)));
  pull('integration_connected', `SELECT x.created_at AS at, x.account_id, a.name AS account_name, x.label FROM api_keys x ${join}
      WHERE x.label LIKE 'WordPress · %' OR x.label LIKE 'PrestaShop · %' ORDER BY x.created_at DESC LIMIT ?`,
    (r) => String(r.label));
  pull('domain_verified', `SELECT x.verified_at AS at, x.account_id, a.name AS account_name, x.domain FROM sending_domains x ${join} WHERE x.verified_at IS NOT NULL ORDER BY x.verified_at DESC LIMIT ?`,
    (r) => String(r.domain));
  pull('site_detected', `SELECT x.first_seen AS at, x.account_id, a.name AS account_name, x.host FROM web_sites x ${join} ORDER BY x.first_seen DESC LIMIT ?`,
    (r) => String(r.host));
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { data: items.slice(0, limit) };
}

/* ───────────── Deliverability ───────────── */

function deliverability(db: DatabaseSync, days: number) {
  const since = iso(Date.now() - days * DAY_MS);
  const by_domain = all<{ domain: string; sent: number; bounced: number; opened: number }>(
    db,
    `SELECT lower(substr(to_email, instr(to_email, '@') + 1)) AS domain, COUNT(*) AS sent,
            SUM(status = 'bounced') AS bounced, SUM(opened_at IS NOT NULL) AS opened
       FROM messages WHERE status IN ('sent','bounced') AND created_at >= ? AND instr(to_email, '@') > 0
      GROUP BY domain ORDER BY sent DESC, domain LIMIT 12`,
    since,
  ).map((r) => ({ domain: r.domain, sent: num(r.sent), bounced: num(r.bounced), opened: num(r.opened) }));

  // Group, then mask the addresses quoted in diagnostics and merge what became identical.
  const merged = new Map<string, { error: string; count: number; last_at: string }>();
  for (const r of all<{ error: string; n: number; last_at: string }>(
    db,
    `SELECT substr(error, 1, 300) AS error, COUNT(*) AS n, MAX(COALESCE(sent_at, created_at)) AS last_at
       FROM messages WHERE status IN ('failed','bounced') AND created_at >= ? AND error IS NOT NULL AND error != ''
      GROUP BY 1 ORDER BY n DESC LIMIT 200`,
    since,
  )) {
    const error = maskEmailsIn(r.error);
    const prev = merged.get(error);
    if (prev) {
      prev.count += num(r.n);
      if (r.last_at > prev.last_at) prev.last_at = r.last_at;
    } else merged.set(error, { error, count: num(r.n), last_at: r.last_at });
  }
  const errors = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  const risky_accounts = loadAccounts(db, RISK_SQL, [], 'r.bounce_rate_30d DESC NULLS LAST, r.emails_30d DESC, r.id', 20, 0);
  return { by_domain, errors, risky_accounts };
}

/* ───────────── Routes ───────────── */

export async function adminRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  /** Non-admins get the regular « route not found »: the feature does not exist for them. */
  async function guard(request: FastifyRequest, reply: FastifyReply) {
    if (!isPlatformAdmin(db, request)) {
      reply.callNotFound();
      return reply;
    }
  }

  app.get('/admin/access', async (request) => ({ admin: isPlatformAdmin(db, request) }));

  app.get('/admin/overview', { preHandler: guard }, async (request) => {
    const { days } = parse(daysSchema, request.query);
    return overview(db, days, deps);
  });

  app.get('/admin/timeseries', { preHandler: guard }, async (request) => {
    const { days } = parse(timeseriesSchema, request.query);
    return { days: timeseries(db, days, null) };
  });

  app.get('/admin/accounts', { preHandler: guard }, async (request) => {
    const q = parse(accountsSchema, request.query);
    const search = q.search ? q.search.toLowerCase() : '';
    const filter = search ? SEARCH_SQL : '1';
    const params = search ? [search, search, search] : [];
    const column = {
      created_at: 'r.created_at',
      last_seen: 'r.last_seen_at',
      contacts: 'r.contacts',
      emails_30d: 'r.emails_30d',
      bounce_rate: 'r.bounce_rate_30d',
    }[q.sort];
    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const data = loadAccounts(db, filter, params, `${column} ${dir} NULLS LAST, r.created_at DESC, r.id`, q.limit, q.offset);
    const total = scalar(db, `SELECT COUNT(*) FROM accounts r WHERE ${filter}`, ...params);
    return { data, total, limit: q.limit, offset: q.offset };
  });

  app.get('/admin/accounts/:id', { preHandler: guard }, async (request) => {
    const { id } = parse(idSchema, request.params);
    const account = loadAccounts(db, 'r.id = ?', [id], 'r.id', 1, 0)[0];
    if (!account) throw notFound(t('Compte introuvable', 'Account not found'));

    const users = all<Row>(db, 'SELECT email, name, role, created_at, last_seen_at FROM users WHERE account_id = ? ORDER BY created_at', id).map((u) => ({
      email: String(u.email),
      name: String(u.name),
      role: String(u.role),
      created_at: String(u.created_at),
      last_seen_at: (u.last_seen_at as string | null) ?? null,
    }));
    const campaigns = all<Row>(
      db,
      `SELECT c.id, c.name, c.status, c.sent_at, (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id) AS recipients
         FROM campaigns c WHERE c.account_id = ? ORDER BY COALESCE(c.sent_at, c.created_at) DESC LIMIT 10`,
      id,
    ).map((c) => ({ id: String(c.id), name: String(c.name), status: String(c.status), sent_at: (c.sent_at as string | null) ?? null, recipients: num(c.recipients) }));
    const automations = all<Row>(
      db,
      `SELECT x.id, x.name, x.trigger, x.status, (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = x.id) AS runs
         FROM automations x WHERE x.account_id = ? ORDER BY x.created_at DESC LIMIT 50`,
      id,
    ).map((x) => ({ id: String(x.id), name: String(x.name), trigger: String(x.trigger), status: String(x.status), runs: num(x.runs) }));
    const sites = all<Row>(db, 'SELECT host, pageviews, last_seen FROM web_sites WHERE account_id = ? ORDER BY pageviews DESC, host LIMIT 50', id).map((s) => ({
      host: String(s.host),
      pageviews: num(s.pageviews),
      last_seen: String(s.last_seen),
    }));
    const failures = all<Row>(
      db,
      `SELECT COALESCE(sent_at, created_at) AS at, to_email, error FROM messages
        WHERE account_id = ? AND status IN ('failed','bounced') ORDER BY created_at DESC LIMIT 10`,
      id,
    ).map((f) => ({ at: String(f.at), to: maskEmail(f.to_email as string), error: maskEmailsIn(String(f.error ?? '')) }));

    return { account, users, campaigns, automations, sites, failures, timeseries: timeseries(db, 30, id) };
  });

  app.get('/admin/activity', { preHandler: guard }, async (request) => {
    const { limit } = parse(activitySchema, request.query);
    return activity(db, limit);
  });

  app.get('/admin/deliverability', { preHandler: guard }, async (request) => {
    const { days } = parse(daysSchema, request.query);
    return deliverability(db, days);
  });
}

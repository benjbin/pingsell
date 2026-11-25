import { all, scalar, type DatabaseSync, type SQLInputValue } from '../db.js';

/**
 * Analytics for the « Statistiques » page: one period (in the merchant's time zone),
 * compared with the period of the same length just before it.
 *
 * Revenue attribution (last touch): an order is credited to the most recent email open or click,
 * or push open, by the same customer in the ATTRIBUTION_DAYS before the order.
 */
export const ATTRIBUTION_DAYS = 5;
const DAY_MS = 86_400_000;

export interface AnalyticsQuery {
  /** Local dates, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Minutes to add to local time to get UTC (JS `getTimezoneOffset()`, e.g. -60 in Paris in winter). */
  tz: number;
}

type Source = { kind: 'campaign' | 'automation' | 'push_campaign'; id: string };

interface Window {
  start: string; // UTC ISO
  end: string; // UTC ISO, exclusive
  days: string[]; // local dates
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const money = (n: number) => Math.round(n * 100) / 100;

function localDayStart(date: string, tz: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + tz * 60_000;
}

function window(from: string, to: string, tz: number): Window {
  const startMs = localDayStart(from, tz);
  const endMs = localDayStart(to, tz) + DAY_MS;
  const days: string[] = [];
  for (let t = startMs; t < endMs; t += DAY_MS) days.push(new Date(t - tz * 60_000).toISOString().slice(0, 10));
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), days };
}

/** SQLite modifier turning a UTC timestamp into local time. */
const shift = (tz: number) => `${-tz >= 0 ? '+' : ''}${-tz} minutes`;

interface Order {
  contact_id: string | null;
  at: string;
  total: number;
}

interface Touch {
  contact_id: string;
  at: string;
  source: Source;
}

function orders(db: DatabaseSync, accountId: string, w: Window): Order[] {
  return all<{ contact_id: string | null; created_at: string; total: number | null }>(
    db,
    `SELECT contact_id, created_at,
            CAST(COALESCE(json_extract(data, '$.total'), json_extract(data, '$.total_price'), 0) AS REAL) AS total
       FROM events WHERE account_id = ? AND type = 'order' AND created_at >= ? AND created_at < ?`,
    accountId,
    w.start,
    w.end,
  ).map((o) => ({ contact_id: o.contact_id, at: o.created_at, total: Number(o.total ?? 0) }));
}

/**
 * Opens/clicks (email) and opens (push) that can be credited for these orders. Only the touches of
 * customers who ordered in the window are read: memory follows the number of buyers, not the millions
 * of opens of a big campaign (email touches come from covering partial indexes, never from the rows).
 */
function touches(db: DatabaseSync, accountId: string, w: Window): Map<string, Touch[]> {
  const since = new Date(Date.parse(w.start) - ATTRIBUTION_DAYS * DAY_MS).toISOString();
  const rows: Touch[] = [];
  const push = (contact_id: string | null, at: string | null, source: Source | null) => {
    if (contact_id && at && source) rows.push({ contact_id, at, source });
  };
  const buyers = `SELECT contact_id FROM events
     WHERE account_id = ? AND type = 'order' AND created_at >= ? AND created_at < ? AND contact_id IS NOT NULL`;
  for (const col of ['opened_at', 'clicked_at'] as const) {
    const it = db
      .prepare(
        `SELECT contact_id, ${col} AS at, campaign_id, automation_id FROM messages
          WHERE account_id = ? AND ${col} >= ? AND ${col} < ? AND contact_id IN (${buyers})`,
      )
      .iterate(accountId, since, w.end, accountId, w.start, w.end) as Iterable<{ contact_id: string | null; at: string; campaign_id: string | null; automation_id: string | null }>;
    for (const m of it) {
      push(m.contact_id, m.at, m.campaign_id ? { kind: 'campaign', id: m.campaign_id } : m.automation_id ? { kind: 'automation', id: m.automation_id } : null);
    }
  }
  const pushIt = db
    .prepare(
      `SELECT contact_id, opened_at AS at, push_campaign_id, automation_id FROM push_messages
        WHERE account_id = ? AND opened_at >= ? AND opened_at < ? AND contact_id IN (${buyers})`,
    )
    .iterate(accountId, since, w.end, accountId, w.start, w.end) as Iterable<{ contact_id: string | null; at: string; push_campaign_id: string | null; automation_id: string | null }>;
  for (const m of pushIt) {
    push(
      m.contact_id,
      m.at,
      m.push_campaign_id ? { kind: 'push_campaign', id: m.push_campaign_id } : m.automation_id ? { kind: 'automation', id: m.automation_id } : null,
    );
  }
  const byContact = new Map<string, Touch[]>();
  for (const t of rows) {
    const list = byContact.get(t.contact_id) ?? [];
    list.push(t);
    byContact.set(t.contact_id, list);
  }
  for (const list of byContact.values()) list.sort((a, b) => (a.at < b.at ? -1 : 1));
  return byContact;
}

/** Revenue credited to Pingsell messages between two UTC instants (same rule as the Statistiques page). */
export function attributedRevenue(db: DatabaseSync, accountId: string, start: string, end: string): { revenue: number; orders: number } {
  const credited = attribute(db, accountId, { start, end, days: [] }).filter((o) => o.source);
  return { revenue: money(credited.reduce((s, o) => s + o.total, 0)), orders: credited.length };
}

/** Each order with the touch it is credited to (or null). */
function attribute(db: DatabaseSync, accountId: string, w: Window): Array<Order & { source: Source | null }> {
  const list = orders(db, accountId, w);
  if (!list.length) return [];
  const byContact = touches(db, accountId, w);
  return list.map((o) => {
    const candidates = o.contact_id ? byContact.get(o.contact_id) : undefined;
    let source: Source | null = null;
    if (candidates) {
      const floor = new Date(Date.parse(o.at) - ATTRIBUTION_DAYS * DAY_MS).toISOString();
      for (let i = candidates.length - 1; i >= 0; i--) {
        const t = candidates[i];
        if (t.at > o.at) continue;
        if (t.at < floor) break;
        source = t.source;
        break;
      }
    }
    return { ...o, source };
  });
}

function totals(db: DatabaseSync, accountId: string, w: Window) {
  const email = all<{ sent: number; opened: number; clicked: number; bounced: number }>(
    db,
    `SELECT SUM(status IN ('sent','bounced')) AS sent,
            SUM(status = 'sent' AND opened_at IS NOT NULL) AS opened,
            SUM(status = 'sent' AND clicked_at IS NOT NULL) AS clicked,
            SUM(status = 'bounced') AS bounced
       FROM messages WHERE account_id = ? AND sent_at >= ? AND sent_at < ?`,
    accountId,
    w.start,
    w.end,
  )[0];
  const push = all<{ sent: number; opened: number }>(
    db,
    `SELECT COUNT(*) AS sent, SUM(opened_at IS NOT NULL) AS opened
       FROM push_messages WHERE account_id = ? AND status = 'sent' AND sent_at >= ? AND sent_at < ?`,
    accountId,
    w.start,
    w.end,
  )[0];
  const count = (type: string) =>
    scalar(db, 'SELECT COUNT(*) FROM events WHERE account_id = ? AND type = ? AND created_at >= ? AND created_at < ?', accountId, type, w.start, w.end);
  const sent = Number(email?.sent ?? 0);
  const delivered = sent - Number(email?.bounced ?? 0);
  const attributed = attribute(db, accountId, w);
  const revenue = attributed.reduce((s, o) => s + o.total, 0);
  const revenueAttributed = attributed.filter((o) => o.source).reduce((s, o) => s + o.total, 0);
  const newContacts = scalar(db, 'SELECT COUNT(*) FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?', accountId, w.start, w.end);
  const unsubscribes = count('unsubscribe');
  return {
    attributed,
    kpis: {
      revenue_attributed: money(revenueAttributed),
      orders_attributed: attributed.filter((o) => o.source).length,
      revenue_total: money(revenue),
      orders_total: attributed.length,
      emails_sent: sent,
      emails_delivered: delivered,
      emails_opened: Number(email?.opened ?? 0),
      emails_clicked: Number(email?.clicked ?? 0),
      open_rate: pct(Number(email?.opened ?? 0), delivered),
      click_rate: pct(Number(email?.clicked ?? 0), delivered),
      click_to_open_rate: pct(Number(email?.clicked ?? 0), Number(email?.opened ?? 0)),
      bounce_rate: pct(Number(email?.bounced ?? 0), sent),
      unsubscribes,
      unsubscribe_rate: pct(unsubscribes, delivered),
      push_sent: Number(push?.sent ?? 0),
      push_opened: Number(push?.opened ?? 0),
      push_open_rate: pct(Number(push?.opened ?? 0), Number(push?.sent ?? 0)),
      new_contacts: newContacts,
      net_growth: newContacts - unsubscribes,
    },
  };
}

const METRICS = ['emails_sent', 'opens', 'clicks', 'push_sent', 'push_opens', 'orders', 'revenue', 'revenue_attributed', 'new_contacts', 'unsubscribes'] as const;
type Metric = (typeof METRICS)[number];

function daily(db: DatabaseSync, accountId: string, w: Window, tz: number, attributed: Array<Order & { source: Source | null }>) {
  const rows = new Map<string, Record<Metric, number>>();
  for (const d of w.days) rows.set(d, Object.fromEntries(METRICS.map((m) => [m, 0])) as Record<Metric, number>);
  // One COUNT per local day over the day's [start, end) range of a covering index: no per-row datetime()
  // and no GROUP BY temp b-tree (5x faster on a month of a 2 M-recipient campaign). Timestamps are ISO-8601
  // UTC strings, so the string ranges are the time ranges.
  const bounds = w.days.map((d) => {
    const s = localDayStart(d, tz);
    return [d, new Date(s).toISOString(), new Date(s + DAY_MS).toISOString()] as const;
  });
  const add = (metric: Metric, sql: string) => {
    const stmt = db.prepare(sql);
    for (const [d, start, end] of bounds) {
      const n = Number((stmt.get(accountId, start, end) as { n: number } | undefined)?.n ?? 0);
      if (n) rows.get(d)![metric] += n;
    }
  };
  add('emails_sent', `SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND sent_at >= ? AND sent_at < ? AND status IN ('sent','bounced')`);
  add('opens', `SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND opened_at >= ? AND opened_at < ?`);
  add('clicks', `SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND clicked_at >= ? AND clicked_at < ?`);
  add('push_sent', `SELECT COUNT(*) AS n FROM push_messages WHERE account_id = ? AND sent_at >= ? AND sent_at < ? AND status = 'sent'`);
  add('push_opens', `SELECT COUNT(*) AS n FROM push_messages WHERE account_id = ? AND opened_at >= ? AND opened_at < ?`);
  add('new_contacts', `SELECT COUNT(*) AS n FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?`);
  add('unsubscribes', `SELECT COUNT(*) AS n FROM events WHERE account_id = ? AND created_at >= ? AND created_at < ? AND type = 'unsubscribe'`);
  for (const o of attributed) {
    const d = new Date(Date.parse(o.at) - tz * 60_000).toISOString().slice(0, 10);
    const row = rows.get(d);
    if (!row) continue;
    row.orders += 1;
    row.revenue = money(row.revenue + o.total);
    if (o.source) row.revenue_attributed = money(row.revenue_attributed + o.total);
  }
  return w.days.map((date) => ({ date, ...rows.get(date)! }));
}

/** Email opens by local weekday (0 = lundi) × hour: when to send. */
function heatmap(db: DatabaseSync, accountId: string, w: Window, tz: number) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const mod = shift(tz);
  for (const r of all<{ wd: number; h: number; n: number }>(
    db,
    `SELECT CAST(strftime('%w', opened_at, ?) AS INTEGER) AS wd, CAST(strftime('%H', opened_at, ?) AS INTEGER) AS h, COUNT(*) AS n
       FROM messages WHERE account_id = ? AND opened_at >= ? AND opened_at < ? GROUP BY wd, h`,
    mod,
    mod,
    accountId,
    w.start,
    w.end,
  )) {
    grid[(Number(r.wd) + 6) % 7][Number(r.h)] += Number(r.n);
  }
  return grid;
}

function revenueBySource(attributed: Array<Order & { source: Source | null }>) {
  const map = new Map<string, { revenue: number; orders: number }>();
  for (const o of attributed) {
    if (!o.source) continue;
    const key = `${o.source.kind}:${o.source.id}`;
    const v = map.get(key) ?? { revenue: 0, orders: 0 };
    v.revenue += o.total;
    v.orders += 1;
    map.set(key, v);
  }
  return map;
}

function campaignsTable(db: DatabaseSync, accountId: string, w: Window, credit: Map<string, { revenue: number; orders: number }>) {
  const rows = all<{ id: string; name: string; subject: string; sent_at: string; sent: number; opened: number; clicked: number; bounced: number }>(
    db,
    `SELECT c.id, c.name, c.subject, c.sent_at,
            SUM(m.status IN ('sent','bounced')) AS sent,
            SUM(m.status = 'sent' AND m.opened_at IS NOT NULL) AS opened,
            SUM(m.status = 'sent' AND m.clicked_at IS NOT NULL) AS clicked,
            SUM(m.status = 'bounced') AS bounced
       FROM campaigns c JOIN messages m ON m.campaign_id = c.id
      WHERE c.account_id = ? AND c.deleted_at IS NULL AND c.sent_at >= ? AND c.sent_at < ?
      GROUP BY c.id ORDER BY c.sent_at DESC`,
    accountId,
    w.start,
    w.end,
  );
  // Unsubscribes of every campaign in one pass over the account's unsubscribe events (not one pass per campaign).
  const unsubscribed = new Map<string, number>();
  if (rows.length) {
    for (const u of all<{ cid: string; n: number }>(
      db,
      `SELECT json_extract(data, '$.campaign_id') AS cid, COUNT(*) AS n FROM events
        WHERE account_id = ? AND type = 'unsubscribe' GROUP BY cid`,
      accountId,
    )) {
      if (u.cid != null) unsubscribed.set(String(u.cid), Number(u.n));
    }
  }
  return rows.map((c) => {
    const unsubscribedCount = unsubscribed.get(c.id) ?? 0;
    const delivered = Number(c.sent) - Number(c.bounced);
    const r = credit.get(`campaign:${c.id}`);
    return {
      id: c.id,
      name: c.name,
      subject: c.subject,
      sent_at: c.sent_at,
      sent: Number(c.sent),
      open_rate: pct(Number(c.opened), delivered),
      click_rate: pct(Number(c.clicked), delivered),
      unsubscribe_rate: pct(unsubscribedCount, delivered),
      revenue: money(r?.revenue ?? 0),
      orders: r?.orders ?? 0,
    };
  });
}

function automationsTable(db: DatabaseSync, accountId: string, w: Window, credit: Map<string, { revenue: number; orders: number }>) {
  const base = all<{ id: string; name: string; trigger: string; status: string }>(
    db,
    'SELECT id, name, trigger, status FROM automations WHERE account_id = ? ORDER BY created_at',
    accountId,
  );
  return base
    .map((a) => {
      const email = all<{ sent: number; opened: number; clicked: number }>(
        db,
        `SELECT SUM(status IN ('sent','bounced')) AS sent, SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked
           FROM messages WHERE automation_id = ? AND sent_at >= ? AND sent_at < ?`,
        a.id,
        w.start,
        w.end,
      )[0];
      const push = all<{ sent: number; opened: number }>(
        db,
        `SELECT COUNT(*) AS sent, SUM(opened_at IS NOT NULL) AS opened FROM push_messages
          WHERE automation_id = ? AND status = 'sent' AND sent_at >= ? AND sent_at < ?`,
        a.id,
        w.start,
        w.end,
      )[0];
      const entered = scalar(db, 'SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND created_at >= ? AND created_at < ?', a.id, w.start, w.end);
      const r = credit.get(`automation:${a.id}`);
      return {
        id: a.id,
        name: a.name,
        trigger: a.trigger,
        status: a.status,
        entered,
        emails_sent: Number(email?.sent ?? 0),
        open_rate: pct(Number(email?.opened ?? 0), Number(email?.sent ?? 0)),
        click_rate: pct(Number(email?.clicked ?? 0), Number(email?.sent ?? 0)),
        push_sent: Number(push?.sent ?? 0),
        push_open_rate: pct(Number(push?.opened ?? 0), Number(push?.sent ?? 0)),
        revenue: money(r?.revenue ?? 0),
        orders: r?.orders ?? 0,
      };
    })
    .filter((a) => a.entered || a.emails_sent || a.push_sent || a.orders);
}

function pushTable(db: DatabaseSync, accountId: string, w: Window, credit: Map<string, { revenue: number; orders: number }>) {
  return all<{ id: string; name: string; title: string; sent_at: string | null; sent: number; opened: number }>(
    db,
    `SELECT p.id, p.name, p.title, MIN(m.sent_at) AS sent_at, COUNT(*) AS sent, SUM(m.opened_at IS NOT NULL) AS opened
       FROM push_campaigns p JOIN push_messages m ON m.push_campaign_id = p.id AND m.status = 'sent' AND m.resend = 0
      WHERE p.account_id = ? AND m.sent_at >= ? AND m.sent_at < ?
      GROUP BY p.id ORDER BY sent_at DESC`,
    accountId,
    w.start,
    w.end,
  ).map((p) => {
    const r = credit.get(`push_campaign:${p.id}`);
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      sent_at: p.sent_at,
      sent: Number(p.sent),
      open_rate: pct(Number(p.opened), Number(p.sent)),
      revenue: money(r?.revenue ?? 0),
      orders: r?.orders ?? 0,
    };
  });
}

function topLinks(db: DatabaseSync, accountId: string, w: Window) {
  return all<{ url: string; clicks: number; contacts: number }>(
    db,
    `SELECT json_extract(data, '$.url') AS url, COUNT(*) AS clicks, COUNT(DISTINCT contact_id) AS contacts
       FROM events WHERE account_id = ? AND type = 'click' AND created_at >= ? AND created_at < ? AND json_extract(data, '$.url') IS NOT NULL
      GROUP BY url ORDER BY clicks DESC LIMIT 10`,
    accountId,
    w.start,
    w.end,
  ).map((l) => ({ url: l.url, clicks: Number(l.clicks), contacts: Number(l.contacts) }));
}

function sources(db: DatabaseSync, accountId: string, w: Window) {
  return all<{ source: string; n: number }>(
    db,
    'SELECT source, COUNT(*) AS n FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ? GROUP BY source ORDER BY n DESC',
    accountId,
    w.start,
    w.end,
  ).map((s) => ({ source: s.source, contacts: Number(s.n) }));
}

export function analytics(db: DatabaseSync, accountId: string, q: AnalyticsQuery) {
  const cur = window(q.from, q.to, q.tz);
  const length = cur.days.length;
  const prevTo = new Date(Date.parse(`${q.from}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(`${q.from}T00:00:00Z`) - length * DAY_MS).toISOString().slice(0, 10);
  const prev = window(prevFrom, prevTo, q.tz);

  const now = totals(db, accountId, cur);
  const before = totals(db, accountId, prev);
  const credit = revenueBySource(now.attributed);
  const byKind = { campaign: 0, automation: 0, push_campaign: 0 };
  for (const o of now.attributed) if (o.source) byKind[o.source.kind] += o.total;

  return {
    range: { from: q.from, to: q.to, days: length, previous: { from: prevFrom, to: prevTo } },
    attribution_days: ATTRIBUTION_DAYS,
    kpis: now.kpis,
    previous: before.kpis,
    daily: daily(db, accountId, cur, q.tz, now.attributed),
    daily_previous: daily(db, accountId, prev, q.tz, before.attributed),
    revenue_split: {
      campaigns: money(byKind.campaign),
      automations: money(byKind.automation),
      push: money(byKind.push_campaign),
      unattributed: money(now.kpis.revenue_total - now.kpis.revenue_attributed),
    },
    heatmap: heatmap(db, accountId, cur, q.tz),
    campaigns: campaignsTable(db, accountId, cur, credit),
    automations: automationsTable(db, accountId, cur, credit),
    push_campaigns: pushTable(db, accountId, cur, credit),
    top_links: topLinks(db, accountId, cur),
    sources: sources(db, accountId, cur),
  };
}

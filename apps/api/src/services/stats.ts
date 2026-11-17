import { all, scalar, type DatabaseSync } from '../db.js';
import { rate } from './campaigns.js';
import { attributedRevenue } from './analytics.js';

export interface OverviewStats {
  contacts_total: number;
  contacts_subscribed: number;
  contacts_new: number;
  campaigns_sent: number;
  emails_sent: number;
  open_rate: number;
  click_rate: number;
  unsubscribe_rate: number;
  revenue_shopify: number;
  /** Part of the revenue credited to emails and notifications (see services/analytics.ts). */
  revenue_attributed: number;
  orders_attributed: number;
  timeseries: { date: string; sent: number; opened: number; clicked: number }[];
}

const DAY_MS = 86_400_000;

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function overviewStats(db: DatabaseSync, accountId: string, days: number): OverviewStats {
  // Window = the last `days` calendar days (UTC), today included.
  const firstDay = startOfUtcDay(Date.now()) - (days - 1) * DAY_MS;
  const since = new Date(firstDay).toISOString();

  const contacts_total = scalar(db, 'SELECT COUNT(*) FROM contacts WHERE account_id = ?', accountId);
  const contacts_subscribed = scalar(
    db,
    "SELECT COUNT(*) FROM contacts WHERE account_id = ? AND status = 'subscribed'",
    accountId,
  );
  const contacts_new = scalar(db, 'SELECT COUNT(*) FROM contacts WHERE account_id = ? AND created_at >= ?', accountId, since);
  const campaigns_sent = scalar(
    db,
    "SELECT COUNT(*) FROM campaigns WHERE account_id = ? AND status = 'sent' AND sent_at >= ?",
    accountId,
    since,
  );

  const sentRow = all<{ sent: number; opened: number; clicked: number }>(
    db,
    `SELECT COUNT(*) AS sent,
            SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
       FROM messages WHERE account_id = ? AND status = 'sent' AND sent_at >= ?`,
    accountId,
    since,
  )[0];
  const emails_sent = Number(sentRow?.sent ?? 0);
  const unsubscribes = scalar(
    db,
    "SELECT COUNT(*) FROM events WHERE account_id = ? AND type = 'unsubscribe' AND created_at >= ?",
    accountId,
    since,
  );
  const revenue = all<{ total: number | null }>(
    db,
    `SELECT SUM(CAST(COALESCE(json_extract(data, '$.total'), json_extract(data, '$.total_price'), 0) AS REAL)) AS total
       FROM events WHERE account_id = ? AND type = 'order' AND created_at >= ?`,
    accountId,
    since,
  )[0];

  const credited = attributedRevenue(db, accountId, since, new Date(Date.now() + 1000).toISOString());

  const series = new Map<string, { sent: number; opened: number; clicked: number }>();
  for (let t = firstDay, i = 0; i < days; i++, t += DAY_MS) {
    series.set(new Date(t).toISOString().slice(0, 10), { sent: 0, opened: 0, clicked: 0 });
  }
  const bump = (column: 'sent_at' | 'opened_at' | 'clicked_at', key: 'sent' | 'opened' | 'clicked') => {
    const rows = all<{ d: string; n: number }>(
      db,
      `SELECT substr(${column}, 1, 10) AS d, COUNT(*) AS n FROM messages
        WHERE account_id = ? AND ${column} IS NOT NULL AND ${column} >= ? GROUP BY d`,
      accountId,
      since,
    );
    for (const r of rows) {
      const bucket = series.get(r.d);
      if (bucket) bucket[key] += Number(r.n);
    }
  };
  bump('sent_at', 'sent');
  bump('opened_at', 'opened');
  bump('clicked_at', 'clicked');

  return {
    contacts_total,
    contacts_subscribed,
    contacts_new,
    campaigns_sent,
    emails_sent,
    open_rate: rate(Number(sentRow?.opened ?? 0), emails_sent),
    click_rate: rate(Number(sentRow?.clicked ?? 0), emails_sent),
    unsubscribe_rate: rate(unsubscribes, emails_sent),
    revenue_shopify: Math.round(Number(revenue?.total ?? 0) * 100) / 100,
    revenue_attributed: credited.revenue,
    orders_attributed: credited.orders,
    timeseries: [...series.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

export function monthlyUsage(db: DatabaseSync, accountId: string) {
  const d = new Date();
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  return {
    emails_sent_month: scalar(
      db,
      "SELECT COUNT(*) FROM messages WHERE account_id = ? AND status = 'sent' AND sent_at >= ?",
      accountId,
      monthStart,
    ),
    contacts: scalar(db, 'SELECT COUNT(*) FROM contacts WHERE account_id = ?', accountId),
  };
}

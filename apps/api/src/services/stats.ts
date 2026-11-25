import { all, scalar, type DatabaseSync } from '../db.js';
import { memo, offload } from '../lib/offload.js';
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
  // One COUNT per UTC day over a covering index range (no substr() per row, no GROUP BY temp b-tree).
  const bump = (column: 'sent_at' | 'opened_at' | 'clicked_at', key: 'sent' | 'opened' | 'clicked') => {
    const stmt = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND ${column} >= ? AND ${column} < ?`);
    let t = firstDay;
    for (const bucket of series.values()) {
      bucket[key] += Number((stmt.get(accountId, new Date(t).toISOString(), new Date(t + DAY_MS).toISOString()) as { n: number }).n);
      t += DAY_MS;
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

/**
 * What is connected to the account (« Sources » of the automation editor). Counts over contacts and
 * messages read covering indexes only; callers serve it from a short cache, computed off the main thread.
 */
export function automationSources(db: DatabaseSync, accountId: string) {
  const n = (sql: string) => Number(scalar(db, sql, accountId) ?? 0);
  const plugins = all<{ label: string }>(
    db,
    "SELECT label FROM api_keys WHERE account_id = ? AND (label LIKE 'WordPress · %' OR label LIKE 'PrestaShop · %') ORDER BY created_at",
    accountId,
  ).map((k) => k.label);
  return {
    shopify: n("SELECT COUNT(*) FROM integrations WHERE account_id = ? AND provider = 'shopify' AND status = 'connected' AND access_token IS NOT NULL") > 0,
    plugins,
    api_keys_used: n('SELECT COUNT(*) FROM api_keys WHERE account_id = ? AND last_used_at IS NOT NULL'),
    orders: n("SELECT COUNT(*) FROM events WHERE account_id = ? AND type = 'order'"),
    fulfilled: n("SELECT COUNT(*) FROM events WHERE account_id = ? AND type = 'order_fulfilled'"),
    carts: n('SELECT COUNT(*) FROM api_carts WHERE account_id = ?') + n("SELECT COUNT(*) FROM events WHERE account_id = ? AND type = 'cart_abandoned'"),
    products_seen: n('SELECT COUNT(*) FROM web_pageviews WHERE account_id = ? AND product IS NOT NULL'),
    app_users: n('SELECT COUNT(*) FROM app_users WHERE account_id = ?'),
    push_devices: n('SELECT COUNT(*) FROM push_devices WHERE account_id = ?'),
    contacts: n('SELECT COUNT(*) FROM contacts WHERE account_id = ?'),
    segments: n('SELECT COUNT(*) FROM segments WHERE account_id = ?'),
    emails_sent: n("SELECT COUNT(*) FROM messages WHERE account_id = ? AND status = 'sent'"),
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

/* Cached, off-the-main-thread versions used by the routes: counts over millions of rows never block the API. */

/** Shown on every page (/me): one minute fresh, then served while it is refreshed in the background. */
export const cachedMonthlyUsage = (db: DatabaseSync, accountId: string) =>
  memo(`usage:${accountId}`, 60_000, 6 * 3600_000, () => offload(db, 'monthlyUsage', accountId));

export const cachedAutomationSources = (db: DatabaseSync, accountId: string) =>
  memo(`sources:${accountId}`, 60_000, 3600_000, () => offload(db, 'automationSources', accountId));

export const cachedOverviewStats = (db: DatabaseSync, accountId: string, days: number) =>
  memo(`overview:${accountId}:${days}`, 60_000, 15 * 60_000, () => offload(db, 'overviewStats', accountId, days));

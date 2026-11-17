// Revenue helpers based on `order` events (webhooks, sync and simulations).
import type { DatabaseSync } from 'node:sqlite';

export interface ShopifyRevenue {
  revenue: number;
  orders: number;
}

/**
 * Sum of Shopify order totals for an account over the last `days` days (all time when omitted).
 * Core can use it for `revenue_shopify` in GET /stats/overview.
 */
export function getShopifyRevenue(db: DatabaseSync, accountId: string, days?: number): ShopifyRevenue {
  const since = days && days > 0 ? new Date(Date.now() - days * 24 * 3600_000).toISOString() : '';
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(data, '$.total') AS REAL)), 0) AS revenue, COUNT(*) AS orders
       FROM events WHERE account_id = ? AND type = 'order' AND created_at >= ?`,
    )
    .get(accountId, since) as { revenue: number; orders: number } | undefined;
  return { revenue: Math.round(Number(row?.revenue ?? 0) * 100) / 100, orders: Number(row?.orders ?? 0) };
}

/** Revenue attributed to a campaign: orders placed by its recipients within `windowDays` after receiving it. */
export function getCampaignAttributedRevenue(db: DatabaseSync, accountId: string, campaignId: string, windowDays = 5): ShopifyRevenue {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(json_extract(e.data, '$.total') AS REAL)), 0) AS revenue, COUNT(DISTINCT e.id) AS orders
       FROM events e
       JOIN messages m ON m.contact_id = e.contact_id AND m.campaign_id = ? AND m.account_id = e.account_id
       WHERE e.account_id = ? AND e.type = 'order' AND m.sent_at IS NOT NULL
         AND e.created_at >= m.sent_at
         AND julianday(e.created_at) - julianday(m.sent_at) <= ?`,
    )
    .get(campaignId, accountId, windowDays) as { revenue: number; orders: number } | undefined;
  return { revenue: Math.round(Number(row?.revenue ?? 0) * 100) / 100, orders: Number(row?.orders ?? 0) };
}

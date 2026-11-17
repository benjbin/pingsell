// Pending checkouts → `cart_abandoned` after 1 h without an order.
import { randomUUID } from 'node:crypto';
import type { IntegrationContext } from '../context.js';
import { cleanEmail, customerFromRest, marketingStateFromRest, toNumber, upsertShopifyContact } from './contacts.js';
import { getIntegration } from './store.js';
import { ABANDON_AFTER_MS } from './types.js';

interface CheckoutRow {
  id: string;
  account_id: string;
  shop_domain: string;
  checkout_id: string;
  checkout_token: string | null;
  email: string | null;
  total: number;
  currency: string | null;
  abandoned_url: string | null;
  line_items: string;
  customer: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface StoredCustomer {
  first_name?: string | null;
  last_name?: string | null;
  external_id?: string | null;
  marketing_state?: string | null;
}

export interface LineItemSummary {
  title: string;
  quantity: number;
  price: number;
}

export function summarizeLineItems(value: unknown): LineItemSummary[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((li: Record<string, unknown>) => ({
    title: String(li.title ?? li.name ?? 'Article'),
    quantity: Number(li.quantity ?? 1) || 1,
    price: toNumber(li.price),
  }));
}

/** Stores / refreshes a checkout from a `checkouts/create|update` payload. */
export function handleCheckoutPayload(ctx: IntegrationContext, accountId: string, shop: string, payload: Record<string, unknown>): void {
  const checkoutId = payload.id != null ? String(payload.id) : payload.token ? String(payload.token) : null;
  if (!checkoutId) return;
  const token = typeof payload.token === 'string' ? payload.token : null;

  if (payload.completed_at) {
    markCheckoutsCompleted(ctx, accountId, { checkoutId, token });
    return;
  }

  const customerRaw = (payload.customer as Record<string, unknown> | null | undefined) ?? null;
  const email = cleanEmail(payload.email) ?? cleanEmail(customerRaw?.email);
  const fromCustomer = customerRaw ? customerFromRest(customerRaw, email) : null;
  const customer: StoredCustomer = {
    first_name: fromCustomer?.first_name ?? null,
    last_name: fromCustomer?.last_name ?? null,
    external_id: fromCustomer?.external_id ?? null,
    marketing_state:
      marketingStateFromRest(customerRaw) ?? (payload.buyer_accepts_marketing === true ? 'subscribed' : null),
  };
  const now = new Date().toISOString();

  ctx.db
    .prepare(
      `INSERT INTO shopify_checkouts
         (id, account_id, shop_domain, checkout_id, checkout_token, email, total, currency, abandoned_url, line_items, customer, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(account_id, checkout_id) DO UPDATE SET
         checkout_token = COALESCE(excluded.checkout_token, checkout_token),
         email = COALESCE(excluded.email, email),
         total = excluded.total,
         currency = excluded.currency,
         abandoned_url = COALESCE(excluded.abandoned_url, abandoned_url),
         line_items = excluded.line_items,
         customer = excluded.customer,
         updated_at = excluded.updated_at
       WHERE shopify_checkouts.status = 'pending'`,
    )
    .run(
      randomUUID(),
      accountId,
      shop,
      checkoutId,
      token,
      email,
      toNumber(payload.total_price),
      typeof payload.currency === 'string' ? payload.currency : null,
      typeof payload.abandoned_checkout_url === 'string' ? payload.abandoned_checkout_url : null,
      JSON.stringify(summarizeLineItems(payload.line_items)),
      JSON.stringify(customer),
      now,
      now,
    );
}

/** Marks pending checkouts as converted (by checkout id / token, and/or by email). */
export function markCheckoutsCompleted(
  ctx: IntegrationContext,
  accountId: string,
  match: { checkoutId?: string | null; token?: string | null; email?: string | null },
): void {
  const now = new Date().toISOString();
  ctx.db
    .prepare(
      `UPDATE shopify_checkouts SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE account_id = ? AND status = 'pending'
         AND (checkout_id = ? OR checkout_token = ? OR (email IS NOT NULL AND email = ?))`,
    )
    .run(now, now, accountId, match.checkoutId ?? '\u0000', match.token ?? '\u0000', match.email ?? '\u0000');
}

/** Records an abandoned cart for a contact and fires the `cart_abandoned` trigger. */
export function fireCartAbandoned(
  ctx: IntegrationContext,
  accountId: string,
  contactId: string,
  data: Record<string, unknown>,
): void {
  ctx.recordEvent(accountId, contactId, 'cart_abandoned', data);
  ctx.fireTrigger(accountId, contactId, 'cart_abandoned', data);
}

/**
 * Fires `cart_abandoned` for pending checkouts idle for more than 1 h without an order.
 * Returns the number of carts processed.
 */
export function processAbandonedCheckouts(ctx: IntegrationContext, log?: { error: (obj: unknown, msg?: string) => void }): number {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  const rows = ctx.db
    .prepare(
      `SELECT * FROM shopify_checkouts WHERE status = 'pending' AND email IS NOT NULL AND updated_at <= ? ORDER BY updated_at LIMIT 200`,
    )
    .all(cutoff) as unknown as CheckoutRow[];

  let processed = 0;
  for (const row of rows) {
    try {
      const integration = getIntegration(ctx.db, row.account_id);
      if (!integration || integration.status !== 'connected') {
        ctx.db.prepare("UPDATE shopify_checkouts SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
        continue;
      }
      // An order placed after the checkout started (even without token match) means it converted.
      const ordered = ctx.db
        .prepare(
          `SELECT 1 AS x FROM events e JOIN contacts c ON c.id = e.contact_id
           WHERE e.account_id = ? AND e.type = 'order' AND lower(c.email) = ? AND e.created_at >= ? LIMIT 1`,
        )
        .get(row.account_id, row.email, row.created_at);
      const now = new Date().toISOString();
      if (ordered) {
        ctx.db.prepare("UPDATE shopify_checkouts SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
        continue;
      }

      const customer = safeParse<StoredCustomer>(row.customer, {});
      const { contactId } = upsertShopifyContact(ctx, row.account_id, {
        email: row.email!,
        first_name: customer.first_name,
        last_name: customer.last_name,
        external_id: customer.external_id,
        marketing_state: customer.marketing_state,
      });
      // Claim the row first so a crash in a trigger never fires twice.
      const claimed = ctx.db
        .prepare("UPDATE shopify_checkouts SET status = 'abandoned', abandoned_at = ? WHERE id = ? AND status = 'pending'")
        .run(now, row.id);
      if (Number(claimed.changes) === 0) continue;
      fireCartAbandoned(ctx, row.account_id, contactId, {
        checkout_id: row.checkout_id,
        total: row.total,
        currency: row.currency,
        checkout_url: row.abandoned_url,
        line_items: safeParse<LineItemSummary[]>(row.line_items, []),
        source: 'shopify',
      });
      processed++;
    } catch (err) {
      log?.error({ err, checkout: row.id }, 'Shopify : échec du traitement d’un panier abandonné');
    }
  }

  // Housekeeping: checkouts that never got an email are useless after a week.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  ctx.db.prepare("DELETE FROM shopify_checkouts WHERE status = 'pending' AND email IS NULL AND updated_at < ?").run(weekAgo);
  return processed;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

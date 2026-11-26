// Pending checkouts → `cart_abandoned` after 1 h without an order.
import { randomUUID } from 'node:crypto';
import type { IntegrationContext } from '../context.js';
import { cleanEmail, customerFromRest, marketingStateFromRest, toNumber, upsertShopifyContact } from './contacts.js';
import { getIntegration } from './store.js';
import { transaction } from '../../db.js';
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
  language?: string | null;
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
    language: typeof payload.customer_locale === 'string' ? payload.customer_locale : (fromCustomer?.language ?? null),
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
  // One indexed statement per key: an OR across three columns may make the planner walk every pending checkout.
  const keys: Array<['checkout_id' | 'checkout_token' | 'email', string | null | undefined]> = [
    ['checkout_id', match.checkoutId],
    ['checkout_token', match.token],
    ['email', match.email],
  ];
  for (const [column, value] of keys) {
    if (!value) continue;
    ctx.db
      .prepare(
        `UPDATE shopify_checkouts SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE account_id = ? AND ${column} = ? AND status = 'pending'`,
      )
      .run(now, now, accountId, value);
  }
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

/** Longest stretch of work per call: the API shares the thread. */
const CHECKOUT_BUDGET_MS = 50;
const CHECKOUT_PAGE = 200;

/**
 * Fires `cart_abandoned` for pending checkouts idle for more than 1 h without an order, within `budgetMs`.
 * `more` is true when due checkouts are left for the next call (the caller yields to the API, then calls again).
 */
export function processAbandonedCheckoutsSlice(
  ctx: IntegrationContext,
  log?: { error: (obj: unknown, msg?: string) => void },
  budgetMs = CHECKOUT_BUDGET_MS,
): { processed: number; more: boolean } {
  const deadline = Date.now() + budgetMs;
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  const rows = ctx.db
    .prepare(
      `SELECT * FROM shopify_checkouts INDEXED BY idx_shopify_checkouts_due
       WHERE status = 'pending' AND email IS NOT NULL AND updated_at <= ? ORDER BY updated_at LIMIT ?`,
    )
    .all(cutoff, CHECKOUT_PAGE) as unknown as CheckoutRow[];

  const connected = new Map<string, boolean>();
  let processed = 0;
  let handled = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    handled++;
    try {
      if (handleDueCheckout(ctx, row, connected)) processed++;
    } catch (err) {
      // Never retried in a loop: the row leaves the queue, the error is logged.
      log?.error({ err, checkout: row.id }, 'Shopify : échec du traitement d’un panier abandonné');
      try {
        ctx.db
          .prepare("UPDATE shopify_checkouts SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'")
          .run(new Date().toISOString(), row.id);
      } catch {
        /* next call */
      }
    }
  }

  // Housekeeping: checkouts that never got an email are useless after a week (small batches).
  if (Date.now() < deadline) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    ctx.db
      .prepare(
        `DELETE FROM shopify_checkouts WHERE rowid IN (
           SELECT rowid FROM shopify_checkouts INDEXED BY idx_shopify_checkouts_pending
           WHERE status = 'pending' AND updated_at < ? AND email IS NULL LIMIT 500)`,
      )
      .run(weekAgo);
  }
  return { processed, more: handled < rows.length || rows.length === CHECKOUT_PAGE };
}

/** One due checkout, in one transaction: converted, or claimed then `cart_abandoned`. Returns true when fired. */
function handleDueCheckout(ctx: IntegrationContext, row: CheckoutRow, connected: Map<string, boolean>): boolean {
  return transaction(ctx.db, () => {
    const now = new Date().toISOString();
    let isConnected = connected.get(row.account_id);
    if (isConnected === undefined) {
      isConnected = getIntegration(ctx.db, row.account_id)?.status === 'connected';
      connected.set(row.account_id, isConnected);
    }
    if (!isConnected) {
      ctx.db.prepare("UPDATE shopify_checkouts SET status = 'completed', updated_at = ? WHERE id = ?").run(now, row.id);
      return false;
    }
    // An order placed after the checkout started (even without token match) means it converted.
    // Contact by (account_id, email) — unique index — then its own orders since (idx_events_contact).
    const existing = ctx.db.prepare('SELECT id FROM contacts WHERE account_id = ? AND email = ?').get(row.account_id, row.email) as
      | { id: string }
      | undefined;
    const ordered =
      existing &&
      ctx.db
        .prepare("SELECT 1 AS x FROM events INDEXED BY idx_events_contact WHERE contact_id = ? AND created_at >= ? AND type = 'order' LIMIT 1")
        .get(existing.id, row.created_at);
    if (ordered) {
      ctx.db.prepare("UPDATE shopify_checkouts SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
      return false;
    }

    const customer = safeParse<StoredCustomer>(row.customer, {});
    const { contactId } = upsertShopifyContact(ctx, row.account_id, {
      email: row.email!,
      first_name: customer.first_name,
      last_name: customer.last_name,
      external_id: customer.external_id,
      language: customer.language,
      marketing_state: customer.marketing_state,
    });
    // Claim the row first: with the trigger in the same transaction, a checkout never fires twice.
    const claimed = ctx.db
      .prepare("UPDATE shopify_checkouts SET status = 'abandoned', abandoned_at = ? WHERE id = ? AND status = 'pending'")
      .run(now, row.id);
    if (Number(claimed.changes) === 0) return false;
    fireCartAbandoned(ctx, row.account_id, contactId, {
      checkout_id: row.checkout_id,
      total: row.total,
      currency: row.currency,
      checkout_url: row.abandoned_url,
      line_items: safeParse<LineItemSummary[]>(row.line_items, []),
      source: 'shopify',
    });
    return true;
  });
}

/** One bounded pass (~50 ms). Returns the number of carts processed. */
export function processAbandonedCheckouts(ctx: IntegrationContext, log?: { error: (obj: unknown, msg?: string) => void }): number {
  return processAbandonedCheckoutsSlice(ctx, log).processed;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

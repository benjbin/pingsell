// Initial + manual synchronisation of Shopify customers and orders (GraphQL, cursor pagination).
// Built for very large stores (millions of customers): runs in the background, one short transaction per page,
// cursor and counts saved after every page (resumes after a restart), transient errors retried with back-off.
import type { IntegrationContext } from '../context.js';
import { ShopifyError, type ShopifyClient } from './client.js';
import { cleanEmail, parseTags, toNumber, upsertShopifyContact } from './contacts.js';
import {
  claimOrder,
  findContactByEmail,
  getIntegration,
  getSyncState,
  insertHistoricalOrderEvent,
  orderAlreadyRecorded,
  saveSyncState,
  updateIntegration,
  type SyncState,
} from './store.js';
import type { SyncResult } from './types.js';
import { transaction } from '../../db.js';
import { t } from '../../i18n.js';

const PAGE_SIZE = 100; // keeps the query cost well under the 1000-point limit
const ORDER_HISTORY_DAYS = 365; // Shopify only returns 60 days without read_all_orders anyway
/** Waits before retrying a page after a network error, a Shopify 5xx or a 429 (then the sync stops, resumable). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000];

/** "gid://shopify/Customer/123" → "123" (same ids as REST webhooks). */
export function legacyId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const last = gid.split('/').pop() ?? '';
  return last.split('?')[0] || null;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface CustomerNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  numberOfOrders: string | number;
  amountSpent: { amount: string } | null;
  lastOrder: { createdAt: string } | null;
  defaultEmailAddress: { emailAddress: string | null; marketingState: string | null } | null;
  defaultPhoneNumber: { phoneNumber: string | null } | null;
}

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  email: string | null;
  customerAcceptsMarketing: boolean;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { id: string; firstName: string | null; lastName: string | null } | null;
}

const CUSTOMERS_QUERY = /* GraphQL */ `
  query PingsellCustomers($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        firstName
        lastName
        tags
        numberOfOrders
        amountSpent { amount }
        lastOrder { createdAt }
        defaultEmailAddress { emailAddress marketingState }
        defaultPhoneNumber { phoneNumber }
      }
    }
  }
`;

const ORDERS_QUERY = /* GraphQL */ `
  query PingsellOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        email
        customerAcceptsMarketing
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id firstName lastName }
      }
    }
  }
`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const yieldToApi = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Network failures (wrapped as 502), Shopify 5xx and rate limits are worth retrying; auth / query errors are not. */
function isTransient(err: unknown): boolean {
  return err instanceof ShopifyError && (err.status >= 500 || err.status === 429);
}

/** One page of a top-level connection, retried with back-off on transient errors. */
async function fetchPage<T>(
  client: ShopifyClient,
  query: string,
  root: string,
  after: string | null,
  variables: Record<string, unknown> = {},
): Promise<{ nodes: T[]; next: string | null }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const data: Record<string, { pageInfo: PageInfo; nodes: T[] } | undefined> = await client.graphql(query, {
        ...variables,
        first: PAGE_SIZE,
        after,
      });
      const conn = data[root];
      if (!conn) return { nodes: [], next: null };
      return { nodes: conn.nodes, next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null };
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isTransient(err) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
}

/** Upserts one page of customers (caller's transaction). Returns how many were imported. */
export function importCustomers(ctx: IntegrationContext, accountId: string, nodes: CustomerNode[]): number {
  let count = 0;
  for (const c of nodes) {
    const email = cleanEmail(c.defaultEmailAddress?.emailAddress);
    if (!email) continue; // customers without email cannot be emailed
    upsertShopifyContact(ctx, accountId, {
      email,
      first_name: c.firstName,
      last_name: c.lastName,
      phone: c.defaultPhoneNumber?.phoneNumber ?? null,
      tags: parseTags(c.tags),
      external_id: legacyId(c.id),
      total_spent: toNumber(c.amountSpent?.amount),
      orders_count: Number(c.numberOfOrders) || 0,
      last_order_at: c.lastOrder?.createdAt ?? null,
      marketing_state: c.defaultEmailAddress?.marketingState?.toLowerCase() ?? null,
    });
    count++;
  }
  return count;
}

/**
 * Imports one page of historical orders as `order` events (with their original date, deduplicated by order id),
 * so revenue statistics include past sales. No automation is triggered for historical orders.
 */
export function importOrders(ctx: IntegrationContext, accountId: string, nodes: OrderNode[]): number {
  let count = 0;
  for (const o of nodes) {
    const orderId = legacyId(o.id);
    const email = cleanEmail(o.email);
    if (!orderId || !email) continue;
    count++;
    let contactId = findContactByEmail(ctx.db, accountId, email)?.id;
    if (orderAlreadyRecorded(ctx.db, accountId, orderId, contactId) || !claimOrder(ctx.db, accountId, orderId)) continue;
    if (!contactId) {
      // Guest checkout: the customer sync did not create this contact.
      contactId = upsertShopifyContact(ctx, accountId, {
        email,
        first_name: o.customer?.firstName,
        last_name: o.customer?.lastName,
        external_id: legacyId(o.customer?.id),
        marketing_state: o.customerAcceptsMarketing ? 'subscribed' : null,
      }).contactId;
    }
    insertHistoricalOrderEvent(
      ctx.db,
      accountId,
      contactId,
      {
        order_id: orderId,
        order_name: o.name,
        total: toNumber(o.totalPriceSet.shopMoney.amount),
        currency: o.totalPriceSet.shopMoney.currencyCode,
        source: 'shopify_sync',
      },
      o.createdAt,
    );
  }
  return count;
}

const running = new Set<string>();

export function isSyncRunning(accountId: string): boolean {
  return running.has(accountId);
}

const historyStart = () => new Date(Date.now() - ORDER_HISTORY_DAYS * 24 * 3600_000).toISOString().slice(0, 10);

const freshState = (accountId: string): SyncState => {
  const now = new Date().toISOString();
  return {
    account_id: accountId,
    status: 'running',
    phase: 'customers',
    cursor: null,
    orders_since: null,
    customers: 0,
    orders: 0,
    started_at: now,
    updated_at: now,
    finished_at: null,
    error: null,
  };
};

/**
 * Full sync (customers then orders), page by page. Progress and result are stored in integrations.config.sync
 * (shown to the merchant) and in shopify_sync_state (cursor, to resume). A finished sync starts over; one that
 * was interrupted (restart) or stopped on an error resumes where it stopped, unless `restart` is set (new store).
 */
export async function runFullSync(
  ctx: IntegrationContext,
  accountId: string,
  client: ShopifyClient,
  options: { restart?: boolean } = {},
): Promise<SyncResult> {
  if (running.has(accountId)) throw new SyncInProgressError();
  running.add(accountId);
  try {
    const previous = getSyncState(ctx.db, accountId);
    const state: SyncState =
      !previous || options.restart || previous.status === 'done' || previous.phase === 'done'
        ? freshState(accountId)
        : { ...previous, status: 'running', error: null, finished_at: null };
    const progress = (extra: Record<string, unknown> = {}) => ({
      sync: {
        running: state.status === 'running',
        started_at: state.started_at,
        customers: state.customers,
        orders: state.orders,
        error: state.error,
        ...extra,
      },
    });
    try {
      saveSyncState(ctx.db, state);
      updateIntegration(ctx.db, accountId, progress());
      while (state.phase !== 'done') {
        // Disconnected (or another store connected) meanwhile: stop.
        const integration = getIntegration(ctx.db, accountId);
        if (!integration || integration.shop_domain !== client.shop) {
          throw new Error(t('Boutique Shopify déconnectée pendant la synchronisation', 'Shopify store disconnected during the sync'));
        }
        if (state.phase === 'customers') {
          const page = await fetchPage<CustomerNode>(client, CUSTOMERS_QUERY, 'customers', state.cursor);
          transaction(ctx.db, () => {
            state.customers += importCustomers(ctx, accountId, page.nodes);
            state.cursor = page.next;
            if (!page.next) {
              state.phase = 'orders';
              state.orders_since = historyStart();
            }
            saveSyncState(ctx.db, state);
            updateIntegration(ctx.db, accountId, progress());
          });
        } else {
          state.orders_since ??= historyStart();
          const page = await fetchPage<OrderNode>(client, ORDERS_QUERY, 'orders', state.cursor, {
            query: `created_at:>=${state.orders_since}`,
          });
          transaction(ctx.db, () => {
            state.orders += importOrders(ctx, accountId, page.nodes);
            state.cursor = page.next;
            if (!page.next) state.phase = 'done';
            saveSyncState(ctx.db, state);
            updateIntegration(ctx.db, accountId, progress());
          });
        }
        // Each page is its own short transaction (100 rows); let the API answer between two of them.
        await yieldToApi();
      }
      const finishedAt = new Date().toISOString();
      state.status = 'done';
      state.finished_at = finishedAt;
      saveSyncState(ctx.db, state);
      updateIntegration(ctx.db, accountId, { ...progress({ finished_at: finishedAt }), error: null }, { last_sync_at: finishedAt, status: 'connected' });
      return { customers: state.customers, orders: state.orders };
    } catch (err) {
      state.status = 'error';
      state.error = (err as Error).message;
      try {
        // Kept to resume later, unless the store was disconnected (its state was deleted with it).
        if (getIntegration(ctx.db, accountId)) saveSyncState(ctx.db, state);
        updateIntegration(ctx.db, accountId, progress({ finished_at: new Date().toISOString() }));
      } catch {
        /* the integration may be gone */
      }
      throw err;
    }
  } finally {
    running.delete(accountId);
  }
}

export class SyncInProgressError extends Error {
  constructor() {
    super(t('Une synchronisation Shopify est déjà en cours', 'A Shopify sync is already in progress'));
    this.name = 'SyncInProgressError';
  }
}

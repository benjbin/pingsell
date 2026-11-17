// Initial + manual synchronisation of Shopify customers and orders (GraphQL, cursor pagination).
import type { IntegrationContext } from '../context.js';
import type { ShopifyClient } from './client.js';
import { cleanEmail, parseTags, toNumber, upsertShopifyContact } from './contacts.js';
import { findContactByEmail, insertHistoricalOrderEvent, orderAlreadyRecorded, updateIntegration } from './store.js';
import type { SyncResult } from './types.js';

const PAGE_SIZE = 100; // keeps the query cost well under the 1000-point limit
const ORDER_HISTORY_DAYS = 365; // Shopify only returns 60 days without read_all_orders anyway

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

/** Generic cursor pagination over a top-level connection. */
async function* paginate<T>(
  client: ShopifyClient,
  query: string,
  root: string,
  variables: Record<string, unknown> = {},
): AsyncGenerator<T[]> {
  let after: string | null = null;
  do {
    const data: Record<string, { pageInfo: PageInfo; nodes: T[] }> = await client.graphql(query, {
      ...variables,
      first: PAGE_SIZE,
      after,
    });
    const conn = data[root];
    if (!conn) return;
    yield conn.nodes;
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
}

export async function syncCustomers(ctx: IntegrationContext, accountId: string, client: ShopifyClient): Promise<number> {
  let count = 0;
  for await (const nodes of paginate<CustomerNode>(client, CUSTOMERS_QUERY, 'customers')) {
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
  }
  return count;
}

/**
 * Imports historical orders as `order` events (with their original date, deduplicated by order id),
 * so revenue statistics include past sales. No automation is triggered for historical orders.
 */
export async function syncOrders(ctx: IntegrationContext, accountId: string, client: ShopifyClient): Promise<number> {
  const since = new Date(Date.now() - ORDER_HISTORY_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
  let count = 0;
  for await (const nodes of paginate<OrderNode>(client, ORDERS_QUERY, 'orders', { query: `created_at:>=${since}` })) {
    for (const o of nodes) {
      const orderId = legacyId(o.id);
      const email = cleanEmail(o.email);
      if (!orderId || !email) continue;
      count++;
      if (orderAlreadyRecorded(ctx.db, accountId, orderId)) continue;

      let contactId = findContactByEmail(ctx.db, accountId, email)?.id;
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
  }
  return count;
}

const running = new Set<string>();

export function isSyncRunning(accountId: string): boolean {
  return running.has(accountId);
}

/** Full sync (customers then orders). Progress and result are stored in integrations.config.sync. */
export async function runFullSync(ctx: IntegrationContext, accountId: string, client: ShopifyClient): Promise<SyncResult> {
  if (running.has(accountId)) throw new SyncInProgressError();
  running.add(accountId);
  const startedAt = new Date().toISOString();
  updateIntegration(ctx.db, accountId, { sync: { running: true, started_at: startedAt, error: null } });
  try {
    const customers = await syncCustomers(ctx, accountId, client);
    const orders = await syncOrders(ctx, accountId, client);
    const finishedAt = new Date().toISOString();
    updateIntegration(
      ctx.db,
      accountId,
      { sync: { running: false, started_at: startedAt, finished_at: finishedAt, customers, orders, error: null }, error: null },
      { last_sync_at: finishedAt, status: 'connected' },
    );
    return { customers, orders };
  } catch (err) {
    updateIntegration(ctx.db, accountId, {
      sync: { running: false, started_at: startedAt, finished_at: new Date().toISOString(), error: (err as Error).message },
    });
    throw err;
  } finally {
    running.delete(accountId);
  }
}

export class SyncInProgressError extends Error {
  constructor() {
    super('Une synchronisation Shopify est déjà en cours');
    this.name = 'SyncInProgressError';
  }
}

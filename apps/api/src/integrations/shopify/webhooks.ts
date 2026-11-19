// Webhook subscription management + topic handlers.
import type { IntegrationContext } from '../context.js';
import { ShopifyError, type ShopifyClient } from './client.js';
import { handleCheckoutPayload, markCheckoutsCompleted, summarizeLineItems } from './checkouts.js';
import { cleanEmail, customerFromRest, marketingStateFromRest, toNumber, upsertShopifyContact } from './contacts.js';
import { findContactByEmail, forgetTokens, orderAlreadyRecorded, updateIntegration } from './store.js';
import { WEBHOOK_TOPICS } from './types.js';
import { t } from '../../i18n.js';

const toGraphqlTopic = (topic: string) => topic.replace('/', '_').toUpperCase(); // orders/create → ORDERS_CREATE

const CREATE_MUTATION = /* GraphQL */ `
  mutation PingsellWebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

const LIST_QUERY = /* GraphQL */ `
  query PingsellWebhooks { webhookSubscriptions(first: 100) { nodes { id topic } } }
`;

const DELETE_MUTATION = /* GraphQL */ `
  mutation PingsellWebhookDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } }
  }
`;

interface CreatePayload {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string; topic: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

export function webhookAddress(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/api/v1/webhooks/shopify`;
}

/**
 * Subscribes to every topic we need. Shopify only delivers to public HTTPS endpoints, so with a
 * local PUBLIC_URL we skip registration and report why (use a tunnel, or the simulate endpoint).
 */
export async function registerWebhooks(
  client: ShopifyClient,
  publicUrl: string,
): Promise<{ webhooks: { id: string; topic: string }[]; error: string | null }> {
  const address = webhookAddress(publicUrl);
  if (!address.startsWith('https://') || /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(address)) {
    return {
      webhooks: [],
      error: t(
        `Webhooks non enregistrés : PUBLIC_URL (${publicUrl}) doit être une URL HTTPS publique (ex. tunnel cloudflared/ngrok).`,
        `Webhooks not registered: PUBLIC_URL (${publicUrl}) must be a public HTTPS URL (e.g. a cloudflared/ngrok tunnel).`,
      ),
    };
  }

  const webhooks: { id: string; topic: string }[] = [];
  const errors: string[] = [];
  let useLegacyField = false;
  for (const topic of WEBHOOK_TOPICS) {
    const sub = useLegacyField ? { callbackUrl: address, format: 'JSON' } : { uri: address, format: 'JSON' };
    try {
      const data = await client.graphql<CreatePayload>(CREATE_MUTATION, { topic: toGraphqlTopic(topic), sub });
      const result = data.webhookSubscriptionCreate;
      if (result.webhookSubscription) {
        webhooks.push({ id: result.webhookSubscription.id, topic });
      } else if (result.userErrors.some((e) => /already been taken|already exists/i.test(e.message))) {
        webhooks.push({ id: '', topic }); // already subscribed with this address
      } else {
        errors.push(t(`${topic} : ${result.userErrors.map((e) => e.message).join(', ')}`, `${topic}: ${result.userErrors.map((e) => e.message).join(', ')}`));
      }
    } catch (err) {
      // Older API versions only know `callbackUrl`: retry the same topic once with it.
      if (!useLegacyField && err instanceof ShopifyError && /uri/i.test(err.message)) {
        useLegacyField = true;
        try {
          const data = await client.graphql<CreatePayload>(CREATE_MUTATION, {
            topic: toGraphqlTopic(topic),
            sub: { callbackUrl: address, format: 'JSON' },
          });
          const created = data.webhookSubscriptionCreate.webhookSubscription;
          if (created) webhooks.push({ id: created.id, topic });
          else {
            const detail = data.webhookSubscriptionCreate.userErrors.map((e) => e.message).join(', ');
            errors.push(t(`${topic} : ${detail}`, `${topic}: ${detail}`));
          }
          continue;
        } catch (retryErr) {
          errors.push(t(`${topic} : ${(retryErr as Error).message}`, `${topic}: ${(retryErr as Error).message}`));
          continue;
        }
      }
      errors.push(t(`${topic} : ${(err as Error).message}`, `${topic}: ${(err as Error).message}`));
    }
  }
  return {
    webhooks,
    error: errors.length
      ? t(`Certains webhooks n’ont pas pu être créés — ${errors.join(' ; ')}`, `Some webhooks couldn’t be created — ${errors.join('; ')}`)
      : null,
  };
}

/** Best-effort removal of every webhook subscription owned by the app on this shop. */
export async function deleteWebhooks(client: ShopifyClient): Promise<void> {
  const data = await client.graphql<{ webhookSubscriptions: { nodes: { id: string }[] } }>(LIST_QUERY);
  for (const node of data.webhookSubscriptions.nodes) {
    await client.graphql(DELETE_MUTATION, { id: node.id }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Topic handlers (payloads are REST-format JSON)

type Payload = Record<string, unknown>;

export function handleCustomerWebhook(ctx: IntegrationContext, accountId: string, topic: string, payload: Payload): void {
  const data = customerFromRest(payload);
  if (!data) return;
  const { contactId, created, status } = upsertShopifyContact(ctx, accountId, data);
  if (created && topic === 'customers/create') {
    ctx.recordEvent(accountId, contactId, 'contact_created', { source: 'shopify' });
    if (status === 'subscribed') ctx.fireTrigger(accountId, contactId, 'contact_created', { source: 'shopify' });
  }
}

export function handleOrderWebhook(ctx: IntegrationContext, accountId: string, payload: Payload): void {
  const orderId = payload.id != null ? String(payload.id) : null;
  const customerRaw = (payload.customer as Payload | null | undefined) ?? null;
  const email = cleanEmail(payload.email) ?? cleanEmail(payload.contact_email) ?? cleanEmail(customerRaw?.email);
  if (!orderId || !email) return;
  if (orderAlreadyRecorded(ctx.db, accountId, orderId)) return;

  const total = toNumber(payload.total_price ?? payload.current_total_price);
  const createdAt = typeof payload.created_at === 'string' ? new Date(payload.created_at).toISOString() : new Date().toISOString();
  const existing = findContactByEmail(ctx.db, accountId, email);
  const customer = customerRaw ? customerFromRest(customerRaw, email) : null;
  const marketingState =
    marketingStateFromRest(customerRaw) ?? (payload.buyer_accepts_marketing === true ? 'subscribed' : null);

  const { contactId } = upsertShopifyContact(ctx, accountId, {
    email,
    first_name: customer?.first_name,
    last_name: customer?.last_name,
    phone: customer?.phone,
    tags: customer?.tags,
    external_id: customer?.external_id,
    marketing_state: marketingState,
    total_spent: Math.round(((existing?.total_spent ?? 0) + total) * 100) / 100,
    orders_count: (existing?.orders_count ?? 0) + 1,
    last_order_at: createdAt,
  });

  const data = {
    order_id: orderId,
    order_name: typeof payload.name === 'string' ? payload.name : null,
    total,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    line_items: summarizeLineItems(payload.line_items),
    source: 'shopify',
  };
  ctx.recordEvent(accountId, contactId, 'order', data);
  ctx.fireTrigger(accountId, contactId, 'order_created', data);

  markCheckoutsCompleted(ctx, accountId, {
    checkoutId: payload.checkout_id != null ? String(payload.checkout_id) : null,
    token: typeof payload.checkout_token === 'string' ? payload.checkout_token : null,
    email,
  });
}

/**
 * Order shipped: transactional trigger (lock-screen / in-app "your order is on its way" with the
 * tracking link), reaching customers even when they opted out of marketing.
 */
export function handleOrderFulfilledWebhook(ctx: IntegrationContext, accountId: string, payload: Payload): void {
  const orderId = payload.id != null ? String(payload.id) : null;
  const customerRaw = (payload.customer as Payload | null | undefined) ?? null;
  const email = cleanEmail(payload.email) ?? cleanEmail(payload.contact_email) ?? cleanEmail(customerRaw?.email);
  if (!orderId || !email) return;
  const contact = findContactByEmail(ctx.db, accountId, email);
  if (!contact) return;
  const fulfillments = Array.isArray(payload.fulfillments) ? (payload.fulfillments as Payload[]) : [];
  const last = fulfillments[fulfillments.length - 1] ?? {};
  const data = {
    order_id: orderId,
    order_name: typeof payload.name === 'string' ? payload.name : null,
    tracking_number: typeof last.tracking_number === 'string' ? last.tracking_number : null,
    tracking_url: typeof last.tracking_url === 'string' ? last.tracking_url : null,
    carrier: typeof last.tracking_company === 'string' ? last.tracking_company : null,
    source: 'shopify',
  };
  ctx.recordEvent(accountId, contact.id, 'order_fulfilled', data);
  ctx.fireTrigger(accountId, contact.id, 'order_fulfilled', data);
}

export function handleAppUninstalled(ctx: IntegrationContext, accountId: string): void {
  // SPEC status enum is 'connected' | 'error': an uninstalled app is reported as a disconnected error state.
  updateIntegration(
    ctx.db,
    accountId,
    { error: t('Application désinstallée depuis Shopify : reconnectez la boutique.', 'App uninstalled from Shopify: reconnect the store.'), uninstalled_at: new Date().toISOString(), webhooks: [] },
    { status: 'error', access_token: '' },
  );
  forgetTokens(ctx.db, accountId);
}

/** Dispatches a verified webhook to its handler. */
export function dispatchWebhook(ctx: IntegrationContext, accountId: string, shop: string, topic: string, payload: Payload): boolean {
  switch (topic) {
    case 'customers/create':
    case 'customers/update':
      handleCustomerWebhook(ctx, accountId, topic, payload);
      return true;
    case 'orders/create':
      handleOrderWebhook(ctx, accountId, payload);
      return true;
    case 'orders/fulfilled':
      handleOrderFulfilledWebhook(ctx, accountId, payload);
      return true;
    case 'checkouts/create':
    case 'checkouts/update':
      handleCheckoutPayload(ctx, accountId, shop, payload);
      return true;
    case 'app/uninstalled':
      handleAppUninstalled(ctx, accountId);
      return true;
    default:
      return false;
  }
}

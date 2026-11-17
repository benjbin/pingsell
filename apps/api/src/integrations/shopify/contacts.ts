// Mapping Shopify customers/orders to Pingsell contacts.
import type { IntegrationContext } from '../context.js';
import { findContactByEmail } from './store.js';

/** Normalized customer data, whatever the source (REST webhook payload or GraphQL node). */
export interface ShopifyCustomerData {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  tags?: string[];
  external_id?: string | null;
  total_spent?: number;
  orders_count?: number;
  last_order_at?: string | null;
  /** Shopify email marketing state, lower-case (subscribed, not_subscribed, unsubscribed, pending, redacted, invalid). */
  marketing_state?: string | null;
}

export interface UpsertOutcome {
  contactId: string;
  created: boolean;
  status: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/** Shopify sends tags as "a, b, c" (REST) or string[] (GraphQL). */
export function parseTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

export function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Reads the marketing state from a REST customer payload (new consent object or legacy boolean). */
export function marketingStateFromRest(customer: Record<string, unknown> | null | undefined): string | null {
  if (!customer) return null;
  const consent = customer.email_marketing_consent as { state?: unknown } | null | undefined;
  if (consent && typeof consent.state === 'string') return consent.state.toLowerCase();
  if (typeof customer.accepts_marketing === 'boolean') return customer.accepts_marketing ? 'subscribed' : 'not_subscribed';
  return null;
}

/**
 * Consent → Pingsell status.
 * - explicit opt-in → subscribed (except contacts already bounced/complained);
 * - explicit opt-out → unsubscribed;
 * - no consent: new contacts are created `unsubscribed` (no marketing without opt-in, RGPD),
 *   existing contacts keep their current status.
 */
export function resolveStatus(marketingState: string | null | undefined, existingStatus: string | undefined): string | undefined {
  const hardStop = existingStatus === 'bounced' || existingStatus === 'complained';
  switch (marketingState) {
    case 'subscribed':
      return hardStop ? undefined : 'subscribed';
    case 'unsubscribed':
    case 'redacted':
      return hardStop ? undefined : 'unsubscribed';
    default:
      return existingStatus ? undefined : 'unsubscribed';
  }
}

/**
 * Upserts a contact from Shopify data. Existing tags are preserved (union), the source is only set
 * on creation, and numeric fields are only sent when known.
 */
export function upsertShopifyContact(ctx: IntegrationContext, accountId: string, data: ShopifyCustomerData): UpsertOutcome {
  const existing = findContactByEmail(ctx.db, accountId, data.email);
  const tags = [...new Set([...(existing?.tags ?? []), ...(data.tags ?? [])])];
  const status = resolveStatus(data.marketing_state, existing?.status);

  const input: Parameters<IntegrationContext['upsertContact']>[1] = { email: data.email, tags };
  if (data.first_name) input.first_name = data.first_name;
  if (data.last_name) input.last_name = data.last_name;
  if (data.phone) input.phone = data.phone;
  if (data.external_id) input.external_id = data.external_id;
  if (data.total_spent !== undefined) input.total_spent = data.total_spent;
  if (data.orders_count !== undefined) input.orders_count = data.orders_count;
  if (data.last_order_at) input.last_order_at = data.last_order_at;
  if (status) input.status = status;
  if (!existing) input.source = 'shopify';

  const { contact, created } = ctx.upsertContact(accountId, input);
  const contactId = String((contact as { id?: unknown } | null)?.id ?? existing?.id ?? '');
  if (!contactId) throw new Error(`Contact introuvable après upsert (${data.email})`);
  return { contactId, created, status: status ?? existing?.status ?? 'subscribed' };
}

/** Fields of a REST customer payload (webhook or nested in an order). */
export function customerFromRest(customer: Record<string, unknown>, fallbackEmail?: string | null): ShopifyCustomerData | null {
  const email = cleanEmail(customer.email) ?? cleanEmail(fallbackEmail);
  if (!email) return null;
  const data: ShopifyCustomerData = {
    email,
    first_name: strOrNull(customer.first_name),
    last_name: strOrNull(customer.last_name),
    phone: strOrNull(customer.phone),
    tags: parseTags(customer.tags),
    external_id: customer.id != null ? String(customer.id) : null,
    marketing_state: marketingStateFromRest(customer),
  };
  // Older payloads still carry these aggregates; newer ones may not.
  if (customer.total_spent !== undefined && customer.total_spent !== null) data.total_spent = toNumber(customer.total_spent);
  if (typeof customer.orders_count === 'number') data.orders_count = customer.orders_count;
  return data;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

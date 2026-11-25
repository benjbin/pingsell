// Shopify App Pricing: plans are set up in the Partner Dashboard and sold by Shopify on its own plan
// selection page; Shopify bills the merchant. Pingsell only reads which plan a store is on (Partner API) and
// sends merchants without a plan to that page. No webhook is sent for plan changes since April 2026, so the
// plan is read again when the merchant opens Pingsell (cached a few minutes, Partner API: 4 requests/s).
import type { DatabaseSync } from 'node:sqlite';
import { clientFor, getIntegration, parseConfig, updateIntegration } from './store.js';
import type { PlanId, StoreBilling } from './types.js';

export interface BillingConfig {
  orgId: string;
  token: string;
  appId: string;
  appHandle: string;
}

/** How long a plan read from Shopify is trusted before asking again. */
export const PLAN_CACHE_MS = 5 * 60_000;

/** Partner API version (quarterly, like the Admin API). */
export const PARTNER_API_VERSION = '2026-07';

/** Shopify's hosted page where the merchant picks, upgrades or downgrades a plan (opened outside the app frame). */
export function pricingUrl(shop: string, appHandle: string): string {
  const store = shop.replace(/\.myshopify\.com$/i, '');
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

/**
 * Pingsell plan behind the handles of a Shopify subscription. Plan handles are chosen in the Partner Dashboard:
 * anything containing « business » → Business, « pro » → Pro, any other paid or free plan → Free.
 */
export function planFromHandles(handles: string[]): PlanId {
  const h = handles.map((x) => x.toLowerCase());
  if (h.some((x) => x.includes('business'))) return 'business';
  if (h.some((x) => x.includes('pro'))) return 'pro';
  return 'free';
}

interface ActiveSubscription {
  billingPeriod?: string | null;
  cancelAtEndOfCycle?: boolean | null;
  trialEndsAt?: string | null;
  currentBillingCycle?: { endTime?: string | null } | null;
  items?: Array<{ handle?: string | null }> | null;
}

/** The store's active subscription, or null when it has none. Throws when the Partner API can't be reached. */
export async function fetchActiveSubscription(cfg: BillingConfig, shopGid: string, fetchImpl: typeof fetch = fetch): Promise<ActiveSubscription | null> {
  const res = await fetchImpl(`https://partners.shopify.com/${encodeURIComponent(cfg.orgId)}/api/${PARTNER_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': cfg.token },
    body: JSON.stringify({
      query: `query ($appId: ID!, $shopId: ID!) {
        activeSubscription(appId: $appId, shopId: $shopId) {
          billingPeriod cancelAtEndOfCycle trialEndsAt
          currentBillingCycle { endTime }
          items { handle }
        }
      }`,
      variables: { appId: `gid://shopify/App/${cfg.appId}`, shopId: shopGid },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { data?: { activeSubscription?: ActiveSubscription | null }; errors?: Array<{ message?: string }> } | null;
  if (!res.ok || !body || body.errors?.length || !body.data) {
    const why = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Partner API: ${why}`);
  }
  return body.data.activeSubscription ?? null;
}

export function toStoreBilling(sub: ActiveSubscription | null, shopGid: string, at = new Date()): StoreBilling {
  const handles = (sub?.items ?? []).map((i) => String(i?.handle ?? '')).filter(Boolean);
  return {
    shop_gid: shopGid,
    plan: sub ? planFromHandles(handles) : null,
    handles,
    billing_period: sub?.billingPeriod ?? null,
    trial_ends_at: sub?.trialEndsAt ?? null,
    period_ends_at: sub?.currentBillingCycle?.endTime ?? null,
    cancel_at_end: Boolean(sub?.cancelAtEndOfCycle),
    checked_at: at.toISOString(),
  };
}

/**
 * The plan of the store connected to `accountId`, read from Shopify unless a recent answer is cached.
 * `refresh` skips the cache (the merchant just came back from the plan selection page).
 */
export async function storePlan(
  db: DatabaseSync,
  accountId: string,
  cfg: BillingConfig,
  opts: { refresh?: boolean; now?: number; fetchImpl?: typeof fetch } = {},
): Promise<StoreBilling | null> {
  const row = getIntegration(db, accountId);
  if (!row) return null;
  const cached = parseConfig(row.config).billing;
  const now = opts.now ?? Date.now();
  if (cached && !opts.refresh && now - Date.parse(cached.checked_at) < PLAN_CACHE_MS) return cached;

  let shopGid = cached?.shop_gid;
  if (!shopGid) {
    const data = await clientFor(db, accountId, row.shop_domain).graphql<{ shop: { id: string } }>('query { shop { id } }');
    shopGid = data.shop.id;
  }
  const billing = toStoreBilling(await fetchActiveSubscription(cfg, shopGid, opts.fetchImpl), shopGid, new Date(now));
  updateIntegration(db, accountId, { billing });
  return billing;
}

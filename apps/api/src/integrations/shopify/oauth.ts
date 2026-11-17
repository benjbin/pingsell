// OAuth (public app) helpers: install URL + one-time state nonces.
import { randomBytes } from 'node:crypto';
import { SHOPIFY_SCOPES } from './types.js';

const STATE_TTL_MS = 10 * 60 * 1000;

interface PendingInstall {
  accountId: string;
  shop: string;
  expiresAt: number;
}

const pending = new Map<string, PendingInstall>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, value] of pending) if (value.expiresAt < now) pending.delete(key);
}

export function createState(accountId: string, shop: string): string {
  purgeExpired();
  const state = randomBytes(24).toString('hex');
  pending.set(state, { accountId, shop, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

/** Returns (and consumes) the pending install for `state`, or null if unknown / expired / other shop. */
export function consumeState(state: unknown, shop: string): PendingInstall | null {
  if (typeof state !== 'string') return null;
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expiresAt < Date.now() || entry.shop !== shop) return null;
  return entry;
}

export function callbackUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/api/v1/integrations/shopify/callback`;
}

export function buildInstallUrl(shop: string, apiKey: string, publicUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SHOPIFY_SCOPES.join(','),
    redirect_uri: callbackUrl(publicUrl),
    state,
  });
  // No grant_options[]=per-user → offline (non-expiring) access token, needed for background sync.
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

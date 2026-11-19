// Shared types for the Shopify integration module.

/** Admin API version used for every call (supported until July 2027; bump yearly, Shopify refuses apps on versions deprecated within 90 days). */
export const SHOPIFY_API_VERSION = '2026-07';

/** Access scopes requested by the OAuth flow (and required for a custom / Dev Dashboard app). */
export const SHOPIFY_SCOPES = ['read_customers', 'read_orders'] as const;

/** Webhook topics we subscribe to (REST-style names, as sent in X-Shopify-Topic). */
export const WEBHOOK_TOPICS = [
  'customers/create',
  'customers/update',
  'orders/create',
  'orders/fulfilled',
  'checkouts/create',
  'checkouts/update',
  'app/uninstalled',
] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

/** Delay without an order after which a pending checkout is considered abandoned. */
export const ABANDON_AFTER_MS = 60 * 60 * 1000;

/** Row of the core `integrations` table (provider = 'shopify'). */
export interface IntegrationRow {
  id: string;
  account_id: string;
  provider: string;
  shop_domain: string;
  access_token: string;
  status: 'connected' | 'error';
  config: string | null;
  last_sync_at: string | null;
  created_at: string;
}

/** Content of `integrations.config` for Shopify (never contains secrets). */
export interface ShopifyConfig {
  auth_mode?: 'custom_app' | 'client_credentials' | 'oauth';
  shop_name?: string;
  shop_email?: string;
  currency?: string;
  scopes?: string[];
  webhooks?: { id: string; topic: string }[];
  webhooks_error?: string | null;
  sync?: {
    running: boolean;
    started_at?: string;
    finished_at?: string;
    customers?: number;
    orders?: number;
    error?: string | null;
  };
  error?: string | null;
  uninstalled_at?: string;
}

/** Public representation returned to clients (never the token). */
export interface PublicIntegration {
  id: string;
  provider: 'shopify';
  shop_domain: string;
  status: string;
  connected: boolean;
  config: ShopifyConfig;
  last_sync_at: string | null;
  created_at: string;
}

export interface SyncResult {
  customers: number;
  orders: number;
}

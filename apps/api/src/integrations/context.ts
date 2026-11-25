import type { DatabaseSync } from 'node:sqlite';
import type { preHandlerHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';

/**
 * Contract between the core API and integration modules (see SPEC.md
 * "Core ↔ Shopify module interface"). Do not change this shape.
 */
export interface IntegrationContext {
  db: DatabaseSync; // node:sqlite
  requireAuth: preHandlerHookHandler; // sets request.accountId
  upsertContact(
    accountId: string,
    input: {
      email: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
      tags?: string[];
      source?: string;
      external_id?: string;
      total_spent?: number;
      orders_count?: number;
      last_order_at?: string;
      status?: string;
    },
  ): { contact: any; created: boolean };
  recordEvent(accountId: string, contactId: string, type: string, data?: object): void;
  fireTrigger(
    accountId: string,
    contactId: string,
    trigger: 'contact_created' | 'tag_added' | 'order_created' | 'cart_abandoned' | 'order_fulfilled',
    data?: object,
  ): void;
  config: { publicUrl: string; shopifyApiKey?: string; shopifyApiSecret?: string; shopifyBilling?: AppConfig['shopifyBilling'] };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth` for authenticated routes. */
    accountId: string;
    /** Set by `requireAuth` for session tokens ("" for API keys, which act as the account). */
    userId: string;
    /** Set by `requireAuth` when the caller used a secret API key. */
    apiKeyId?: string;
    /** Raw request body as received, for every JSON request (webhook HMAC verification). */
    rawBody?: string;
  }
}

// HMAC helpers: webhook signatures (base64) and OAuth query signatures (hex).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifies the `X-Shopify-Hmac-Sha256` header: base64(HMAC-SHA256(secret, raw body)).
 * The raw body must be the exact bytes Shopify sent.
 */
export function verifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  return safeEqual(digest, hmacHeader.trim());
}

/**
 * Verifies the `hmac` query parameter of an OAuth redirect: every other parameter
 * (except `hmac` / `signature`), sorted by key, joined as `k=v&k=v`, HMAC-SHA256 hex.
 */
export function verifyOAuthHmac(query: Record<string, unknown>, secret: string): boolean {
  const provided = typeof query.hmac === 'string' ? query.hmac : '';
  if (!provided || !secret) return false;
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => {
      const v = query[k];
      const value = Array.isArray(v) ? v.join(',') : String(v ?? '');
      return `${k}=${value}`;
    })
    .join('&');
  const digest = createHmac('sha256', secret).update(message).digest('hex');
  return safeEqual(digest, provided.toLowerCase());
}

// Session tokens of embedded apps: App Bridge hands the page a short-lived JWT (HS256, signed with the
// app's client secret). Verifying it tells us which shop is talking, without cookies or local storage.
import { createHmac } from 'node:crypto';
import { safeEqual } from './hmac.js';
import { normalizeShopDomain } from './client.js';

export interface SessionToken {
  shop: string;
  /** The raw token, for the token exchange. */
  raw: string;
  /** Shopify user id (`sub`), when present. */
  user: string | null;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Returns the shop of a valid session token for this app, or null (bad signature, other app, expired…). */
export function verifySessionToken(token: string | null | undefined, apiKey: string, apiSecret: string, now = Date.now()): SessionToken | null {
  if (!token || !apiKey || !apiSecret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  let header: { alg?: string };
  let payload: { iss?: string; dest?: string; aud?: string | string[]; exp?: number; nbf?: number; sub?: string };
  try {
    header = JSON.parse(b64url(h).toString('utf8'));
    payload = JSON.parse(b64url(p).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', apiSecret).update(`${h}.${p}`).digest('base64url');
  if (!safeEqual(expected, sig)) return null;

  const seconds = Math.floor(now / 1000);
  const leeway = 10; // clock skew between Shopify and us
  if (typeof payload.exp !== 'number' || payload.exp + leeway < seconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf - leeway > seconds) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(apiKey)) return null;

  const dest = normalizeShopDomain(String(payload.dest ?? '').replace(/^https?:\/\//, ''));
  const iss = normalizeShopDomain(String(payload.iss ?? '').replace(/^https?:\/\//, '').replace(/\/admin\/?$/, ''));
  if (!dest || dest !== iss) return null;
  return { shop: dest, raw: token, user: payload.sub ? String(payload.sub) : null };
}

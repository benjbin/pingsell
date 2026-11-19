// Minimal Shopify Admin API client built on global fetch (no SDK).
import { SHOPIFY_API_VERSION } from './types.js';
import { t } from '../../i18n.js';

const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 20_000;

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Normalizes user input ("ma-boutique", "https://ma-boutique.myshopify.com/admin")
 * to "ma-boutique.myshopify.com". Returns null when the value is not a valid shop domain.
 */
export function normalizeShopDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? '';
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return SHOP_RE.test(s) ? s : null;
}

export function isValidShopDomain(shop: string): boolean {
  return SHOP_RE.test(shop);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RestResponse<T> {
  body: T;
  headers: Headers;
  status: number;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
    };
  };
}

/** Parses an RFC 5988 Link header and returns the `rel="next"` URL, if any (REST pagination). */
export function nextLinkFromHeader(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m?.[1]) return m[1];
  }
  return null;
}

export type TokenProvider = () => Promise<string>;

export class ShopifyClient {
  private readonly base: string;

  constructor(
    readonly shop: string,
    private readonly token: TokenProvider,
  ) {
    this.base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
  }

  /** REST call. `path` is relative to /admin/api/{version} (e.g. "/shop.json") or an absolute URL. */
  async rest<T>(method: string, path: string, body?: unknown): Promise<RestResponse<T>> {
    const url = path.startsWith('https://') ? path : `${this.base}${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(url, method, body);
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '2');
        await sleep(Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 2) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      const parsed: unknown = text ? safeJson(text) : null;
      if (!res.ok) throw new ShopifyError(describeHttpError(res.status, parsed), res.status, parsed);
      return { body: parsed as T, headers: res.headers, status: res.status };
    }
  }

  /** GraphQL Admin call with automatic back-off on THROTTLED errors. */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `${this.base}/graphql.json`;
    for (let attempt = 0; ; attempt++) {
      const { body } = await this.rest<GraphQLResponse<T>>('POST', url, { query, variables });
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < MAX_RETRIES) {
        const status = body.extensions?.cost?.throttleStatus;
        const needed = body.extensions?.cost?.requestedQueryCost ?? 100;
        const waitSec = status ? Math.ceil(Math.max(0, needed - status.currentlyAvailable) / (status.restoreRate || 50)) : 2;
        await sleep(Math.max(1, waitSec) * 1000);
        continue;
      }
      if (body.errors?.length) {
        throw new ShopifyError(
          t(
            `Erreur GraphQL Shopify : ${body.errors.map((e) => e.message).join(' ; ')}`,
            `Shopify GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`,
          ),
          400,
          body.errors,
        );
      }
      if (!body.data) throw new ShopifyError(t('Réponse GraphQL Shopify vide', 'Empty Shopify GraphQL response'), 502);
      // Be polite with the leaky bucket: pause when we're running low.
      const status = body.extensions?.cost?.throttleStatus;
      if (status && status.currentlyAvailable < status.maximumAvailable * 0.1) {
        await sleep(1000);
      }
      return body.data;
    }
  }

  private async send(url: string, method: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'X-Shopify-Access-Token': await this.token(),
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShopifyError(t(`Impossible de joindre ${this.shop} : ${(err as Error).message}`, `Can’t reach ${this.shop}: ${(err as Error).message}`), 502);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeHttpError(status: number, body: unknown): string {
  if (status === 401) return t('Jeton d’accès Shopify invalide ou révoqué', 'Shopify access token is invalid or revoked');
  if (status === 403) return t('Accès refusé par Shopify : vérifiez les autorisations (scopes) de l’application', 'Access denied by Shopify: check the app’s permissions (scopes)');
  if (status === 404) return t('Boutique Shopify introuvable', 'Shopify store not found');
  const detail =
    body && typeof body === 'object' && 'errors' in body ? JSON.stringify((body as { errors: unknown }).errors) : '';
  return t(`Erreur Shopify (HTTP ${status})${detail ? ` : ${detail}` : ''}`, `Shopify error (HTTP ${status})${detail ? `: ${detail}` : ''}`);
}

/** Exchanges credentials at the shop's OAuth token endpoint (authorization code or client credentials). */
export async function requestAccessToken(
  shop: string,
  params: Record<string, string>,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ShopifyError(t(`Impossible de joindre ${shop} : ${(err as Error).message}`, `Can’t reach ${shop}: ${(err as Error).message}`), 502);
  }
  const text = await res.text();
  const body = safeJson(text) as Partial<TokenResponse> & { error_description?: string };
  if (!res.ok || !body?.access_token) {
    const detail = typeof body === 'object' && body?.error_description ? body.error_description : '';
    throw new ShopifyError(
      t(
        `Échec de l’obtention du jeton Shopify (HTTP ${res.status})${detail ? ` : ${detail}` : ''}`,
        `Couldn’t get the Shopify token (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      ),
      res.status === 200 || res.status >= 500 || res.status === 429 ? 502 : 400,
    );
  }
  return {
    access_token: body.access_token,
    scope: body.scope,
    expires_in: body.expires_in,
    refresh_token: body.refresh_token,
    refresh_token_expires_in: body.refresh_token_expires_in,
  };
}

/** Token endpoint answer. Expiring offline tokens (expiring=1) also carry a rotating refresh token. */
export interface TokenResponse {
  access_token: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/** Thrown when Shopify answers 400/401 to a refresh: the refresh token is dead, the merchant must reinstall. */
export function isTerminalTokenError(err: unknown): boolean {
  return err instanceof ShopifyError && err.status === 400;
}

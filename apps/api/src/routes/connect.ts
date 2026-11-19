import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { get, run, transaction, type DatabaseSync } from '../db.js';
import type { Deps } from '../deps.js';
import { HttpError, badRequest, forbidden, parse } from '../lib/http.js';
import { t } from '../i18n.js';
import { createApiKey } from '../services/auth.js';
import { limiter } from './inbound.js';

/**
 * « Connecter à Pingsell » for the WordPress and PrestaShop plugins.
 * 1. The signed-in owner/admin approves on the web app → `authorize` returns the plugin's return URL
 *    carrying a single-use code (10 min).
 * 2. The plugin exchanges the code server-to-server (`public/connect/exchange`) for an API key.
 */

const PREFIX = '/api/v1';
const CODE_TTL_MS = 10 * 60_000;
const PLATFORMS = ['wordpress', 'prestashop'] as const;
type Platform = (typeof PLATFORMS)[number];
const PLATFORM_LABEL: Record<Platform, string> = { wordpress: 'WordPress', prestashop: 'PrestaShop' };

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/i;

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

function toUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** http only for a local host outside production; https otherwise. */
function schemeAllowed(url: URL, isProduction: boolean): boolean {
  if (url.protocol === 'https:') return true;
  return !isProduction && LOCAL_HOST.test(url.hostname);
}

export function purgeConnectCodes(db: DatabaseSync, nowMs = Date.now()): number {
  return run(db, 'DELETE FROM connect_codes WHERE expires_at < ?', new Date(nowMs).toISOString());
}

const authorizeSchema = z.object({
  platform: z.enum(PLATFORMS),
  site: z.string().trim().min(1).max(2048),
  return_url: z.string().trim().min(1).max(2048),
  state: z.string().min(16).max(128),
});

const exchangeSchema = z.object({
  code: z.string().min(1).max(200),
  platform: z.string().max(40),
  site: z.string().max(2048),
});

/** Authenticated part (registered behind `requireAuth`, under the API prefix). */
export async function connectRoutes(app: FastifyInstance, { db, config }: Deps) {
  app.post('/integrations/connect/authorize', async (request) => {
    // A connected plugin gets an API key, which acts as the whole account: same rule as API keys.
    if (!request.userId) throw forbidden(t('Connectez-vous à votre compte pour relier une boutique', 'Sign in to your account to connect a store'));
    const role = get<{ role: string }>(db, 'SELECT role FROM users WHERE id = ?', request.userId)?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw forbidden(t('Relier une boutique est réservé au propriétaire et aux administrateurs', 'Connecting a store is limited to the owner and admins'));
    }
    const body = parse(authorizeSchema, request.body);
    const site = toUrl(body.site);
    if (!site) throw badRequest(t('L’adresse de la boutique est invalide.', 'The store address is invalid.'));
    const returnUrl = toUrl(body.return_url);
    if (!returnUrl || !schemeAllowed(returnUrl, config.isProduction)) {
      throw badRequest(t('L’adresse de retour doit être en https.', 'The return address must use https.'));
    }
    if (returnUrl.hostname.toLowerCase() !== site.hostname.toLowerCase()) {
      throw badRequest(t('L’adresse de retour ne correspond pas à la boutique.', 'The return address does not match the store.'));
    }

    const nowMs = Date.now();
    purgeConnectCodes(db, nowMs);
    const code = randomBytes(32).toString('base64url');
    run(
      db,
      'INSERT INTO connect_codes (code_hash, account_id, user_id, platform, site_host, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      hashCode(code),
      request.accountId,
      request.userId,
      body.platform,
      site.hostname.toLowerCase(),
      new Date(nowMs).toISOString(),
      new Date(nowMs + CODE_TTL_MS).toISOString(),
    );
    const raw = returnUrl.toString();
    const sep = raw.includes('?') ? '&' : '?';
    return { redirect: `${raw}${sep}pingsell_code=${code}&state=${encodeURIComponent(body.state)}` };
  });
}

/** Public part (full `/api/v1/public/...` path: any origin, no auth, limited per IP). */
export async function publicConnectRoutes(app: FastifyInstance, { db, config }: Deps) {
  const perIp = limiter(Number(process.env.CONNECT_RATE_PER_IP ?? 20), 10 * 60_000);

  app.post(`${PREFIX}/public/connect/exchange`, { bodyLimit: 8 * 1024 }, async (request) => {
    if (!perIp(request.ip)) throw new HttpError(429, t('Trop de requêtes, réessayez dans quelques minutes', 'Too many requests, try again in a few minutes'));
    const expired = () => badRequest(t('Ce lien de connexion a expiré. Recommencez depuis votre boutique.', 'This connection link has expired. Start again from your store.'));
    const parsed = exchangeSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw expired();
    const { code, platform, site } = parsed.data;
    const siteUrl = toUrl(site);
    if (!siteUrl || !(PLATFORMS as readonly string[]).includes(platform)) throw expired();

    const result = transaction(db, () => {
      const nowIso = new Date().toISOString();
      const row = get<{ code_hash: string; account_id: string; platform: string; site_host: string; expires_at: string; used_at: string | null }>(
        db,
        'SELECT code_hash, account_id, platform, site_host, expires_at, used_at FROM connect_codes WHERE code_hash = ?',
        hashCode(code),
      );
      if (!row || row.used_at || row.expires_at < nowIso) return undefined;
      if (row.platform !== platform || row.site_host !== siteUrl.hostname.toLowerCase()) return undefined;
      // Single use, even under concurrent requests.
      if (run(db, 'UPDATE connect_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', nowIso, row.code_hash) !== 1) return undefined;
      const account = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', row.account_id);
      if (!account) return undefined;
      const label = `${PLATFORM_LABEL[platform as Platform]} · ${row.site_host}`;
      run(db, 'DELETE FROM api_keys WHERE account_id = ? AND label = ?', row.account_id, label);
      const key = createApiKey(db, row.account_id, label);
      return { api_key: key.key, api_url: config.publicUrl, account_name: account.name };
    });
    if (!result) throw expired();
    return result;
  });
}

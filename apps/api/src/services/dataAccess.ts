// Journal des accès aux données personnelles des contacts (exigence Shopify « protected customer data ») :
// chaque appel réussi ou refusé à une route qui lit, modifie, importe ou supprime des contacts laisse une ligne.
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { newId, now, run } from '../db.js';

/** Route (sans le préfixe de l'API) → action consignée. */
const ROUTES: Record<string, string> = {
  'GET /contacts': 'contacts.list',
  'POST /contacts': 'contact.upsert',
  'POST /contacts/import': 'contacts.import',
  'GET /contacts/:id': 'contact.view',
  'PATCH /contacts/:id': 'contact.update',
  'DELETE /contacts/:id': 'contact.delete',
  'POST /contacts/:id/tags': 'contact.tags',
  'POST /segments/preview': 'segment.preview',
  'GET /campaigns/:id/recipients': 'campaign.recipients',
  'GET /admin/accounts/:id': 'admin.account.view',
};

/** Durée de conservation du journal. */
export const DATA_ACCESS_RETENTION_DAYS = 365;

function actionFor(method: string, url: string | undefined): { action: string; route: string } | undefined {
  if (!url) return undefined;
  for (const [key, action] of Object.entries(ROUTES)) {
    const [m, path] = key.split(' ');
    if (m === method && url.endsWith(path)) return { action, route: path };
  }
  return undefined;
}

export function logDataAccess(
  db: DatabaseSync,
  entry: { accountId?: string; userId?: string; apiKeyId?: string; action: string; target?: string; route: string; ip?: string; status: number },
): void {
  run(
    db,
    `INSERT INTO data_access_log (id, account_id, user_id, api_key_id, action, target, route, ip, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    entry.accountId || null,
    entry.userId || null,
    entry.apiKeyId || null,
    entry.action,
    entry.target ?? null,
    entry.route,
    entry.ip ?? null,
    entry.status,
    now(),
  );
}

/** onResponse hook : consigne les accès aux routes de contacts, après authentification (les 401 n'ont pas de compte). */
export function makeLogDataAccess(db: DatabaseSync) {
  return async function logAccess(request: FastifyRequest, reply: FastifyReply) {
    const match = actionFor(request.method, request.routeOptions?.url);
    if (!match || !request.accountId) return;
    const params = (request.params ?? {}) as Record<string, unknown>;
    try {
      logDataAccess(db, {
        accountId: request.accountId,
        userId: request.userId,
        apiKeyId: request.apiKeyId,
        action: match.action,
        target: typeof params.id === 'string' ? params.id : undefined,
        route: match.route,
        ip: request.ip,
        status: reply.statusCode,
      });
    } catch (err) {
      request.log.error({ err }, 'data access log failed');
    }
  };
}

/** Supprime les lignes plus anciennes que la durée de conservation. Renvoie le nombre de lignes supprimées. */
export function purgeDataAccessLog(db: DatabaseSync, retentionDays = DATA_ACCESS_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return run(db, 'DELETE FROM data_access_log WHERE created_at < ?', cutoff);
}

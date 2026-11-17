import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, parseJson } from '../db.js';
import type { Deps } from '../deps.js';
import { clampInt, parse } from '../lib/http.js';
import { generateEmail } from '../services/templates.js';
import { serializeMessage } from '../services/messages.js';
import { overviewStats } from '../services/stats.js';

const generateSchema = z.object({
  prompt: z.string().trim().min(3, 'Décrivez l’email à générer').max(4000),
  tone: z.string().trim().max(60).optional(),
  brand: z.string().trim().max(120).optional(),
});

export async function statsRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/stats/overview', async (request) => {
    const days = clampInt((request.query as Record<string, unknown>)?.days, 30, 1, 365);
    return overviewStats(db, request.accountId, days);
  });
}

export async function templateRoutes(app: FastifyInstance) {
  app.post('/templates/generate-email', async (request) => {
    const body = parse(generateSchema, request.body);
    return generateEmail(body);
  });
}

export async function outboxRoutes(app: FastifyInstance, { db, config }: Deps) {
  app.get('/outbox', async (request) => {
    const limit = clampInt((request.query as Record<string, unknown>)?.limit, 20, 1, 100);
    const rows = all(
      db,
      'SELECT * FROM messages WHERE account_id = ? ORDER BY created_at DESC LIMIT ?',
      request.accountId,
      limit,
    );
    return { data: rows.map((m) => serializeMessage(m, true)), provider: config.emailProvider };
  });
}

export async function integrationRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/integrations', async (request) => {
    const rows = all(
      db,
      `SELECT id, provider, shop_domain, status, config, last_sync_at, created_at
         FROM integrations WHERE account_id = ? ORDER BY created_at`,
      request.accountId,
    );
    return {
      data: rows.map((r) => {
        // Never expose secrets that integration modules may have stored in config.
        const cfg = parseJson<Record<string, unknown>>(r.config, {});
        for (const key of Object.keys(cfg)) {
          if (/secret|token|password|key/i.test(key)) delete cfg[key];
        }
        return {
          id: r.id,
          provider: r.provider,
          shop_domain: r.shop_domain ?? null,
          status: r.status,
          connected: r.status === 'connected',
          config: cfg,
          last_sync_at: r.last_sync_at ?? null,
          created_at: r.created_at,
        };
      }),
    };
  });
}

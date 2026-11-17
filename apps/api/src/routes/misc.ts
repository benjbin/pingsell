import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, parseJson } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, clampInt, parse } from '../lib/http.js';
import { generateEmail } from '../services/templates.js';
import { serializeMessage } from '../services/messages.js';
import { overviewStats } from '../services/stats.js';
import { analytics } from '../services/analytics.js';

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

  /** Full analytics: ?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=<getTimezoneOffset()>, or ?days=30. */
  app.get('/stats/analytics', async (request) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const tz = clampInt(q.tz, 0, -840, 840);
    const today = new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10);
    const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    let from: string;
    let to: string;
    if (isDate(q.from) && isDate(q.to)) {
      from = q.from;
      to = q.to;
    } else {
      const days = clampInt(q.days, 30, 1, 366);
      to = today;
      from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    }
    if (from > to) throw badRequest('La date de début doit précéder la date de fin');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw badRequest('Période limitée à 1 an');
    return analytics(db, request.accountId, { from, to, tz });
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

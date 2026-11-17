import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabaseSync } from './db.js';
import type { Deps } from './deps.js';
import type { IntegrationContext } from './integrations/context.js';
import { registerShopify } from './integrations/shopify/index.js';
import { HttpError, formatZodError } from './lib/http.js';
import { makeRequireAuth } from './services/auth.js';
import { fireTrigger } from './services/automations.js';
import { recordEvent, upsertContact } from './services/contacts.js';
import type { EmailProvider } from './services/mailer.js';
import { accountRoutes, authRoutes } from './routes/auth.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { contactRoutes } from './routes/contacts.js';
import { segmentRoutes } from './routes/segments.js';
import { campaignRoutes } from './routes/campaigns.js';
import { automationRoutes } from './routes/automations.js';
import { templateRoutes, integrationRoutes, outboxRoutes, statsRoutes } from './routes/misc.js';
import { trackingRoutes } from './routes/tracking.js';
import { libraryRoutes, publicUploadRoutes } from './routes/library.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions {
  db: DatabaseSync;
  config: AppConfig;
  provider: EmailProvider;
  kickWorker?: () => void;
  logger?: boolean;
}

/**
 * Shopify routes may be registered by the module either relative to the root
 * (`/integrations/shopify/...`, `/webhooks/shopify`) or with the full API prefix.
 * We record every static route containing "shopify" and, at request time, map
 * `/api/v1/<path>` ⇄ `/<path>` onto whichever variant actually exists, so both
 * spellings work for clients (web, Shopify webhooks).
 */
function createShopifyUrlRewriter() {
  const routes = new Set<string>();
  return {
    track(url: string) {
      if (/shopify/i.test(url) && !url.includes(':') && !url.includes('*')) routes.add(url.replace(/\/+$/, '') || '/');
    },
    rewrite(rawUrl: string): string {
      if (!routes.size || !/shopify/i.test(rawUrl)) return rawUrl;
      const q = rawUrl.indexOf('?');
      const path = (q === -1 ? rawUrl : rawUrl.slice(0, q)).replace(/\/+$/, '') || '/';
      const query = q === -1 ? '' : rawUrl.slice(q);
      if (routes.has(path)) return rawUrl;
      const candidates = path.startsWith(`${API_PREFIX}/`) ? [path.slice(API_PREFIX.length)] : [`${API_PREFIX}${path}`];
      const match = candidates.find((c) => routes.has(c));
      return match ? match + query : rawUrl;
    },
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, config, provider } = options;
  const shopifyUrls = createShopifyUrlRewriter();

  const app = Fastify({
    logger: options.logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false,
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
    rewriteUrl: (req) => shopifyUrls.rewrite(req.url ?? '/'),
  });
  app.addHook('onRoute', (route) => shopifyUrls.track(route.url));

  app.decorateRequest('accountId', '');
  app.decorateRequest('rawBody', undefined);

  // JSON parser that keeps the raw body (needed for webhook HMAC verification).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(/^application\/(.+\+)?json/i, { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    if (raw.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      const err = new HttpError(400, 'Corps JSON invalide');
      done(err, undefined);
    }
  });
  // Form posts (RFC 8058 one-click unsubscribe, simple HTML forms).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    done(null, Object.fromEntries(new URLSearchParams(raw)));
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const normalized = origin.replace(/\/+$/, '');
      const allowed =
        config.webUrls.includes(normalized) ||
        (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized));
      cb(null, allowed);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  });

  app.setErrorHandler((error: FastifyError | HttpError | ZodError | Error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ error: formatZodError(error) });
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Erreur interne du serveur' });
    }
    return reply.code(status).send({ error: error.message || 'Requête invalide' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route introuvable : ${request.method} ${request.url.split('?')[0]}` });
  });

  const requireAuth = makeRequireAuth(db);
  const deps: Deps = { db, config, provider, requireAuth, kickWorker: options.kickWorker ?? (() => {}) };

  // Public routes: tracking, health.
  await app.register(async (scope) => trackingRoutes(scope, deps));
  await app.register(async (scope) => publicUploadRoutes(scope));

  // REST API.
  await app.register(
    async (api) => {
      await api.register(async (pub) => authRoutes(pub, deps));
      await api.register(async (priv) => {
        priv.addHook('preHandler', requireAuth);
        await accountRoutes(priv, deps);
        await apiKeyRoutes(priv, deps);
        await contactRoutes(priv, deps);
        await segmentRoutes(priv, deps);
        await campaignRoutes(priv, deps);
        await automationRoutes(priv, deps);
        await statsRoutes(priv, deps);
        await templateRoutes(priv);
        await outboxRoutes(priv, deps);
        await integrationRoutes(priv, deps);
        await libraryRoutes(priv, deps);
      });
    },
    { prefix: API_PREFIX },
  );

  // Integration modules.
  const ctx: IntegrationContext = {
    db,
    requireAuth,
    upsertContact: (accountId, input) => {
      const { contact, created } = upsertContact(db, accountId, input);
      return { contact, created };
    },
    recordEvent: (accountId, contactId, type, data) => {
      recordEvent(db, accountId, contactId, type, data ?? {});
    },
    fireTrigger: (accountId, contactId, trigger, data) => {
      fireTrigger(db, accountId, contactId, trigger, data ?? {});
      deps.kickWorker();
    },
    config: {
      publicUrl: config.publicUrl,
      shopifyApiKey: config.shopifyApiKey,
      shopifyApiSecret: config.shopifyApiSecret,
    },
  };
  await registerShopify(app, ctx);

  return app;
}

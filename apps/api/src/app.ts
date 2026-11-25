import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabaseSync } from './db.js';
import type { Deps } from './deps.js';
import type { IntegrationContext } from './integrations/context.js';
import { registerShopify } from './integrations/shopify/index.js';
import { HttpError, formatZodError } from './lib/http.js';
import { als, langFromHeader, t, withLang } from './i18n.js';
import { makeMarkApiKeyUsed, makeRequireAuth } from './services/auth.js';
import { fireTrigger } from './services/automations.js';
import { recordEvent, upsertContact } from './services/contacts.js';
import type { EmailProvider } from './services/mailer.js';
import { accountRoutes, authRoutes } from './routes/auth.js';
import { accountDeletionRoutes, invitationRoutes, teamRoutes } from './routes/team.js';
import { sendingDomainRoutes } from './routes/sendingDomain.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { mtaRoutes } from './routes/mta.js';
import { contactRoutes } from './routes/contacts.js';
import { segmentRoutes } from './routes/segments.js';
import { campaignRoutes } from './routes/campaigns.js';
import { automationRoutes } from './routes/automations.js';
import { templateRoutes, integrationRoutes, outboxRoutes, statsRoutes } from './routes/misc.js';
import { trackingRoutes } from './routes/tracking.js';
import { libraryRoutes, publicUploadRoutes } from './routes/library.js';
import { pushAppRoutes, pushRoutes } from './routes/push.js';
import { inboundRoutes, inboundSettingsRoutes } from './routes/inbound.js';
import { connectRoutes, publicConnectRoutes } from './routes/connect.js';
import { adminRoutes } from './routes/admin.js';

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
    // Hop count, not `true`: otherwise any client spoofs its IP through X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < Number(process.env.TRUST_PROXY ?? 1),
    rewriteUrl: (req) => shopifyUrls.rewrite(req.url ?? '/'),
  });
  app.addHook('onRoute', (route) => shopifyUrls.track(route.url));
  // Every request runs in its own language context (web / mobile send `Accept-Language: fr|en`).
  app.addHook('onRequest', (request, _reply, done) => {
    als.run({ lang: langFromHeader(request.headers['accept-language']) }, done);
  });
  // Body parsing resumes from socket events, outside the context above: enter it again before validation.
  app.addHook('preValidation', (request, _reply, done) => {
    als.run({ lang: langFromHeader(request.headers['accept-language']) }, done);
  });

  app.decorateRequest('accountId', '');
  app.decorateRequest('userId', '');
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
      const lang = langFromHeader(request.headers['accept-language']);
      const err = new HttpError(400, withLang(lang, () => t('Corps JSON invalide', 'Invalid JSON body')));
      done(err, undefined);
    }
  });
  // Form posts (RFC 8058 one-click unsubscribe, simple HTML forms).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    done(null, Object.fromEntries(new URLSearchParams(raw)));
  });

  const corsBase = {
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  };
  await app.register(cors, {
    // Webhooks and the paste-in form are called from the merchant's own site: any origin, no cookies.
    delegator: (req, cb) => {
      if ((req.url ?? '').startsWith(`${API_PREFIX}/public/`)) return cb(null, { ...corsBase, origin: '*', credentials: false });
      cb(null, { ...corsBase, origin: appOrigin, credentials: true });
    },
  });
  /** The app itself: only the configured web URLs (and localhost in development). */
  function appOrigin(origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) {
    if (!origin) return cb(null, true);
    const normalized = origin.replace(/\/+$/, '');
    const allowed =
      config.webUrls.includes(normalized) ||
      (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized));
    cb(null, allowed);
  }

  app.setErrorHandler((error: FastifyError | HttpError | ZodError | Error, request, reply) =>
    // Errors can surface outside the request's async context (body parsing): re-enter it.
    withLang(langFromHeader(request.headers['accept-language']), () => {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
      if (error instanceof ZodError) return reply.code(400).send({ error: formatZodError(error) });
      const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      if (status >= 500) {
        request.log.error(error);
        return reply.code(500).send({ error: t('Erreur interne du serveur', 'Internal server error') });
      }
      return reply.code(status).send({ error: error.message || t('Requête invalide', 'Invalid request') });
    }),
  );

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: t(
        `Route introuvable : ${request.method} ${request.url.split('?')[0]}`,
        `Route not found: ${request.method} ${request.url.split('?')[0]}`,
      ),
    });
  });

  const requireAuth = makeRequireAuth(db);
  app.addHook('onResponse', makeMarkApiKeyUsed(db));
  const deps: Deps = { db, config, provider, requireAuth, kickWorker: options.kickWorker ?? (() => {}) };

  // Public routes: tracking, health.
  await app.register(async (scope) => trackingRoutes(scope, deps));
  await app.register(async (scope) => publicUploadRoutes(scope));
  // No-code sites: universal webhook + paste-in form (full /api/v1/public/... paths, any origin).
  await app.register(async (scope) => inboundRoutes(scope, deps));
  // « Connecter à Pingsell » : échange du code à usage unique contre une clé API (plugins WordPress, PrestaShop).
  await app.register(async (scope) => publicConnectRoutes(scope, deps));
  // Bounces and complaints forwarded by our own MTA (self-hosted sending).
  await app.register(async (scope) => mtaRoutes(scope, deps));

  // REST API.
  await app.register(
    async (api) => {
      await api.register(async (pub) => authRoutes(pub, deps));
      await api.register(async (pub) => invitationRoutes(pub, deps));
      await api.register(async (pub) => pushAppRoutes(pub, deps));
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
        await teamRoutes(priv, deps);
        await sendingDomainRoutes(priv, deps);
        await accountDeletionRoutes(priv, deps);
        await pushRoutes(priv, deps);
        await inboundSettingsRoutes(priv, deps);
        await connectRoutes(priv, deps);
        // « Administration » de la plateforme (PLATFORM_ADMIN_EMAILS) : invisible (404) pour les autres.
        await adminRoutes(priv, deps);
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
      shopifyBilling: config.shopifyBilling,
    },
  };
  await registerShopify(app, ctx);

  return app;
}

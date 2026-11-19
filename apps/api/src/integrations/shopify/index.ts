// Shopify integration module — mounted by core via registerShopify(app, ctx). See SPEC.md "Shopify".
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import type { IntegrationContext } from '../context.js';
import { ShopifyClient, ShopifyError, normalizeShopDomain, requestAccessToken } from './client.js';
import { fireCartAbandoned, processAbandonedCheckouts } from './checkouts.js';
import { cleanEmail, toNumber, upsertShopifyContact } from './contacts.js';
import { verifyOAuthHmac, verifyWebhookHmac } from './hmac.js';
import { buildInstallUrl, consumeState, createState } from './oauth.js';
import {
  clientFor,
  deleteIntegration,
  ensureShopifySchema,
  findContactByEmail,
  deletePendingInstall,
  getCredentials,
  getIntegration,
  getIntegrationsByShop,
  getPendingInstall,
  inSeconds,
  markWebhookProcessed,
  prunePendingInstalls,
  recordDataRequest,
  redactCustomer,
  redactShop,
  savePendingInstall,
  setAppCredentials,
  pruneWebhookLog,
  saveCredentials,
  saveIntegration,
  type CredentialsInput,
  toPublic,
  updateIntegration,
} from './store.js';
import { SyncInProgressError, isSyncRunning, runFullSync } from './sync.js';
import { SHOPIFY_SCOPES, type ShopifyConfig } from './types.js';
import { deleteWebhooks, dispatchWebhook, registerWebhooks } from './webhooks.js';
import { t, withLang, accountLang } from '../../i18n.js';

export { getShopifyRevenue, getCampaignAttributedRevenue } from './revenue.js';
export { processAbandonedCheckouts } from './checkouts.js';

const ABANDON_CHECK_INTERVAL_MS = 60_000;

interface ConnectBody {
  shop_domain?: unknown;
  /** Admin API access token of a (legacy) admin-created custom app: shpat_… */
  access_token?: unknown;
  /** Dev Dashboard app credentials (client credentials grant) — alternative to access_token. */
  client_id?: unknown;
  client_secret?: unknown;
  /** Optional API secret key of the custom app, used to verify webhook HMACs. */
  api_secret?: unknown;
}

interface SimulateBody {
  type?: unknown;
  email?: unknown;
  total?: unknown;
}

interface ShopInfo {
  name: string;
  email: string | null;
  myshopifyDomain: string;
  currencyCode: string | null;
}

// GraphQL only: new public apps may not use the REST Admin API (App Store requirement 2.2.4).
const SHOP_QUERY = /* GraphQL */ `
  query PingsellShop {
    shop { name email myshopifyDomain currencyCode }
    currentAppInstallation { accessScopes { handle } }
  }
`;

/** Reads request.accountId (declared by core) without depending on the declaration merge. */
function accountIdOf(request: FastifyRequest): string {
  const id = (request as FastifyRequest & { accountId?: string }).accountId;
  if (!id) throw new HttpError(401, t('Non authentifié', 'Not authenticated'));
  return id;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function sendError(reply: FastifyReply, err: unknown, request: FastifyRequest): FastifyReply {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  if (err instanceof SyncInProgressError) return reply.code(409).send({ error: err.message });
  if (err instanceof ShopifyError) {
    const code = err.status === 401 || err.status === 403 || err.status === 404 || err.status === 400 ? 400 : 502;
    return reply.code(code).send({ error: err.message });
  }
  request.log.error({ err }, 'Shopify : erreur inattendue');
  return reply.code(500).send({ error: t('Erreur interne de l’intégration Shopify', 'Internal Shopify integration error') });
}

const parseAuthMode = (row: { config: string | null }): string | undefined => {
  try {
    return (JSON.parse(row.config ?? '{}') as ShopifyConfig).auth_mode;
  } catch {
    return undefined;
  }
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function registerShopify(app: FastifyInstance, ctx: IntegrationContext): Promise<void> {
  ensureShopifySchema(ctx.db);

  // Core may mount us at the root or inside an /api/v1-prefixed plugin: support both.
  const base = app.prefix.startsWith('/api/v1') ? '' : '/api/v1';
  const webUrl = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const auth = { preHandler: ctx.requireAuth };
  setAppCredentials(ctx.config.shopifyApiKey, ctx.config.shopifyApiSecret);
  /** Where « Installer Pingsell sur Shopify » sends the merchant: the App Store listing once published. */
  const appInstallUrl = (process.env.SHOPIFY_APP_INSTALL_URL ?? '').trim() || null;

  /** Validates a token, stores the integration, registers webhooks and launches the initial sync. */
  async function establish(
    accountId: string,
    shop: string,
    accessToken: string,
    mode: NonNullable<ShopifyConfig['auth_mode']>,
    secrets: CredentialsInput,
    log: FastifyRequest['log'],
  ) {
    const probe = new ShopifyClient(shop, async () => accessToken);
    const probed = await probe.graphql<{ shop: ShopInfo; currentAppInstallation: { accessScopes: { handle: string }[] } | null }>(SHOP_QUERY);
    const info = probed.shop;
    const canonical = normalizeShopDomain(info.myshopifyDomain) ?? shop;
    const scopes: string[] | undefined = probed.currentAppInstallation?.accessScopes.map((s) => s.handle);
    if (scopes) {
      // write_* implies read_*.
      const missing = SHOPIFY_SCOPES.filter((s) => !scopes!.includes(s) && !scopes!.includes(s.replace('read_', 'write_')));
      if (missing.length) {
        throw new HttpError(400, t(`Autorisations manquantes sur l’application Shopify : ${missing.join(', ')}`, `Missing permissions on the Shopify app: ${missing.join(', ')}`));
      }
    }

    const config: ShopifyConfig = {
      auth_mode: mode,
      shop_name: info.name,
      shop_email: info.email ?? undefined,
      currency: info.currencyCode ?? undefined,
      scopes,
      webhooks: [],
      webhooks_error: null,
      error: null,
    };
    saveIntegration(ctx.db, accountId, canonical, accessToken, config);
    saveCredentials(ctx.db, accountId, secrets);

    const client = clientFor(ctx.db, accountId, canonical);
    const hooks = await registerWebhooks(client, ctx.config.publicUrl).catch((err: Error) => ({
      webhooks: [],
      error: t(`Webhooks non enregistrés : ${err.message}`, `Webhooks not registered: ${err.message}`),
    }));
    updateIntegration(ctx.db, accountId, { webhooks: hooks.webhooks, webhooks_error: hooks.error });
    if (hooks.error) log.warn({ shop: canonical }, hooks.error);

    void runFullSync(ctx, accountId, client).catch((err: Error) => {
      log.warn({ err, shop: canonical }, 'Shopify : la synchronisation initiale a échoué');
    });

    const row = getIntegration(ctx.db, accountId)!;
    return { integration: toPublic(row), shop: { name: info.name, domain: canonical, email: info.email, currency: info.currencyCode } };
  }

  // ---------------------------------------------------------------- status
  app.get(`${base}/integrations/shopify`, auth, async (request, reply) => {
    try {
      const row = getIntegration(ctx.db, accountIdOf(request));
      return {
        integration: row ? toPublic(row) : null,
        oauth_available: Boolean(ctx.config.shopifyApiKey && ctx.config.shopifyApiSecret),
        app_install_url: ctx.config.shopifyApiKey && ctx.config.shopifyApiSecret ? appInstallUrl : null,
        sync_running: row ? isSyncRunning(row.account_id) : false,
      };
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- connect (custom app token)
  app.post<{ Body: ConnectBody }>(`${base}/integrations/shopify/connect`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const body = request.body ?? {};
      const shop = normalizeShopDomain(body.shop_domain);
      if (!shop) throw new HttpError(400, t('Domaine de boutique invalide (attendu : ma-boutique.myshopify.com)', 'Invalid store domain (expected: my-store.myshopify.com)'));

      const accessToken = str(body.access_token);
      const clientId = str(body.client_id);
      const clientSecret = str(body.client_secret);
      let result;
      if (accessToken) {
        result = await establish(accountId, shop, accessToken, 'custom_app', { webhook_secret: str(body.api_secret) }, request.log);
      } else if (clientId && clientSecret) {
        const token = await requestAccessToken(shop, { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
        result = await establish(
          accountId,
          shop,
          token.access_token,
          'client_credentials',
          {
            client_id: clientId,
            client_secret: clientSecret,
            webhook_secret: clientSecret,
            token_expires_at: new Date(Date.now() + (token.expires_in ?? 86_399) * 1000).toISOString(),
          },
          request.log,
        );
      } else {
        throw new HttpError(400, t('Fournissez access_token (jeton Admin API) ou client_id + client_secret', 'Provide access_token (Admin API token) or client_id + client_secret'));
      }
      return reply.code(201).send(result);
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- OAuth (public app)
  /** Browsers cannot send a Bearer header on a redirect: accept ?token= as a fallback. */
  const tokenFromQuery: onRequestHookHandler = (request, _reply, done) => {
    const token = (request.query as { token?: unknown }).token;
    if (!request.headers.authorization && typeof token === 'string' && token) {
      request.headers.authorization = `Bearer ${token}`;
    }
    done();
  };

  app.get<{ Querystring: { shop?: string; format?: string; token?: string } }>(
    `${base}/integrations/shopify/install`,
    { onRequest: tokenFromQuery, preHandler: ctx.requireAuth },
    async (request, reply) => {
      try {
        const accountId = accountIdOf(request);
        const { shopifyApiKey, shopifyApiSecret } = ctx.config;
        if (!shopifyApiKey || !shopifyApiSecret) {
          throw new HttpError(400, t('OAuth Shopify non configuré : définissez SHOPIFY_API_KEY et SHOPIFY_API_SECRET', 'Shopify OAuth isn’t configured: set SHOPIFY_API_KEY and SHOPIFY_API_SECRET'));
        }
        const shop = normalizeShopDomain(request.query.shop);
        if (!shop) throw new HttpError(400, t('Paramètre shop invalide (attendu : ma-boutique.myshopify.com)', 'Invalid shop parameter (expected: my-store.myshopify.com)'));
        const url = buildInstallUrl(shop, shopifyApiKey, ctx.config.publicUrl, createState(accountId, shop));
        const wantsJson = request.query.format === 'json' || (request.headers.accept ?? '').includes('application/json');
        return wantsJson ? { url } : reply.redirect(url);
      } catch (err) {
        return sendError(reply, err, request);
      }
    },
  );

  /** Expiring offline token (mandatory for public apps): 1 h access token + 90-day rotating refresh token. */
  const oauthSecrets = (token: { expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }): CredentialsInput => ({
    token_expires_at: token.refresh_token ? inSeconds(token.expires_in ?? 3600) : null,
    refresh_token: token.refresh_token ?? null,
    refresh_expires_at: token.refresh_token ? inSeconds(token.refresh_token_expires_in) : null,
  });

  // App URL (application_url): where Shopify sends the merchant after « Installer » on the App Store and
  // every time they open Pingsell from their Shopify admin. OAuth runs straight away (requirements 2.3.1–2.3.4).
  app.get<{ Querystring: Record<string, string> }>(`${base}/integrations/shopify/app`, async (request, reply) => {
    const { shopifyApiKey, shopifyApiSecret } = ctx.config;
    const query = request.query;
    if (!shopifyApiKey || !shopifyApiSecret) return reply.redirect(`${webUrl}/integrations?outil=shopify`);
    const shop = normalizeShopDomain(query.shop);
    if (!shop || !verifyOAuthHmac(query, shopifyApiSecret)) {
      return reply.code(400).type('text/plain; charset=utf-8').send(t('Lien Shopify invalide : ouvrez Pingsell depuis votre admin Shopify.', 'Invalid Shopify link: open Pingsell from your Shopify admin.'));
    }
    // Already installed and working: straight to the app UI.
    const live = getIntegrationsByShop(ctx.db, shop).filter((r) => r.status === 'connected' && r.access_token && parseAuthMode(r) === 'oauth');
    if (live.length > 0) return reply.redirect(`${webUrl}/integrations?outil=shopify`);
    return reply.redirect(buildInstallUrl(shop, shopifyApiKey, ctx.config.publicUrl, createState(null, shop)));
  });

  app.get<{ Querystring: Record<string, string> }>(`${base}/integrations/shopify/callback`, async (request, reply) => {
    const fail = (message: string) =>
      reply.redirect(`${webUrl}/integrations?shopify=error&message=${encodeURIComponent(message)}`);
    try {
      const { shopifyApiKey, shopifyApiSecret } = ctx.config;
      if (!shopifyApiKey || !shopifyApiSecret) return fail(t('OAuth Shopify non configuré', 'Shopify OAuth isn’t configured'));
      const query = request.query;
      if (!verifyOAuthHmac(query, shopifyApiSecret)) return fail(t('Signature Shopify invalide', 'Invalid Shopify signature'));
      const shop = normalizeShopDomain(query.shop);
      if (!shop) return fail(t('Boutique invalide', 'Invalid store'));
      const install = consumeState(query.state, shop);
      if (!install) return fail(t('Session d’installation expirée, veuillez recommencer', 'Installation session expired, please start again'));
      if (!query.code) return fail(t('Code d’autorisation manquant', 'Missing authorization code'));

      const token = await requestAccessToken(shop, {
        client_id: shopifyApiKey,
        client_secret: shopifyApiSecret,
        code: query.code,
        expiring: '1',
      });

      // Started from Pingsell (logged-in merchant) → that account.
      // Started from Shopify → the account this store was connected to before (reinstall), if there is exactly one.
      let accountId = install.accountId;
      if (!accountId) {
        const known = [...new Set(getIntegrationsByShop(ctx.db, shop).map((r) => r.account_id))];
        if (known.length === 1) accountId = known[0]!;
      }
      if (accountId) {
        await establish(accountId, shop, token.access_token, 'oauth', oauthSecrets(token), request.log);
        return reply.redirect(`${webUrl}/integrations?shopify=connected`);
      }

      // New merchant: keep the token for 24 h and let them log in or sign up, then attach the store.
      let shopName: string | null = null;
      try {
        const probe = new ShopifyClient(shop, async () => token.access_token);
        shopName = (await probe.graphql<{ shop: { name: string } }>('query { shop { name } }')).shop.name;
      } catch {
        shopName = null;
      }
      const secrets = oauthSecrets(token);
      const claim = savePendingInstall(ctx.db, {
        shop_domain: shop,
        shop_name: shopName,
        access_token: token.access_token,
        refresh_token: secrets.refresh_token ?? null,
        token_expires_at: secrets.token_expires_at ?? null,
        refresh_expires_at: secrets.refresh_expires_at ?? null,
      });
      return reply.redirect(`${webUrl}/shopify/connecter?claim=${encodeURIComponent(claim)}`);
    } catch (err) {
      request.log.warn({ err }, 'Shopify : échec du callback OAuth');
      return fail(err instanceof Error ? err.message : t('Échec de la connexion Shopify', 'Shopify connection failed'));
    }
  });

  // ---------------------------------------------------------------- attach a store installed from Shopify
  app.get<{ Querystring: { claim?: string } }>(`${base}/integrations/shopify/pending`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const pendingRow = getPendingInstall(ctx.db, request.query.claim);
      if (!pendingRow) throw new HttpError(404, t('Ce lien a expiré. Relancez l’installation depuis Shopify.', 'This link has expired. Start the install again from Shopify.'));
      const current = getIntegration(ctx.db, accountId);
      return {
        shop_domain: pendingRow.shop_domain,
        shop_name: pendingRow.shop_name,
        current_shop: current && current.shop_domain !== pendingRow.shop_domain ? current.shop_domain : null,
      };
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  app.post<{ Body: { claim?: unknown } }>(`${base}/integrations/shopify/claim`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const pendingRow = getPendingInstall(ctx.db, request.body?.claim);
      if (!pendingRow) throw new HttpError(404, t('Ce lien a expiré. Relancez l’installation depuis Shopify.', 'This link has expired. Start the install again from Shopify.'));
      // Single use, even if the connection below fails.
      deletePendingInstall(ctx.db, pendingRow.claim);
      const previous = getIntegration(ctx.db, accountId);
      if (previous && previous.shop_domain !== pendingRow.shop_domain && previous.access_token && previous.status === 'connected') {
        await deleteWebhooks(clientFor(ctx.db, accountId, previous.shop_domain)).catch(() => undefined);
      }
      const result = await establish(
        accountId,
        pendingRow.shop_domain,
        pendingRow.access_token,
        'oauth',
        { token_expires_at: pendingRow.token_expires_at, refresh_token: pendingRow.refresh_token, refresh_expires_at: pendingRow.refresh_expires_at },
        request.log,
      );
      return reply.code(201).send(result);
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- manual sync
  app.post(`${base}/integrations/shopify/sync`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const row = getIntegration(ctx.db, accountId);
      if (!row || row.status !== 'connected' || !row.access_token) throw new HttpError(400, t('Aucune boutique Shopify connectée', 'No Shopify store connected'));
      return await runFullSync(ctx, accountId, clientFor(ctx.db, accountId, row.shop_domain));
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- disconnect
  app.delete(`${base}/integrations/shopify`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const row = getIntegration(ctx.db, accountId);
      if (!row) throw new HttpError(404, t('Aucune intégration Shopify', 'No Shopify integration'));
      if (row.access_token && row.status === 'connected') {
        await deleteWebhooks(clientFor(ctx.db, accountId, row.shop_domain)).catch((err: Error) =>
          request.log.warn({ err }, 'Shopify : suppression des webhooks impossible'),
        );
      }
      deleteIntegration(ctx.db, accountId);
      return { ok: true };
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- dev simulator
  app.post<{ Body: SimulateBody }>(`${base}/integrations/shopify/simulate`, auth, async (request, reply) => {
    try {
      const accountId = accountIdOf(request);
      const body = request.body ?? {};
      const type = body.type;
      if (type !== 'order' && type !== 'cart_abandoned' && type !== 'order_fulfilled') {
        throw new HttpError(400, t("type doit valoir 'order', 'order_fulfilled' ou 'cart_abandoned'", "type must be 'order', 'order_fulfilled' or 'cart_abandoned'"));
      }
      const email = cleanEmail(body.email);
      if (!email) throw new HttpError(400, t('Adresse email invalide', 'Invalid email address'));
      const total = body.total !== undefined ? toNumber(body.total) : Math.round((20 + Math.random() * 130) * 100) / 100;
      const currency = 'EUR';
      const existing = findContactByEmail(ctx.db, accountId, email);
      const marketing_state = existing ? null : 'subscribed'; // dev helper: new contacts are opted in

      if (type === 'order_fulfilled') {
        const { contactId, created } = upsertShopifyContact(ctx, accountId, { email, marketing_state });
        const data = {
          order_id: `sim_${randomUUID()}`,
          order_name: `#SIM${Math.floor(1000 + Math.random() * 9000)}`,
          tracking_number: `6A${Math.floor(1e9 + Math.random() * 9e9)}`,
          tracking_url: 'https://www.laposte.fr/outils/suivre-vos-envois',
          carrier: 'Colissimo',
          source: 'simulation',
        };
        ctx.recordEvent(accountId, contactId, 'order_fulfilled', data);
        ctx.fireTrigger(accountId, contactId, 'order_fulfilled', data);
        return { ok: true, type, contact_id: contactId, created, data };
      }

      if (type === 'order') {
        const { contactId, created } = upsertShopifyContact(ctx, accountId, {
          email,
          marketing_state,
          total_spent: Math.round(((existing?.total_spent ?? 0) + total) * 100) / 100,
          orders_count: (existing?.orders_count ?? 0) + 1,
          last_order_at: new Date().toISOString(),
        });
        const data = {
          order_id: `sim_${randomUUID()}`,
          order_name: `#SIM${Math.floor(1000 + Math.random() * 9000)}`,
          total,
          currency,
          line_items: [{ title: t('Produit de démonstration', 'Demo product'), quantity: 1, price: total }],
          source: 'simulation',
        };
        ctx.recordEvent(accountId, contactId, 'order', data);
        ctx.fireTrigger(accountId, contactId, 'order_created', data);
        return { ok: true, type, contact_id: contactId, created, data };
      }

      const { contactId, created } = upsertShopifyContact(ctx, accountId, { email, marketing_state });
      const checkoutId = `sim_${randomUUID()}`;
      const now = new Date().toISOString();
      const lineItems = [{ title: t('Produit de démonstration', 'Demo product'), quantity: 1, price: total }];
      ctx.db
        .prepare(
          `INSERT INTO shopify_checkouts (id, account_id, shop_domain, checkout_id, email, total, currency, line_items, status, created_at, updated_at, abandoned_at)
           VALUES (?, ?, 'simulation', ?, ?, ?, ?, ?, 'abandoned', ?, ?, ?)`,
        )
        .run(randomUUID(), accountId, checkoutId, email, total, currency, JSON.stringify(lineItems), now, now, now);
      const data = { checkout_id: checkoutId, total, currency, checkout_url: null, line_items: lineItems, source: 'simulation' };
      fireCartAbandoned(ctx, accountId, contactId, data);
      return { ok: true, type, contact_id: contactId, created, data };
    } catch (err) {
      return sendError(reply, err, request);
    }
  });

  // ---------------------------------------------------------------- webhooks (public, HMAC)
  await app.register(async (scope) => {
    // Own JSON parser in this encapsulated scope: HMAC must be computed over the exact raw bytes.
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (request, body, done) => {
      (request as FastifyRequest & { rawBody?: string }).rawBody = body.toString('utf8');
      try {
        done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
      } catch {
        done(null, {}); // invalid JSON still reaches the handler, which rejects on HMAC first
      }
    });

    scope.post(`${base}/webhooks/shopify`, async (request, reply) => {
      const raw = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
      const header = (name: string) => {
        const v = request.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const hmac = header('x-shopify-hmac-sha256');
      const topic = header('x-shopify-topic') ?? '';
      const shop = normalizeShopDomain(header('x-shopify-shop-domain'));
      const webhookId = header('x-shopify-webhook-id') ?? header('x-shopify-event-id');
      if (!hmac || !shop || !topic) return reply.code(401).send({ error: t('Webhook Shopify non signé', 'Unsigned Shopify webhook') });

      const integrations = getIntegrationsByShop(ctx.db, shop);
      const globalSecret = ctx.config.shopifyApiSecret;
      const globalOk = Boolean(globalSecret) && verifyWebhookHmac(raw, hmac, globalSecret!);
      const targets = globalOk
        ? integrations
        : integrations.filter((row) => {
            const secret = getCredentials(ctx.db, row.account_id)?.webhook_secret;
            return Boolean(secret) && verifyWebhookHmac(raw, hmac, secret!);
          });
      if (!globalOk && targets.length === 0) return reply.code(401).send({ error: t('Signature HMAC invalide', 'Invalid HMAC signature') });

      // Mandatory privacy (compliance) topics.
      if (topic === 'customers/data_request' || topic === 'customers/redact' || topic === 'shop/redact') {
        const body = (request.body && typeof request.body === 'object' ? request.body : {}) as {
          customer?: { id?: unknown; email?: unknown };
          orders_requested?: unknown;
          orders_to_redact?: unknown;
        };
        const email = cleanEmail(body.customer?.email) ?? null;
        const customerId = body.customer?.id !== undefined && body.customer?.id !== null ? String(body.customer.id) : null;
        const accounts = [...new Set(targets.map((r) => r.account_id))];
        if (topic === 'customers/redact') {
          for (const accountId of accounts) redactCustomer(ctx.db, accountId, shop, email, customerId);
        } else if (topic === 'customers/data_request') {
          const orders = Array.isArray(body.orders_requested) ? body.orders_requested : [];
          for (const accountId of accounts) recordDataRequest(ctx.db, accountId, shop, email, customerId, orders);
        } else {
          redactShop(ctx.db, shop);
        }
        request.log.info({ shop, topic, accounts: accounts.length }, 'Shopify : demande de confidentialité traitée');
        return { ok: true };
      }
      if (webhookId && !markWebhookProcessed(ctx.db, webhookId, topic)) {
        return { ok: true, duplicate: true };
      }

      const payload = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
      try {
        for (const row of targets) {
          if (row.status !== 'connected' && topic !== 'app/uninstalled') continue;
          // Shopify sends no language: texts stored for the merchant follow the account's language.
          withLang(accountLang(ctx.db, row.account_id), () => dispatchWebhook(ctx, row.account_id, shop, topic, payload));
        }
      } catch (err) {
        // Let Shopify retry: forget the delivery id.
        if (webhookId) ctx.db.prepare('DELETE FROM shopify_webhook_log WHERE webhook_id = ?').run(webhookId);
        request.log.error({ err, shop, topic }, 'Shopify : échec du traitement du webhook');
        return reply.code(500).send({ error: t('Échec du traitement du webhook', 'Webhook processing failed') });
      }
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- abandoned-cart checker
  const tick = () => {
    try {
      processAbandonedCheckouts(ctx, app.log);
      pruneWebhookLog(ctx.db);
      prunePendingInstalls(ctx.db);
    } catch (err) {
      app.log.error({ err }, 'Shopify : échec du contrôle des paniers abandonnés');
    }
  };
  const interval = setInterval(tick, ABANDON_CHECK_INTERVAL_MS);
  interval.unref();
  const firstRun = setTimeout(tick, 5_000);
  firstRun.unref();
  app.addHook('onClose', async () => {
    clearInterval(interval);
    clearTimeout(firstRun);
  });
}

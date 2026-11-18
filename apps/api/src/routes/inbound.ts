import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { run } from '../db.js';
import type { Deps } from '../deps.js';
import { HttpError, badRequest, notFound, parse } from '../lib/http.js';
import { t } from '../i18n.js';
import { normalizeEventName } from '../services/automations.js';
import { BUILTIN_EVENTS, createIngest } from '../services/ingest.js';
import { detectPayload, ensureHook, findHook, hookOrigins, markHookUsed, originAllowed, rotateHook, siteHost, type InboundHook } from '../services/inbound.js';
import { FORM_SCRIPT } from '../services/formScript.js';

const PREFIX = '/api/v1';

/** Small in-memory limiter: enough to stop a bot hammering a public form (one API process). */
function limiter(max: number, windowMs: number, cap = 50_000) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, nowMs = Date.now()) => {
    if (hits.size >= cap) {
      for (const [k, v] of hits) if (v.reset < nowMs) hits.delete(k);
      // Still full (a flood of distinct IPs): forget the oldest entries rather than grow forever.
      for (const k of hits.keys()) {
        if (hits.size < cap * 0.9) break;
        hits.delete(k);
      }
    }
    const h = hits.get(key);
    if (!h || h.reset < nowMs) {
      hits.set(key, { n: 1, reset: nowMs + windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

const originsSchema = z.object({ allowed_origins: z.array(z.string().trim().max(200)).max(20) });
const FORM_BODY_LIMIT = 16 * 1024;
const FORM_MAX_FIELDS = 30;
/** Fields a visitor's browser may never set: they would change consent, links or sending rules. */
const FORM_FORBIDDEN = new Set(['transactional', 'status', 'url', 'checkout_url', 'items', 'data', 'tracking_url', 'tracking_number', 'carrier']);
const kindParam = z.enum(['webhook', 'form']);

/** Text fields of a multipart body (files are skipped): enough for form tools' webhooks. */
export function parseMultipart(body: string, contentType: string): Record<string, string> {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const out: Record<string, string> = {};
  if (!boundary) return out;
  for (const part of body.split(`--${boundary[1] ?? boundary[2]}`).slice(1, 200)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const head = part.slice(0, split);
    const name = head.match(/name="([^"]*)"/i)?.[1];
    if (!name || /filename=/i.test(head) || name in out) continue;
    out[name] = part.slice(split + 4).replace(/\r\n$/, '');
  }
  return out;
}

const clip = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v);

export async function inboundRoutes(app: FastifyInstance, { db, config, kickWorker }: Deps) {
  const { ingestEvent } = createIngest(db);

  // Some tools post JSON as text/plain (sendBeacon, no-code builders) or multipart (Jotform).
  // Scoped to this plugin: the MTA has its own text/plain parser.
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_request, body, done) => {
    const raw = String(body).trim();
    try {
      done(null, raw.startsWith('{') || raw.startsWith('[') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)));
    } catch {
      done(null, {});
    }
  });
  app.addContentTypeParser('multipart/form-data', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (request, body, done) => {
    done(null, parseMultipart(String(body), String(request.headers['content-type'] ?? '')));
  });
  const base = `${config.publicUrl}${PREFIX}/public`;
  const perIp = limiter(Number(process.env.FORM_RATE_PER_IP ?? 8), 10 * 60_000);
  const perKey = limiter(Number(process.env.FORM_RATE_PER_KEY ?? 600), 60 * 60_000);
  const perHook = limiter(Number(process.env.WEBHOOK_RATE ?? 20_000), 60 * 60_000);

  /** Runs each detected event; never throws, so the platform does not retry or disable the webhook. */
  const runEvents = (hook: InboundHook, events: Record<string, unknown>[]) =>
    events.map((e) => {
      try {
        const r = ingestEvent(hook.account_id, e);
        return { event: String(r.body.event), ok: true, ...(r.body.skipped ? { skipped: true } : {}), ...(r.body.duplicate ? { duplicate: true } : {}) };
      } catch (err) {
        const message = err instanceof HttpError || err instanceof Error ? err.message : String(err);
        return { event: String(e.event ?? ''), ok: false, error: message.slice(0, 300) };
      }
    });

  // ─── Universal webhook: WooCommerce, Webflow, Framer, Wix, Tally, Typeform, any tool that posts JSON ───
  app.post<{ Params: { token: string }; Querystring: { event?: string; tags?: string } }>(`${PREFIX}/public/hooks/:token`, async (request, reply) => {
    const hook = findHook(db, 'webhook', request.params.token);
    if (!hook) throw notFound(t('Adresse de webhook inconnue : copiez-la à nouveau depuis Pingsell › Intégrations', 'Unknown webhook address: copy it again from Pingsell › Integrations'));
    if (!perHook(hook.token)) throw new HttpError(429, t('Trop de requêtes, réessayez dans un instant', 'Too many requests, try again shortly'));
    const detected = detectPayload(request.headers, request.body, request.query);
    if (!detected.events.length) {
      const reason = detected.reason ?? (detected.ping ? 'test' : 'no_email');
      const result = { received: 0, ignored: true, reason };
      markHookUsed(db, hook, detected.source, result);
      return reply.code(200).send({
        ok: true,
        source: detected.source,
        received: 0,
        reason,
        message:
          reason === 'ignored_status'
            ? t('Statut ignoré (annulée, remboursée…) : rien à faire.', 'Ignored status (cancelled, refunded…): nothing to do.')
            : detected.ping
              ? t('Webhook Pingsell prêt.', 'Pingsell webhook ready.')
              : t('Aucune adresse email trouvée dans les données : rien à faire.', 'No email address found in the data: nothing to do.'),
      });
    }
    const results = runEvents(hook, detected.events.slice(0, 5));
    markHookUsed(db, hook, detected.source, { received: results.length, results });
    kickWorker();
    return reply.code(200).send({ ok: results.every((r) => r.ok), source: detected.source, received: results.length, results });
  });

  // ─── Paste-in signup form + browser snippet (order-confirmation pages) ───
  const formHook = (request: FastifyRequest<{ Params: { key: string } }>) => {
    const hook = findHook(db, 'form', request.params.key);
    if (!hook) throw notFound(t('Clé de formulaire inconnue', 'Unknown form key'));
    return hook;
  };

  app.get<{ Params: { key: string } }>(`${PREFIX}/public/forms/:key/embed.js`, async (request, reply) => {
    const hook = formHook(request);
    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    return FORM_SCRIPT.replace('__PINGSELL_ENDPOINT__', JSON.stringify(`${base}/forms/${hook.token}`));
  });

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

  /** Only redirect to the merchant's own site: never an open redirect. */
  const safeRedirect = (hook: InboundHook, origin: string | undefined, redirect: unknown) => {
    if (typeof redirect !== 'string') return undefined;
    let url: URL;
    try {
      url = new URL(redirect);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const host = siteHost(url.href);
    const allowed = hookOrigins(hook);
    const from = origin ? siteHost(origin) : '';
    const okHost = allowed.length ? allowed.some((d) => host === d || host.endsWith(`.${d}`)) : !!from && (host === from || host.endsWith(`.${from}`));
    return okHost ? url.href : undefined;
  };

  const page = (reply: FastifyReply, request: FastifyRequest, code: number, message: string) => {
    const back = typeof request.headers.referer === 'string' && /^https?:\/\//i.test(request.headers.referer) ? request.headers.referer : '';
    return reply
      .code(code)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(message)}</title>` +
          `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF2F8;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B214A">` +
          `<div style="max-width:420px;margin:24px;padding:36px;border-radius:24px;background:#fff;text-align:center"><p style="font-size:20px;font-weight:700;margin:0 0 16px">${esc(message)}</p>` +
          (back ? `<a href="${esc(back)}" style="color:#145CFF">${esc(t('Revenir au site', 'Back to the site'))}</a>` : '') +
          `</div></body></html>`,
      );
  };

  app.post<{ Params: { key: string } }>(`${PREFIX}/public/forms/:key`, { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
    const hook = formHook(request);
    const html = !request.headers['content-type']?.includes('json') && String(request.headers.accept ?? '').includes('text/html');
    const raw = (request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {}) as Record<string, unknown>;
    const origin = (request.headers.origin as string | undefined) ?? (request.headers.referer as string | undefined);
    const success = t('Merci, c’est noté !', 'Thanks, you’re in!');
    const ok = () => {
      const target = html ? safeRedirect(hook, origin, raw._redirect) : undefined;
      if (target) return reply.code(303).header('Location', target).send();
      return html ? page(reply, request, 200, success) : reply.code(200).send({ ok: true, message: success });
    };
    // The no-JavaScript path shows a readable page instead of raw JSON.
    const fail = (code: number, message: string) => {
      if (html) return page(reply, request, code, message);
      throw new HttpError(code, message);
    };

    // Bots fill the hidden field or submit instantly: pretend it worked.
    if (typeof raw._hp === 'string' && raw._hp.trim()) return ok();
    if (raw._t !== undefined && raw._t !== '' && Number(raw._t) >= 0 && Number(raw._t) < 1200) return ok();

    if (!originAllowed(hook, origin)) {
      return fail(403, t('Ce site n’est pas autorisé à utiliser ce formulaire (Pingsell › Intégrations › Domaines autorisés)', 'This site is not allowed to use this form (Pingsell › Integrations › Allowed domains)'));
    }
    // Per form first (keyed by the key itself, so rotating it starts afresh), then per visitor.
    if (!perKey(hook.token)) return fail(429, t('Ce formulaire reçoit trop d’envois, réessayez plus tard', 'This form is receiving too many submissions, try again later'));
    if (!perIp(`${hook.token}:${request.ip}`)) return fail(429, t('Trop d’envois depuis cette connexion, réessayez dans quelques minutes', 'Too many submissions from this connection, try again in a few minutes'));

    const pageUrl = clip(raw._page ?? request.headers.referer, 500);
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Object.keys(fields).length >= FORM_MAX_FIELDS) break;
      if (k.startsWith('_') || FORM_FORBIDDEN.has(k.toLowerCase())) continue;
      if (v === null || !['string', 'number', 'boolean'].includes(typeof v)) continue;
      fields[k.slice(0, 64)] = clip(v, 1000);
    }
    const tags = Array.isArray(raw._tags) ? raw._tags.join(',') : typeof raw._tags === 'string' ? raw._tags : undefined;
    const detected = detectPayload({}, fields, { event: typeof raw._event === 'string' ? raw._event : undefined, tags });
    const event = detected.events[0];
    if (!event) return fail(400, t('Indiquez une adresse email valide.', 'Enter a valid email address.'));

    const kind = BUILTIN_EVENTS[normalizeEventName(event.event)];
    // A browser can't be trusted with shipments or carts (anyone could rewrite someone's checkout link).
    if (kind === 'shipped') return fail(400, t('Les expéditions doivent venir du serveur (webhook ou API)', 'Shipments must come from the server (webhook or API)'));
    if (kind === 'cart') return fail(400, t('Les paniers doivent venir du serveur (extension, webhook ou API)', 'Carts must come from the server (plugin, webhook or API)'));
    // Orders from a browser only once the merchant has locked the form to their own domains.
    if (kind === 'order' && !hookOrigins(hook).length) {
      return fail(403, t('Pour suivre les commandes depuis le navigateur, indiquez d’abord vos domaines autorisés (Pingsell › Intégrations)', 'To track orders from the browser, first set your allowed domains (Pingsell › Integrations)'));
    }
    for (const k of FORM_FORBIDDEN) delete event[k];
    if (pageUrl) event.data = { page: pageUrl };

    try {
      const result = ingestEvent(hook.account_id, event, { untrusted: true });
      markHookUsed(db, hook, siteHost(String(origin ?? '')) || 'formulaire', { received: 1, results: [{ event: result.body.event, ok: true }] });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.statusCode, err.message);
      throw err;
    }
    kickWorker();
    return ok();
  });
}

/** Authenticated part: Intégrations shows the URL, the key, the last call, and lets the merchant rotate them. */
export async function inboundSettingsRoutes(app: FastifyInstance, { db, config }: Deps) {
  const base = `${config.publicUrl}${PREFIX}/public`;
  const view = (accountId: string) => {
    const webhook = ensureHook(db, accountId, 'webhook');
    const form = ensureHook(db, accountId, 'form');
    const last = (h: InboundHook) => ({
      uses: h.uses,
      last_used_at: h.last_used_at,
      last_source: h.last_source,
      last_result: h.last_result ? JSON.parse(h.last_result) : null,
    });
    return {
      webhook: { url: `${base}/hooks/${webhook.token}`, ...last(webhook) },
      form: {
        key: form.token,
        script_url: `${base}/forms/${form.token}/embed.js`,
        action_url: `${base}/forms/${form.token}`,
        allowed_origins: hookOrigins(form),
        ...last(form),
      },
    };
  };

  app.get('/inbound', async (request) => view(request.accountId));

  app.post<{ Params: { kind: string } }>('/inbound/:kind/rotate', async (request) => {
    rotateHook(db, request.accountId, parse(kindParam, request.params.kind));
    return view(request.accountId);
  });

  app.patch('/inbound/form', async (request) => {
    const body = parse(originsSchema, request.body);
    const hosts: string[] = [];
    for (const value of body.allowed_origins) {
      if (!value) continue;
      const host = siteHost(value.replace(/^\*\./, ''));
      // A real domain: at least one dot, not a bare TLD, no wildcard left.
      if (!host || !host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('*')) {
        throw badRequest(t(`Domaine invalide : ${value.slice(0, 80)}`, `Invalid domain: ${value.slice(0, 80)}`));
      }
      if (!hosts.includes(host)) hosts.push(host);
    }
    ensureHook(db, request.accountId, 'form');
    run(db, "UPDATE inbound_hooks SET allowed_origins = ? WHERE account_id = ? AND kind = 'form'", JSON.stringify(hosts), request.accountId);
    return view(request.accountId);
  });
}

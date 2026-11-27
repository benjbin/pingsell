import type { FastifyInstance, FastifyReply } from 'fastify';
import { get, now, run, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { cancelRunsForContact, fireTrigger } from '../services/automations.js';
import { recordEvent } from '../services/contacts.js';
import { browserLanguage, learnContactLanguage } from '../services/contactLanguage.js';
import { decorateLink } from '../services/webTracking.js';
import { escapeHtml } from '../services/render.js';
import { bumpCampaign, markClicked, markOpened, messageHtml } from '../services/messages.js';
import { currentLang, t } from '../i18n.js';
import { WORKER_STALE_MS, workerTickAgeMs } from '../lib/health.js';

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the tracking routes need of a message: never its HTML (up to ~150 KB), read only to check a click. */
interface MessageRow {
  rid: number;
  id: string;
  account_id: string;
  campaign_id: string | null;
  automation_id: string | null;
  contact_id: string | null;
  to_email: string;
  opened_at: string | null;
  clicked_at: string | null;
}

function page(reply: FastifyReply, status: number, title: string, body: string) {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(`<!DOCTYPE html>
<html lang="${currentLang()}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <main style="max-width:440px;margin:24px;padding:40px 32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.04);">
    <div style="width:48px;height:48px;margin:0 auto 20px;border-radius:12px;background:#0B214A;color:#fff;font-size:24px;line-height:48px;font-weight:800;">M</div>
    <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;">${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`);
}

export async function trackingRoutes(app: FastifyInstance, { db, config }: Deps) {
  const loadMessage = (id: string) =>
    UUID_RE.test(id)
      ? get<MessageRow>(
          db,
          'SELECT rowid AS rid, id, account_id, campaign_id, automation_id, contact_id, to_email, opened_at, clicked_at FROM messages WHERE id = ?',
          id,
        )
      : undefined;

  const eventData = (m: MessageRow, extra: object = {}) => ({
    message_id: m.id,
    ...(m.campaign_id ? { campaign_id: m.campaign_id } : {}),
    ...(m.automation_id ? { automation_id: m.automation_id } : {}),
    ...extra,
  });

  // Santé : la base répond (SELECT 1) et le worker tourne. 503 seulement si la base ne répond pas ;
  // un worker figé est signalé (worker_stale) sans faire tomber le HTTP.
  app.get('/health', async (_request, reply) => {
    const startedAt = performance.now();
    let dbOk = false;
    try {
      dbOk = (db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined)?.ok === 1;
    } catch {
      dbOk = false;
    }
    const tickAge = workerTickAgeMs();
    return reply.code(dbOk ? 200 : 503).header('cache-control', 'no-store').send({
      ok: dbOk,
      db: dbOk,
      db_ms: Math.round((performance.now() - startedAt) * 10) / 10,
      worker_last_tick_ms: tickAge,
      worker_stale: tickAge === null ? false : tickAge > WORKER_STALE_MS,
      uptime_s: Math.round(process.uptime()),
    });
  });

  // Open pixel: /t/o/<messageId>.gif — records the first open only.
  app.get<{ Params: { file: string } }>('/t/o/:file', async (request, reply) => {
    const id = request.params.file.replace(/\.gif$/i, '');
    const message = loadMessage(id);
    if (message && !message.opened_at) {
      transaction(db, () => {
        if (markOpened(db, message, now())) recordEvent(db, message.account_id, message.contact_id, 'open', eventData(message));
      });
    }
    return reply
      .type('image/gif')
      .header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('pragma', 'no-cache')
      .send(PIXEL);
  });

  // Click redirect: only to URLs that actually appear in the message (no open redirect).
  app.get<{ Params: { id: string }; Querystring: { u?: string } }>('/t/c/:id', async (request, reply) => {
    const target = typeof request.query.u === 'string' ? request.query.u : '';
    const message = loadMessage(request.params.id);
    const encoded = encodeURIComponent(target);
    let legit = false;
    if (message && /^https?:\/\//i.test(target)) {
      // Campaign emails store no HTML: rendered again from the campaign, with the same links.
      const html = messageHtml(db, config, get(db, 'SELECT id, account_id, campaign_id, contact_id, to_email, html FROM messages WHERE id = ?', message.id) ?? {});
      legit = html.includes(encoded) || html.includes(escapeHtml(encoded));
    }
    if (!message || !legit) {
      return page(
        reply,
        404,
        t('Lien invalide', 'Invalid link'),
        `<p style="margin:0;color:#475569;">${t('Ce lien est invalide ou a expiré.', 'This link is invalid or has expired.')}</p>`,
      );
    }
    transaction(db, () => {
      // A click implies the email was opened (pixel blocked by the client, for instance).
      const { opened } = markClicked(db, message, now());
      if (opened) recordEvent(db, message.account_id, message.contact_id, 'open', eventData(message, { via: 'click' }));
      recordEvent(db, message.account_id, message.contact_id, 'click', eventData(message, { url: target }));
      if (message.contact_id) fireTrigger(db, message.account_id, message.contact_id, 'email_clicked', { url: target, campaign_id: message.campaign_id ?? null, automation_id: message.automation_id ?? null });
      // The customer's own browser: its language is the one they read in (the next campaigns are translated into it).
      learnContactLanguage(db, message.contact_id, browserLanguage(request.headers), 'browser');
    });
    // Towards the merchant's own site: a signed token lets the site script recognise the customer.
    return reply.header('cache-control', 'no-store').redirect(decorateLink(db, message.account_id, message.contact_id, target), 302);
  });

  const unsubscribe = (message: MessageRow, method: string): boolean => {
    if (!message.contact_id) return false;
    return transaction(db, () => {
      const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ?', message.contact_id!);
      if (!contact) return false;
      if (contact.status !== 'unsubscribed') {
        run(db, "UPDATE contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?", now(), message.contact_id!);
        const eventId = recordEvent(db, message.account_id, message.contact_id, 'unsubscribe', eventData(message, { method }));
        // Indexed columns: the campaign report counts and lists its unsubscribes without reading the JSON.
        run(db, 'UPDATE events SET message_id = ?, campaign_id = ? WHERE id = ?', message.id, message.campaign_id, eventId);
        bumpCampaign(db, message.campaign_id, message.rid, { n_unsub: 1 });
        cancelRunsForContact(db, message.contact_id!);
      }
      return true;
    });
  };

  const notFoundPage = (reply: FastifyReply) =>
    page(
      reply,
      404,
      t('Lien introuvable', 'Link not found'),
      `<p style="margin:0;color:#475569;">${t('Ce lien de désinscription est invalide.', 'This unsubscribe link is invalid.')}</p>`,
    );

  const testPage = (reply: FastifyReply) =>
    page(
      reply,
      200,
      t('Email de test', 'Test email'),
      `<p style="margin:0;color:#475569;">${t(
        "Cet email était un envoi de test : aucune désinscription n'est nécessaire.",
        'This was a test email: no need to unsubscribe.',
      )}</p>`,
    );

  const senderName = (message: MessageRow) =>
    escapeHtml(get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', message.account_id)?.name ?? t('cet expéditeur', 'this sender'));

  // The pages follow the visitor's browser language (Accept-Language), not the sender's.
  // GET only asks for a confirmation: link scanners (corporate mail filters, antivirus) open every link of an
  // email, and must not unsubscribe people who never clicked. The button POSTs to the same address.
  app.get<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const message = loadMessage(request.params.id);
    if (!message) return notFoundPage(reply);
    if (!message.contact_id) return testPage(reply);
    const sender = senderName(message);
    const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ?', message.contact_id);
    if (contact?.status === 'unsubscribed') return unsubscribedPage(reply, sender);
    return page(
      reply,
      200,
      t('Se désinscrire ?', 'Unsubscribe?'),
      `<p style="margin:0 0 24px;color:#475569;line-height:24px;">${t(
        `Vous ne recevrez plus d'emails marketing de <strong>${sender}</strong> à l'adresse ${escapeHtml(message.to_email)}.`,
        `You won’t receive any more marketing emails from <strong>${sender}</strong> at ${escapeHtml(message.to_email)}.`,
      )}</p>
       <form method="post" style="margin:0;">
         <button type="submit" style="appearance:none;border:0;border-radius:10px;background:#0B214A;color:#fff;font:600 16px/24px Inter,Segoe UI,Helvetica,Arial,sans-serif;padding:12px 28px;cursor:pointer;">${t(
           'Confirmer la désinscription',
           'Confirm unsubscribe',
         )}</button>
       </form>`,
    );
  });

  const unsubscribedPage = (reply: FastifyReply, sender: string) =>
    page(
      reply,
      200,
      t('Vous êtes désinscrit(e)', 'You’re unsubscribed'),
      `<p style="margin:0 0 8px;color:#475569;line-height:24px;">${t(
        `Vous ne recevrez plus d'emails marketing de <strong>${sender}</strong>.`,
        `You won’t receive any more marketing emails from <strong>${sender}</strong>.`,
      )}</p>
       <p style="margin:0;color:#94a3b8;font-size:14px;">${t(
         `C'était une erreur ? Contactez directement ${sender} pour vous réinscrire.`,
         `Was this a mistake? Contact ${sender} directly to resubscribe.`,
       )}</p>`,
    );

  // The confirmation button, and RFC 8058 one-click unsubscribe (List-Unsubscribe-Post: List-Unsubscribe=One-Click,
  // sent by the mailbox provider itself): both unsubscribe.
  app.post<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const message = loadMessage(request.params.id);
    const body = request.body;
    const oneClick =
      (typeof body === 'string' && /List-Unsubscribe=One-Click/i.test(body)) ||
      (!!body && typeof body === 'object' && (body as Record<string, unknown>)['List-Unsubscribe'] === 'One-Click');
    if (message) unsubscribe(message, oneClick ? 'one-click' : 'link');
    if (oneClick || !String(request.headers.accept ?? '').includes('text/html')) return reply.code(200).send({ ok: true });
    if (!message) return notFoundPage(reply);
    if (!message.contact_id) return testPage(reply);
    return unsubscribedPage(reply, senderName(message));
  });
}

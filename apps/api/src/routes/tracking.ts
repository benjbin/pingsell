import type { FastifyInstance, FastifyReply } from 'fastify';
import { get, now, run, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { cancelRunsForContact } from '../services/automations.js';
import { recordEvent } from '../services/contacts.js';
import { escapeHtml } from '../services/render.js';
import { currentLang, t } from '../i18n.js';

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MessageRow {
  id: string;
  account_id: string;
  campaign_id: string | null;
  automation_id: string | null;
  contact_id: string | null;
  html: string;
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

export async function trackingRoutes(app: FastifyInstance, { db }: Deps) {
  const loadMessage = (id: string) =>
    UUID_RE.test(id)
      ? get<MessageRow>(
          db,
          'SELECT id, account_id, campaign_id, automation_id, contact_id, html, opened_at, clicked_at FROM messages WHERE id = ?',
          id,
        )
      : undefined;

  const eventData = (m: MessageRow, extra: object = {}) => ({
    message_id: m.id,
    ...(m.campaign_id ? { campaign_id: m.campaign_id } : {}),
    ...(m.automation_id ? { automation_id: m.automation_id } : {}),
    ...extra,
  });

  app.get('/health', async () => ({ ok: true }));

  // Open pixel: /t/o/<messageId>.gif — records the first open only.
  app.get<{ Params: { file: string } }>('/t/o/:file', async (request, reply) => {
    const id = request.params.file.replace(/\.gif$/i, '');
    const message = loadMessage(id);
    if (message && !message.opened_at) {
      transaction(db, () => {
        const changed = run(db, 'UPDATE messages SET opened_at = ? WHERE id = ? AND opened_at IS NULL', now(), id);
        if (changed) recordEvent(db, message.account_id, message.contact_id, 'open', eventData(message));
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
    const legit =
      message &&
      /^https?:\/\//i.test(target) &&
      (message.html.includes(encoded) || message.html.includes(escapeHtml(encoded)));
    if (!legit) {
      return page(
        reply,
        404,
        t('Lien invalide', 'Invalid link'),
        `<p style="margin:0;color:#475569;">${t('Ce lien est invalide ou a expiré.', 'This link is invalid or has expired.')}</p>`,
      );
    }
    transaction(db, () => {
      const timestamp = now();
      // A click implies the email was opened (pixel blocked by the client, for instance).
      run(db, 'UPDATE messages SET opened_at = COALESCE(opened_at, ?), clicked_at = COALESCE(clicked_at, ?) WHERE id = ?', timestamp, timestamp, message.id);
      if (!message.opened_at) recordEvent(db, message.account_id, message.contact_id, 'open', eventData(message, { via: 'click' }));
      recordEvent(db, message.account_id, message.contact_id, 'click', eventData(message, { url: target }));
    });
    return reply.header('cache-control', 'no-store').redirect(target, 302);
  });

  const unsubscribe = (message: MessageRow, method: string): boolean => {
    if (!message.contact_id) return false;
    return transaction(db, () => {
      const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ?', message.contact_id!);
      if (!contact) return false;
      if (contact.status !== 'unsubscribed') {
        run(db, "UPDATE contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?", now(), message.contact_id!);
        recordEvent(db, message.account_id, message.contact_id, 'unsubscribe', eventData(message, { method }));
        cancelRunsForContact(db, message.contact_id!);
      }
      return true;
    });
  };

  // The page follows the visitor's browser language (Accept-Language), not the sender's.
  app.get<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const message = loadMessage(request.params.id);
    if (!message) {
      return page(
        reply,
        404,
        t('Lien introuvable', 'Link not found'),
        `<p style="margin:0;color:#475569;">${t('Ce lien de désinscription est invalide.', 'This unsubscribe link is invalid.')}</p>`,
      );
    }
    const account = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', message.account_id);
    const sender = escapeHtml(account?.name ?? t('cet expéditeur', 'this sender'));
    if (!message.contact_id) {
      return page(
        reply,
        200,
        t('Email de test', 'Test email'),
        `<p style="margin:0;color:#475569;">${t(
          "Cet email était un envoi de test : aucune désinscription n'est nécessaire.",
          'This was a test email: no need to unsubscribe.',
        )}</p>`,
      );
    }
    unsubscribe(message, 'link');
    return page(
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
  });

  // RFC 8058 one-click unsubscribe (List-Unsubscribe-Post).
  app.post<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const message = loadMessage(request.params.id);
    if (message) unsubscribe(message, 'one-click');
    return reply.code(200).send({ ok: true });
  });
}

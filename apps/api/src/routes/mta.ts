import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { applyBounce, parseBounce } from '../services/bounces.js';

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * `POST /webhooks/mta?rcpt=<address>`: our own MTA (apps/mta) pipes here every email it receives
 * for the mail domain — bounces (DSN) and spam complaints (feedback loops) — as raw RFC 822.
 * Disabled (404) unless MTA_WEBHOOK_SECRET is set.
 */
export async function mtaRoutes(app: FastifyInstance, { db, config }: Deps) {
  app.addContentTypeParser(['message/rfc822', 'text/plain', 'application/octet-stream'], { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, (_request, body, done) => {
    done(null, typeof body === 'string' ? body : body.toString('utf8'));
  });

  app.post<{ Querystring: { rcpt?: string } }>('/webhooks/mta', { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const secret = config.smtp.webhookSecret;
    const given = request.headers['x-pingsell-secret'];
    if (!secret) return reply.code(404).send({ error: 'Not found' });
    if (typeof given !== 'string' || !sameSecret(given, secret)) return reply.code(401).send({ error: 'Unauthorized' });

    const raw = typeof request.body === 'string' ? request.body : '';
    const rcpt = typeof request.query.rcpt === 'string' ? request.query.rcpt : null;
    const report = parseBounce(raw, rcpt);
    const { contactId } = applyBounce(db, report);
    request.log.info({ rcpt, kind: report.kind, messageId: report.messageId, status: report.status, contactId }, 'mta report');
    return reply.code(204).send();
  });
}

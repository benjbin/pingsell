import { createVerify, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { applyBounce, parseBounce, parseSesNotification } from '../services/bounces.js';

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/* ------------------------------------------------------------ SNS signature */

interface SnsMessage {
  Type?: string;
  MessageId?: string;
  Token?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  SubscribeURL?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
}

/** Only Amazon's own certificate / subscription hosts (sns.<region>.amazonaws.com). */
const isSnsUrl = (value: string | undefined, pem = false): boolean => {
  try {
    const u = new URL(value ?? '');
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i.test(u.hostname) && (!pem || u.pathname.endsWith('.pem'));
  } catch {
    return false;
  }
};

const certificates = new Map<string, string>();

async function signingCert(url: string): Promise<string> {
  const hit = certificates.get(url);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certificate ${res.status}`);
  const pem = await res.text();
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('not a certificate');
  if (certificates.size > 20) certificates.clear();
  certificates.set(url, pem);
  return pem;
}

/** The string SNS signs (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html). */
function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === 'Notification'
      ? (['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const)
      : (['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const);
  return keys
    .filter((k) => typeof m[k] === 'string')
    .map((k) => `${k}\n${m[k]}\n`)
    .join('');
}

export async function verifySnsSignature(m: SnsMessage): Promise<boolean> {
  if (!m.Signature || !isSnsUrl(m.SigningCertURL, true)) return false;
  const algorithm = m.SignatureVersion === '2' ? 'RSA-SHA256' : m.SignatureVersion === '1' ? 'RSA-SHA1' : null;
  if (!algorithm) return false;
  const pem = await signingCert(m.SigningCertURL!);
  return createVerify(algorithm).update(stringToSign(m), 'utf8').verify(pem, m.Signature, 'base64');
}

/**
 * `POST /webhooks/mta?rcpt=<address>`: our own MTA (apps/mta) pipes here every email it receives
 * for the mail domain — bounces (DSN) and spam complaints (feedback loops) — as raw RFC 822.
 * Disabled (404) unless MTA_WEBHOOK_SECRET is set.
 *
 * `POST /webhooks/ses`: bounces and complaints of Amazon SES (EMAIL_PROVIDER=ses), delivered by SNS.
 * Disabled (404) unless SES_SNS_TOPIC_ARNS is set (comma-separated topic ARNs we accept). Every message must carry a
 * valid SNS signature; a subscription confirmation for one of those topics is confirmed automatically.
 * Setup: an SNS topic (HTTPS subscription to <PUBLIC_URL>/webhooks/ses) as the SES configuration set's event
 * destination for Bounce + Complaint (or as the identity's bounce / complaint notification topic, with
 * "include original headers").
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

  app.post('/webhooks/ses', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    // Read here rather than in config.ts: only used by this route.
    const topics = (process.env.SES_SNS_TOPIC_ARNS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!topics.length) return reply.code(404).send({ error: 'Not found' });

    let m: SnsMessage;
    try {
      // SNS posts JSON as text/plain.
      m = (typeof request.body === 'string' ? JSON.parse(request.body) : request.body) as SnsMessage;
    } catch {
      return reply.code(400).send({ error: 'Invalid body' });
    }
    if (!m || typeof m !== 'object' || !m.TopicArn || !topics.includes(m.TopicArn)) return reply.code(403).send({ error: 'Unknown topic' });
    let valid = false;
    try {
      valid = await verifySnsSignature(m);
    } catch (err) {
      request.log.warn({ err }, 'sns signature check failed');
    }
    if (!valid) return reply.code(403).send({ error: 'Invalid signature' });

    if (m.Type === 'SubscriptionConfirmation') {
      if (!isSnsUrl(m.SubscribeURL)) return reply.code(400).send({ error: 'Invalid SubscribeURL' });
      const res = await fetch(m.SubscribeURL!, { signal: AbortSignal.timeout(10_000) });
      request.log.info({ topic: m.TopicArn, status: res.status }, 'sns subscription confirmed');
      return reply.code(res.ok ? 204 : 502).send();
    }
    if (m.Type !== 'Notification') return reply.code(204).send();

    let event: unknown;
    try {
      event = JSON.parse(m.Message ?? '');
    } catch {
      return reply.code(204).send();
    }
    const report = parseSesNotification(event);
    const { contactId } = applyBounce(db, report);
    request.log.info({ kind: report.kind, messageId: report.messageId, status: report.status, contactId }, 'ses report');
    return reply.code(204).send();
  });
}

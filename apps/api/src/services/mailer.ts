import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import type { DatabaseSync } from '../db.js';
import { dkimKeyFor, domainOf, type DkimKey } from './sendingDomains.js';

export interface OutgoingEmail {
  messageId: string;
  to: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
  /** For the Feedback-ID header (Gmail complaint stats per sender / campaign). */
  accountId?: string;
  campaignId?: string | null;
}

export interface SendResult {
  providerId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
}

/**
 * Whether a send error is worth retrying. Permanent: the provider refused this email or this recipient
 * (SMTP 5xx, SES MessageRejected / unverified sender…). Transient: anything that says "not now" — timeouts,
 * dropped connections, SMTP 4xx, SES throttling or a provider-side 5xx HTTP error. Unknown errors are retried
 * (a bounded number of times by the worker) rather than losing the email.
 */
export function classifySendError(err: unknown): 'transient' | 'permanent' {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; responseCode?: unknown; $metadata?: { httpStatusCode?: unknown }; $retryable?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const smtp = typeof e.responseCode === 'number' ? e.responseCode : null;
  if (smtp !== null) return smtp >= 500 && smtp < 600 ? 'permanent' : 'transient';
  if (['MessageRejected', 'MailFromDomainNotVerifiedException', 'BadRequestException', 'NotFoundException'].includes(name)) return 'permanent';
  // Nodemailer refuses an address before talking to the server (bad syntax): retrying won't help.
  if (code === 'EENVELOPE') return 'permanent';
  const http = typeof e.$metadata?.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : null;
  if (http !== null && http >= 400 && http < 500 && http !== 429 && !e.$retryable && !/Throttl|TooManyRequests|LimitExceeded|SendingPaused|AccountSuspended/i.test(name)) return 'permanent';
  return 'transient';
}

/** Formats `Name <email>` with RFC 5322 quoting when needed. */
export function formatAddress(name: string, email: string): string {
  const clean = name.replace(/[\r\n]/g, ' ').trim();
  if (!clean) return email;
  const needsQuotes = /[^\w\s!#$%&'*+\-/=?^`{|}~À-ÿ]/.test(clean);
  return `${needsQuotes ? `"${clean.replace(/["\\]/g, '\\$&')}"` : clean} <${email}>`;
}

/**
 * Development provider: nothing leaves the machine. The message (incl. HTML) is
 * already stored in the `messages` table and visible through `GET /api/v1/outbox`.
 */
export class LogProvider implements EmailProvider {
  readonly name = 'log';

  async send(email: OutgoingEmail): Promise<SendResult> {
    console.log(`[mail:log] → ${email.to} · « ${email.subject} » (${email.messageId})`);
    return { providerId: `log_${email.messageId}` };
  }
}

/** Amazon SES v2 provider (credentials from the standard AWS provider chain). */
export class SesProvider implements EmailProvider {
  readonly name = 'ses';
  private client: Promise<import('@aws-sdk/client-sesv2').SESv2Client> | undefined;

  constructor(private readonly region: string) {}

  private async getClient() {
    this.client ??= import('@aws-sdk/client-sesv2').then(({ SESv2Client }) => new SESv2Client({ region: this.region }));
    return this.client;
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const [{ SendEmailCommand }, client] = await Promise.all([import('@aws-sdk/client-sesv2'), this.getClient()]);
    // X-Pingsell-Message lets the SNS bounce / complaint notifications (POST /webhooks/ses) find the message
    // when the notification carries the original headers rather than the email tags.
    const headers = [
      { Name: 'X-Pingsell-Message', Value: email.messageId.replace(/[^\w-]/g, '') },
      ...(email.unsubscribeUrl
        ? [
            { Name: 'List-Unsubscribe', Value: `<${email.unsubscribeUrl}>` },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ]
        : []),
    ];
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: formatAddress(email.fromName, email.fromEmail),
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: email.html, Charset: 'UTF-8' },
              Text: { Data: email.text, Charset: 'UTF-8' },
            },
            Headers: headers,
          },
        },
        EmailTags: [{ Name: 'pingsell_message_id', Value: email.messageId.replace(/[^\w-]/g, '') }],
      }),
    );
    return { providerId: result.MessageId ?? `ses_${email.messageId}` };
  }
}

/** Envelope sender for a message: bounces come back to `bounces+<messageId>@<mail domain>`. */
export function bounceAddress(mailDomain: string, messageId: string): string {
  return `bounces+${messageId.replace(/[^\w-]/g, '')}@${mailDomain}`;
}

/** Finds the merchant's DKIM key for a sender address (null: not on a verified domain of theirs). */
export type DkimLookup = (accountId: string, fromEmail: string) => DkimKey | null;

/**
 * Self-hosted provider: hands messages over SMTP to our own MTA (apps/mta), which signs them
 * with DKIM and delivers them directly to the recipients' mail servers. No third party.
 *
 * DMARC alignment: the MTA signs for our own domain. A sender on a merchant's domain they have
 * verified (Settings → Sending domain) is signed here with their own key, so `From: hello@shop.com`
 * passes DMARC. Any other address is moved to Reply-To and the From becomes our address.
 */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    private readonly config: AppConfig,
    private readonly dkimFor: DkimLookup = () => null,
  ) {
    this.transport = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      // Internal hop on the Docker network: the MTA does TLS towards the outside world.
      ignoreTLS: true,
      pool: true,
      maxConnections: 4,
      maxMessages: 500,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const domain = this.config.smtp.mailDomain;
    const merchantKey = email.accountId ? this.dkimFor(email.accountId, email.fromEmail) : null;
    const ownDomain = domainOf(email.fromEmail) === domain || !!merchantKey;
    const fromEmail = ownDomain ? email.fromEmail : this.config.defaultFromEmail;
    const headers: Record<string, string> = { 'X-Pingsell-Message': email.messageId };
    if (email.unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${email.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    if (email.accountId) {
      const id = (v: string) => v.replace(/[^\w-]/g, '').slice(0, 36);
      headers['Feedback-ID'] = `${id(email.campaignId ?? 'auto')}:${id(email.accountId)}:pingsell`;
    }
    const info = await this.transport.sendMail({
      messageId: `<${email.messageId.replace(/[^\w.-]/g, '')}@${domain}>`,
      from: { name: email.fromName.replace(/[\r\n]/g, ' ').trim(), address: fromEmail },
      replyTo: ownDomain ? undefined : email.fromEmail,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers,
      envelope: { from: bounceAddress(domain, email.messageId), to: email.to },
      ...(merchantKey ? { dkim: merchantKey } : {}),
    });
    // The MTA accepted it; final delivery (or a bounce) is reported back through /webhooks/mta.
    return { providerId: info.messageId ?? `smtp_${email.messageId}` };
  }
}

export function createProvider(config: AppConfig, db?: DatabaseSync): EmailProvider {
  if (config.emailProvider === 'smtp') return new SmtpProvider(config, db ? (accountId, from) => dkimKeyFor(db, accountId, from) : undefined);
  if (config.emailProvider === 'ses') return new SesProvider(config.awsRegion);
  return new LogProvider();
}

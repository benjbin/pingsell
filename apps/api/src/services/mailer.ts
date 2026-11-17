import type { AppConfig } from '../config.js';

export interface OutgoingEmail {
  messageId: string;
  to: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}

export interface SendResult {
  providerId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
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
    const headers = email.unsubscribeUrl
      ? [
          { Name: 'List-Unsubscribe', Value: `<${email.unsubscribeUrl}>` },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
        ]
      : undefined;
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

export function createProvider(config: AppConfig): EmailProvider {
  return config.emailProvider === 'ses' ? new SesProvider(config.awsRegion) : new LogProvider();
}

import type { AppConfig } from '../config.js';
import { get, newId, now, run, type DatabaseSync, type Row } from '../db.js';
import { renderEmail, type MergeContact, type RenderedEmail } from './render.js';

export interface Sender {
  name: string;
  email: string;
}

/** Default sender for an account: its name + the platform default address. */
export function accountSender(db: DatabaseSync, config: AppConfig, accountId: string): Sender {
  const row = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', accountId);
  return { name: row?.name ?? 'Pingsell', email: config.defaultFromEmail };
}

export interface CreateMessageInput {
  accountId: string;
  campaignId?: string | null;
  automationId?: string | null;
  contactId?: string | null;
  contact: MergeContact;
  subject: string;
  html: string;
  preheader?: string | null;
  senderName: string;
  status?: 'queued' | 'sent' | 'failed';
  createdAt?: string;
}

/** Renders the email for one recipient and stores it as a message row (queued by default). */
export function createMessage(
  db: DatabaseSync,
  config: AppConfig,
  input: CreateMessageInput,
): { id: string; rendered: RenderedEmail } {
  const id = newId();
  const rendered = renderEmail({
    messageId: id,
    publicUrl: config.publicUrl,
    subject: input.subject,
    html: input.html,
    preheader: input.preheader,
    contact: input.contact,
    senderName: input.senderName,
  });
  run(
    db,
    `INSERT INTO messages (id, account_id, campaign_id, automation_id, contact_id, to_email, subject, html, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.accountId,
    input.campaignId ?? null,
    input.automationId ?? null,
    input.contactId ?? null,
    input.contact.email,
    rendered.subject,
    rendered.html,
    input.status ?? 'queued',
    input.createdAt ?? now(),
  );
  return { id, rendered };
}

export function markSent(db: DatabaseSync, messageId: string, providerId: string): void {
  run(db, "UPDATE messages SET status = 'sent', provider_id = ?, error = NULL, sent_at = ? WHERE id = ?", providerId, now(), messageId);
}

export function markFailed(db: DatabaseSync, messageId: string, error: string): void {
  run(db, "UPDATE messages SET status = 'failed', error = ? WHERE id = ?", error.slice(0, 1000), messageId);
}

export function serializeMessage(row: Row, includeHtml: boolean) {
  const base = {
    id: String(row.id),
    campaign_id: (row.campaign_id as string | null) ?? null,
    automation_id: (row.automation_id as string | null) ?? null,
    contact_id: (row.contact_id as string | null) ?? null,
    to_email: String(row.to_email),
    subject: String(row.subject),
    status: String(row.status),
    provider_id: (row.provider_id as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    sent_at: (row.sent_at as string | null) ?? null,
    opened_at: (row.opened_at as string | null) ?? null,
    clicked_at: (row.clicked_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
  return includeHtml ? { ...base, html: String(row.html) } : base;
}

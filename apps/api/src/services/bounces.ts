import { run, transaction, type DatabaseSync } from '../db.js';
import { markBounced, markComplained, markSoftBounced, messageMeta } from './messages.js';

/**
 * Bounce and complaint handling for self-hosted sending (apps/mta).
 *
 * Every message leaves with the envelope sender `bounces+<messageId>@<mail domain>`, so a
 * delivery status notification (RFC 3464) or a feedback-loop report (ARF, RFC 5965) that
 * comes back to that address tells us exactly which message it is about.
 */

export type BounceKind = 'hard' | 'soft' | 'complaint' | 'ignored';

export interface BounceReport {
  kind: BounceKind;
  messageId: string | null;
  status: string | null;
  diagnostic: string | null;
}

/** Unfolds header continuation lines so `Diagnostic-Code:` values read as one line. */
const unfold = (raw: string) => raw.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');

const field = (text: string, name: string) => new RegExp(`^${name}:[ \\t]*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? null;

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Finds our message id: from the bounce address, else from the copy of the original message. */
export function findMessageId(recipient: string | null, raw: string): string | null {
  const fromRcpt = recipient ? /^bounces\+([\w-]+)@/i.exec(recipient)?.[1] : undefined;
  if (fromRcpt && ID.test(fromRcpt)) return ID.exec(fromRcpt)![0].toLowerCase();
  const header = /^X-Pingsell-Message:[ \t]*([\w-]+)/im.exec(raw)?.[1];
  if (header && ID.test(header)) return ID.exec(header)![0].toLowerCase();
  const envelope = /bounces\+([\w-]+)@/i.exec(raw)?.[1];
  if (envelope && ID.test(envelope)) return ID.exec(envelope)![0].toLowerCase();
  return null;
}

/** A permanent failure that means "this address does not exist", not "you were filtered". */
function isHardFailure(status: string, diagnostic: string | null): boolean {
  if (/^5\.1\.\d+$/.test(status) || status === '5.2.1') return true;
  if (status.startsWith('5.7')) return false; // policy / reputation: our problem, not the address
  return /user unknown|unknown user|no such (user|mailbox)|does not exist|invalid (recipient|mailbox)|recipient (address )?rejected|mailbox unavailable|address rejected/i.test(diagnostic ?? '');
}

/** Classifies a raw DSN / ARF email received on a bounce address. */
export function parseBounce(raw: string, recipient: string | null): BounceReport {
  const text = unfold(raw);
  const messageId = findMessageId(recipient, text);

  if (/report-type="?feedback-report/i.test(text) || /^Feedback-Type:/im.test(text)) {
    const type = (field(text, 'Feedback-Type') ?? 'abuse').toLowerCase();
    return { kind: type === 'abuse' || type === 'fraud' ? 'complaint' : 'ignored', messageId, status: null, diagnostic: `feedback: ${type}` };
  }

  const isDsn = /report-type="?delivery-status/i.test(text) || /^Action:[ \t]*(failed|delayed)/im.test(text);
  if (!isDsn) return { kind: 'ignored', messageId, status: null, diagnostic: null }; // auto-reply, human reply…

  const action = (field(text, 'Action') ?? '').toLowerCase();
  const status = /^Status:[ \t]*(\d\.\d{1,3}\.\d{1,3})/im.exec(text)?.[1] ?? null;
  const diagnostic = field(text, 'Diagnostic-Code')?.replace(/^smtp;\s*/i, '').slice(0, 500) ?? null;
  if (action !== 'failed') return { kind: 'ignored', messageId, status, diagnostic }; // delayed: the MTA retries
  if (status && isHardFailure(status, diagnostic)) return { kind: 'hard', messageId, status, diagnostic };
  return { kind: 'soft', messageId, status, diagnostic };
}

/** Applies a report: marks the message and, for hard bounces / complaints, stops mailing the contact. */
export function applyBounce(db: DatabaseSync, report: BounceReport): { contactId: string | null } {
  if (!report.messageId || report.kind === 'ignored') return { contactId: null };
  const msg = messageMeta(db, report.messageId);
  if (!msg) return { contactId: null };
  const error = [report.status, report.diagnostic].filter(Boolean).join(' ').slice(0, 1000) || null;

  // The campaign counters (statistics, guard) follow each change: see messages.ts.
  transaction(db, () => {
    if (report.kind === 'hard') {
      markBounced(db, msg, error);
      if (msg.contact_id) {
        run(
          db,
          "UPDATE contacts SET status = 'bounced', updated_at = ? WHERE id = ? AND status IN ('subscribed','unsubscribed')",
          new Date().toISOString(),
          msg.contact_id,
        );
      }
    } else if (report.kind === 'soft') {
      markSoftBounced(db, msg, error);
    } else if (report.kind === 'complaint') {
      markComplained(db, msg);
      if (msg.contact_id) run(db, "UPDATE contacts SET status = 'complained', updated_at = ? WHERE id = ?", new Date().toISOString(), msg.contact_id);
    }
  });
  return { contactId: msg.contact_id };
}

/* ------------------------------------------------------------ Amazon SES (via SNS) */

interface SesEvent {
  notificationType?: string;
  eventType?: string;
  bounce?: { bounceType?: string; bounceSubType?: string; bouncedRecipients?: Array<{ status?: string; diagnosticCode?: string }> };
  complaint?: { complaintFeedbackType?: string };
  mail?: { messageId?: string; tags?: Record<string, string[] | undefined>; headers?: Array<{ name?: string; value?: string }> };
}

/**
 * Turns an SES bounce / complaint notification (the `Message` of an SNS notification) into a report.
 * The message is found from the `pingsell_message_id` email tag (SES event publishing through a
 * configuration set) or from the X-Pingsell-Message header (identity notifications with original headers).
 */
export function parseSesNotification(message: unknown): BounceReport {
  const e = (message ?? {}) as SesEvent;
  const type = String(e.eventType ?? e.notificationType ?? '');
  const tag = e.mail?.tags?.pingsell_message_id?.[0];
  const header = e.mail?.headers?.find((h) => (h.name ?? '').toLowerCase() === 'x-pingsell-message')?.value;
  const raw = [tag, header].find((v): v is string => typeof v === 'string' && ID.test(v));
  const messageId = raw ? ID.exec(raw)![0].toLowerCase() : null;
  if (type === 'Bounce') {
    const rcpt = e.bounce?.bouncedRecipients?.[0];
    const status = /\d\.\d{1,3}\.\d{1,3}/.exec(rcpt?.status ?? '')?.[0] ?? null;
    const diagnostic =
      (rcpt?.diagnosticCode ?? `${e.bounce?.bounceType ?? ''} ${e.bounce?.bounceSubType ?? ''}`.trim()).replace(/^smtp;\s*/i, '').slice(0, 500) || null;
    // Permanent = the address does not exist (or SES suppressed it); Transient / Undetermined = mailbox full, etc.
    return { kind: e.bounce?.bounceType === 'Permanent' ? 'hard' : 'soft', messageId, status, diagnostic };
  }
  if (type === 'Complaint') {
    const feedback = (e.complaint?.complaintFeedbackType ?? 'abuse').toLowerCase();
    return { kind: feedback === 'not-spam' ? 'ignored' : 'complaint', messageId, status: null, diagnostic: `feedback: ${feedback}` };
  }
  return { kind: 'ignored', messageId, status: null, diagnostic: null }; // Delivery, Send, Open…
}

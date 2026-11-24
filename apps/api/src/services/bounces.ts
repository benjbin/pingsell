import { get, run, transaction, type DatabaseSync } from '../db.js';

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
  const msg = get<{ id: string; contact_id: string | null }>(db, 'SELECT id, contact_id FROM messages WHERE id = ?', report.messageId);
  if (!msg) return { contactId: null };
  const error = [report.status, report.diagnostic].filter(Boolean).join(' ').slice(0, 1000) || null;

  transaction(db, () => {
    if (report.kind === 'hard') {
      run(db, "UPDATE messages SET status = 'bounced', error = ? WHERE id = ?", error, msg.id);
      if (msg.contact_id) {
        run(
          db,
          "UPDATE contacts SET status = 'bounced', updated_at = ? WHERE id = ? AND status IN ('subscribed','unsubscribed')",
          new Date().toISOString(),
          msg.contact_id,
        );
      }
    } else if (report.kind === 'soft') {
      run(db, "UPDATE messages SET status = 'failed', error = ? WHERE id = ? AND status = 'sent'", error, msg.id);
    } else if (report.kind === 'complaint') {
      run(db, 'UPDATE messages SET complained_at = COALESCE(complained_at, ?) WHERE id = ?', new Date().toISOString(), msg.id);
      if (msg.contact_id) run(db, "UPDATE contacts SET status = 'complained', updated_at = ? WHERE id = ?", new Date().toISOString(), msg.contact_id);
    }
  });
  return { contactId: msg.contact_id };
}

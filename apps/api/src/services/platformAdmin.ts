import { all, type DatabaseSync } from '../db.js';

/** Platform admins' emails from PLATFORM_ADMIN_EMAILS, read on every call (trimmed, case-insensitive). Empty ⇒ nobody. */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Accounts a platform admin belongs to: their emails skip the IP warm-up's daily cap. */
export function platformAdminAccountIds(db: DatabaseSync): string[] {
  const emails = platformAdminEmails();
  if (!emails.length) return [];
  return all<{ account_id: string }>(
    db,
    `SELECT DISTINCT account_id FROM users WHERE lower(trim(email)) IN (${emails.map(() => '?').join(',')})`,
    ...emails,
  ).map((r) => r.account_id);
}

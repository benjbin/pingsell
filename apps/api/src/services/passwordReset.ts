import { createHash, randomBytes } from 'node:crypto';
import { all, get, newId, now, run, transaction, type DatabaseSync } from '../db.js';
import { hashPassword, type UserRow } from './auth.js';

/** A reset link works for one hour, once. */
export const RESET_TTL_MINUTES = 60;
/** At most this many links per user and per hour (an attacker can't flood someone's inbox). */
const MAX_PER_HOUR = 3;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Creates a reset token for this user and returns it (to put in the emailed link), or null when
 * too many links were requested in the last hour. Only its hash is stored: a database leak
 * doesn't leak usable links.
 */
export function createPasswordReset(db: DatabaseSync, userId: string): string | null {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = all(db, 'SELECT id FROM password_resets WHERE user_id = ? AND created_at > ?', userId, since).length;
  if (recent >= MAX_PER_HOUR) return null;
  const token = randomBytes(32).toString('base64url');
  const created = now();
  const expires = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
  run(db, 'INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', newId(), userId, sha256(token), created, expires);
  return token;
}

interface ResetRow {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

/** The user a still-valid token belongs to, or undefined (unknown, expired or already used). */
export function findResetUser(db: DatabaseSync, token: string): UserRow | undefined {
  const row = get<ResetRow>(db, 'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', sha256(token));
  if (!row || row.used_at || row.expires_at <= now()) return undefined;
  return get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', row.user_id);
}

/**
 * Sets the new password, burns every pending link of this user and signs all their sessions out
 * (whoever had the old password loses access). Returns the user, or undefined if the token is invalid.
 */
export function resetPassword(db: DatabaseSync, token: string, password: string): UserRow | undefined {
  const user = findResetUser(db, token);
  if (!user) return undefined;
  const hash = hashPassword(password);
  transaction(db, () => {
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    if (user.role === 'owner') run(db, 'UPDATE accounts SET password_hash = ? WHERE id = ?', hash, user.account_id);
    run(db, 'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now(), user.id);
    run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
  });
  return get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', user.id);
}

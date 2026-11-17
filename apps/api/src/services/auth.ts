import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { get, newId, now, run, type DatabaseSync } from '../db.js';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Hash format: `scrypt$<N>$<salt-hex>$<hash-hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    ...SCRYPT_PARAMS,
    N: Number(n) || SCRYPT_PARAMS.N,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateSessionToken(): string {
  return `sess_${randomBytes(32).toString('base64url')}`;
}

export function generateApiKey(): string {
  return `msv_${randomBytes(24).toString('base64url')}`;
}

export function createSession(db: DatabaseSync, accountId: string, userId: string): string {
  const token = generateSessionToken();
  run(db, 'INSERT INTO sessions (token, account_id, user_id, created_at) VALUES (?, ?, ?, ?)', token, accountId, userId, now());
  return token;
}

export type Role = 'owner' | 'admin' | 'editor';

export interface UserRow {
  id: string;
  account_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  created_at: string;
  last_seen_at: string | null;
}

export function publicUser(u: UserRow) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at, last_seen_at: u.last_seen_at };
}

export function createApiKey(db: DatabaseSync, accountId: string, label: string, key = generateApiKey()) {
  const record = { id: newId(), account_id: accountId, key, label, created_at: now(), last_used_at: null };
  run(
    db,
    'INSERT INTO api_keys (id, account_id, key, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)',
    record.id,
    accountId,
    key,
    label,
    record.created_at,
  );
  return record;
}

/** Resolves a bearer token (session token or `msv_` API key) to an account (and user, for sessions). */
export function resolveToken(db: DatabaseSync, token: string): { accountId: string; userId: string; apiKeyId?: string } | undefined {
  if (token.startsWith('msv_')) {
    const row = get<{ id: string; account_id: string }>(db, 'SELECT id, account_id FROM api_keys WHERE key = ?', token);
    if (!row) return undefined;
    // `last_used_at` is set once the call succeeds (see `markApiKeyUsed`).
    return { accountId: row.account_id, userId: '', apiKeyId: row.id };
  }
  // Sessions of a removed member disappear with the user (ON DELETE CASCADE).
  const row = get<{ account_id: string; user_id: string | null }>(db, 'SELECT account_id, user_id FROM sessions WHERE token = ?', token);
  if (!row?.user_id) return undefined;
  return { accountId: row.account_id, userId: row.user_id };
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

export function makeRequireAuth(db: DatabaseSync): preHandlerHookHandler {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const token = bearerToken(request);
    const auth = token ? resolveToken(db, token) : undefined;
    if (!auth) {
      return reply.code(401).send({ error: token ? 'Jeton invalide ou expiré' : 'Authentification requise' });
    }
    request.accountId = auth.accountId;
    request.userId = auth.userId;
    request.apiKeyId = auth.apiKeyId;
  };
}

/** onResponse hook: a key counts as "used" only by a call that succeeded (the guides rely on it). */
export function makeMarkApiKeyUsed(db: DatabaseSync) {
  return async function markApiKeyUsed(request: FastifyRequest, reply: FastifyReply) {
    if (request.apiKeyId && reply.statusCode < 400) run(db, 'UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), request.apiKeyId);
  };
}

export function publicAccount(row: { id: string; name: string; email: string; created_at: string }) {
  return { id: row.id, name: row.name, email: row.email, created_at: row.created_at };
}

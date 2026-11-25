import { all, get, newId, now, parseJson, run, transaction, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { badRequest } from '../lib/http.js';
import { offload } from '../lib/offload.js';
import { t } from '../i18n.js';

export const CONTACT_STATUSES = ['subscribed', 'unsubscribed', 'bounced', 'complained'] as const;
export const CONTACT_SOURCES = ['manual', 'import', 'shopify', 'api'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export interface Contact {
  id: string;
  account_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  status: ContactStatus;
  source: ContactSource;
  external_id: string | null;
  total_spent: number;
  orders_count: number;
  last_order_at: string | null;
  /** Last page seen on the merchant's site (site tracking). */
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertContactInput {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  tags?: string[];
  attributes?: Record<string, unknown>;
  source?: string;
  external_id?: string | null;
  total_spent?: number;
  orders_count?: number;
  last_order_at?: string | null;
  status?: string;
  /** Untrusted source (public form/webhook): only fill identity fields that are still empty. */
  fill_only?: boolean;
}

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function normalizeTags(tags: readonly unknown[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase().slice(0, 64);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

function asStatus(value: string | undefined): ContactStatus | undefined {
  if (!value) return undefined;
  return (CONTACT_STATUSES as readonly string[]).includes(value) ? (value as ContactStatus) : undefined;
}

function asSource(value: string | undefined): ContactSource {
  return value && (CONTACT_SOURCES as readonly string[]).includes(value) ? (value as ContactSource) : 'api';
}

export function serializeContact(row: Row): Contact {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    email: String(row.email),
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    tags: parseJson<string[]>(row.tags, []),
    attributes: parseJson<Record<string, unknown>>(row.attributes, {}),
    status: row.status as ContactStatus,
    source: row.source as ContactSource,
    external_id: (row.external_id as string | null) ?? null,
    total_spent: Number(row.total_spent ?? 0),
    orders_count: Number(row.orders_count ?? 0),
    last_order_at: (row.last_order_at as string | null) ?? null,
    last_seen_at: (row.last_seen_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function findContact(db: DatabaseSync, accountId: string, id: string): Contact | undefined {
  const row = get(db, 'SELECT * FROM contacts WHERE id = ? AND account_id = ?', id, accountId);
  return row ? serializeContact(row) : undefined;
}

export function findContactByEmail(db: DatabaseSync, accountId: string, email: string): Contact | undefined {
  const row = get(db, 'SELECT * FROM contacts WHERE account_id = ? AND email = ?', accountId, normalizeEmail(email));
  return row ? serializeContact(row) : undefined;
}

/**
 * Creates or updates a contact identified by (account, email).
 * - On update, only provided fields change; tags are merged (never dropped).
 * - Does not fire automations: callers decide (see `fireTrigger`).
 */
export function upsertContact(
  db: DatabaseSync,
  accountId: string,
  input: UpsertContactInput,
): { contact: Contact; created: boolean; addedTags: string[] } {
  const email = normalizeEmail(String(input.email ?? ''));
  if (!isValidEmail(email)) throw badRequest(t(`Adresse email invalide : ${input.email || '(vide)'}`, `Invalid email address: ${input.email || '(empty)'}`));
  const timestamp = now();
  const tags = normalizeTags(input.tags);
  const status = asStatus(input.status);
  const existing = findContactByEmail(db, accountId, email);

  if (!existing) {
    const contact: Contact = {
      id: newId(),
      account_id: accountId,
      email,
      first_name: clean(input.first_name),
      last_name: clean(input.last_name),
      phone: clean(input.phone),
      tags,
      attributes: input.attributes ?? {},
      status: status ?? 'subscribed',
      source: asSource(input.source),
      external_id: clean(input.external_id),
      total_spent: finite(input.total_spent) ?? 0,
      orders_count: Math.trunc(finite(input.orders_count) ?? 0),
      last_order_at: clean(input.last_order_at),
      last_seen_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    run(
      db,
      `INSERT INTO contacts (id, account_id, email, first_name, last_name, phone, tags, attributes, status, source,
        external_id, total_spent, orders_count, last_order_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      contact.id,
      contact.account_id,
      contact.email,
      contact.first_name,
      contact.last_name,
      contact.phone,
      JSON.stringify(contact.tags),
      JSON.stringify(contact.attributes),
      contact.status,
      contact.source,
      contact.external_id,
      contact.total_spent,
      contact.orders_count,
      contact.last_order_at,
      contact.created_at,
      contact.updated_at,
    );
    return { contact, created: true, addedTags: tags };
  }

  const addedTags = tags.filter((t) => !existing.tags.includes(t));
  const updates: Record<string, SQLInputValue> = {};
  const fill = (key: 'first_name' | 'last_name' | 'phone') => {
    if (input[key] === undefined) return;
    const v = clean(input[key]);
    if (input.fill_only && (existing[key] || v === null)) return;
    updates[key] = v;
  };
  fill('first_name');
  fill('last_name');
  fill('phone');
  if (addedTags.length) updates.tags = JSON.stringify([...existing.tags, ...addedTags]);
  if (input.attributes) updates.attributes = JSON.stringify({ ...existing.attributes, ...input.attributes });
  if (status && status !== existing.status && !(status === 'subscribed' && !mayResubscribe(existing.status, input.source))) updates.status = status;
  if (input.external_id !== undefined && input.external_id !== null) updates.external_id = clean(input.external_id);
  if (finite(input.total_spent) !== undefined) updates.total_spent = finite(input.total_spent)!;
  if (finite(input.orders_count) !== undefined) updates.orders_count = Math.trunc(finite(input.orders_count)!);
  if (input.last_order_at !== undefined && input.last_order_at !== null) updates.last_order_at = clean(input.last_order_at);
  // A contact first created elsewhere keeps its original source, except that Shopify data "claims" it.
  if (input.source === 'shopify' && existing.source !== 'shopify') updates.source = 'shopify';

  updateContactColumns(db, existing.id, updates);
  return { contact: findContact(db, accountId, existing.id)!, created: false, addedTags };
}

/**
 * Consent (RGPD / CAN-SPAM): an import, an API call, a form or a webhook never moves an unsubscribed,
 * bounced or complained contact back to « subscribed » — only the person can (the merchant may still do it
 * by hand, PATCH /contacts/:id). A complaint or a hard bounce is final for every upsert; the one exception is
 * an integration relaying the customer's own new marketing consent (Shopify, no `source` on update, which
 * itself never re-subscribes bounced / complained, see resolveStatus).
 */
export function mayResubscribe(current: ContactStatus, source: string | undefined): boolean {
  if (current === 'subscribed') return true;
  if (current === 'bounced' || current === 'complained') return false;
  return source === undefined || source === 'shopify';
}

/* ───────────── Search (« contient », email ou nom) ───────────── */

/**
 * SQL condition over `contacts` for « email or name contains `search` » (any case). Same answer as the
 * former ULOWER(...) LIKE '%x%' on four expressions, but:
 * - once the trigram index (contacts_fts) is complete and the search has 3+ characters, only the rows the
 *   index returns are tested (milliseconds instead of a scan of every contact);
 * - otherwise an ASCII search uses the built-in LIKE (it ignores ASCII case, and emails are stored lowercased),
 *   ULOWER() — one JavaScript call per row — is only kept for searches like « émile ».
 */
export function contactSearchSql(db: DatabaseSync, search: string): { sql: string; params: SQLInputValue[]; indexed: boolean } {
  const needle = search.toLowerCase();
  const like = `%${needle.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const low = /^[\x00-\x7f]*$/.test(needle) ? (col: string) => col : (col: string) => `ULOWER(${col})`;
  const parts = [`email LIKE ? ESCAPE '\\'`, `${low("COALESCE(first_name, '')")} LIKE ? ESCAPE '\\'`, `${low("COALESCE(last_name, '')")} LIKE ? ESCAPE '\\'`];
  // « prénom nom » can only match where first name or last name alone does not if the search has a space.
  if (needle.includes(' ')) parts.push(`${low("COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')")} LIKE ? ESCAPE '\\'`);
  const exact = { sql: `(${parts.join(' OR ')})`, params: parts.map(() => like), indexed: false };
  if ([...needle].length < 3 || !contactSearchIndexReady(db)) return exact;
  return {
    sql: `rowid IN (SELECT rowid FROM contacts_fts WHERE contacts_fts MATCH ?) AND ${exact.sql}`,
    params: [`"${needle.replace(/"/g, '""')}"`, ...exact.params],
    indexed: true,
  };
}

const searchReady = new WeakMap<DatabaseSync, boolean>();

/** True once every contact is in the trigram index (the background backfill is over). */
export function contactSearchIndexReady(db: DatabaseSync): boolean {
  if (searchReady.get(db)) return true;
  let ready = false;
  try {
    ready = Number(get<{ done: number }>(db, 'SELECT done FROM contacts_fts_state WHERE id = 1')?.done ?? 0) === 1;
  } catch {
    ready = false; // read worker on a database without the table yet
  }
  if (ready) searchReady.set(db, true);
  return ready;
}

const backfilling = new WeakSet<DatabaseSync>();

/**
 * Indexes the contacts that existed before contacts_fts (new / changed ones are indexed by triggers):
 * by rowid ranges, each in its own short transaction (~25 ms), yielding to the event loop in between.
 * Idempotent (INSERT OR REPLACE) and resumable: the cursor is saved with each batch.
 */
export function startContactSearchBackfill(db: DatabaseSync, opts: { budgetMs?: number; pauseMs?: number } = {}): Promise<void> {
  if (backfilling.has(db)) return Promise.resolve();
  backfilling.add(db);
  const budget = opts.budgetMs ?? 25;
  const pause = opts.pauseMs ?? 5;
  return (async () => {
    try {
      const state = get<{ cursor: number; done: number }>(db, 'SELECT cursor, done FROM contacts_fts_state WHERE id = 1');
      if (!state) return;
      if (state.done) {
        if (!(await searchIndexLooksRight(db))) {
          console.error('[contacts] search index out of step with contacts (restored backup?): rebuilding it');
          run(db, "INSERT INTO contacts_fts (contacts_fts) VALUES ('delete-all')");
          run(db, 'UPDATE contacts_fts_state SET cursor = 0, done = 0 WHERE id = 1');
          searchReady.delete(db);
        } else return;
      }
      const end = Number(get<{ m: number | null }>(db, 'SELECT MAX(rowid) AS m FROM contacts')?.m ?? 0);
      let cursor = Number(get<{ cursor: number }>(db, 'SELECT cursor FROM contacts_fts_state WHERE id = 1')?.cursor ?? 0);
      let step = 500;
      const insert = db.prepare(
        `INSERT OR REPLACE INTO contacts_fts (rowid, email, name)
         SELECT rowid, email, COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') FROM contacts WHERE rowid > ? AND rowid <= ?`,
      );
      while (cursor < end) {
        const started = performance.now();
        const to = Math.min(end, cursor + step);
        transaction(db, () => {
          insert.run(cursor, to);
          run(db, 'UPDATE contacts_fts_state SET cursor = ? WHERE id = 1', to);
        });
        cursor = to;
        // Keep each batch near the time budget whatever the row size / disk speed.
        const took = performance.now() - started;
        step = Math.max(100, Math.min(20_000, Math.round(step * (took > 0 ? Math.min(1.5, budget / took) : 1.5))));
        await new Promise((r) => setTimeout(r, pause));
      }
      // Rows above `end` were inserted after the start: the insert trigger indexed them.
      run(db, 'UPDATE contacts_fts_state SET done = 1 WHERE id = 1');
      searchReady.set(db, true);
    } finally {
      backfilling.delete(db);
    }
  })();
}

/** A few random contacts must be found in the index by their own email (cheap check at start-up). */
async function searchIndexLooksRight(db: DatabaseSync): Promise<boolean> {
  const max = Number(get<{ m: number | null }>(db, 'SELECT MAX(rowid) AS m FROM contacts')?.m ?? 0);
  const pick = db.prepare('SELECT rowid, email FROM contacts WHERE rowid >= ? ORDER BY rowid LIMIT 1');
  const sample = Array.from({ length: 10 }, () => pick.get(1 + Math.floor(Math.random() * max)) as { rowid: number; email: string } | undefined).filter(
    (c): c is { rowid: number; email: string } => !!c && [...c.email].length >= 3,
  );
  // A MATCH on a whole email intersects big trigram lists (« com », « mai »…): run off the main thread.
  const found = await Promise.all(
    sample.map((c) => offload(db, 'get', 'SELECT 1 AS ok FROM contacts_fts WHERE contacts_fts MATCH ? AND rowid = ?', [`email:"${c.email.replace(/"/g, '""')}"`, c.rowid])),
  );
  return found.every((r) => !!r);
}

/** Read-worker task: number of contacts per tag (GET /tags), largest first. */
export function tagCounts(db: DatabaseSync, accountId: string): Array<{ tag: string; count: number }> {
  return all<{ tag: string; count: number }>(
    db,
    `SELECT LOWER(j.value) AS tag, COUNT(DISTINCT c.id) AS count
       FROM contacts c, json_each(c.tags) j
      WHERE c.account_id = ? AND c.tags != '[]'
      GROUP BY LOWER(j.value)
      ORDER BY count DESC, tag ASC`,
    accountId,
  ).map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export function updateContactColumns(db: DatabaseSync, contactId: string, updates: Record<string, SQLInputValue>): void {
  const keys = Object.keys(updates);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  run(db, `UPDATE contacts SET ${sets}, updated_at = ? WHERE id = ?`, ...keys.map((k) => updates[k]), now(), contactId);
}

export function recordEvent(
  db: DatabaseSync,
  accountId: string,
  contactId: string | null,
  type: string,
  data: object = {},
  createdAt: string = now(),
): string {
  const id = newId();
  run(
    db,
    'INSERT INTO events (id, account_id, contact_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    accountId,
    contactId,
    type,
    JSON.stringify(data ?? {}),
    createdAt,
  );
  return id;
}

function clean(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function finite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

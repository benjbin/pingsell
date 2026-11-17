import { get, newId, now, parseJson, run, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { badRequest } from '../lib/http.js';

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
  if (!isValidEmail(email)) throw badRequest(`Adresse email invalide : ${input.email || '(vide)'}`);
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
  if (input.first_name !== undefined) updates.first_name = clean(input.first_name);
  if (input.last_name !== undefined) updates.last_name = clean(input.last_name);
  if (input.phone !== undefined) updates.phone = clean(input.phone);
  if (addedTags.length) updates.tags = JSON.stringify([...existing.tags, ...addedTags]);
  if (input.attributes) updates.attributes = JSON.stringify({ ...existing.attributes, ...input.attributes });
  // A spam complaint is final: an import or API upsert never re-subscribes it.
  if (status && !(existing.status === 'complained' && status === 'subscribed')) updates.status = status;
  if (input.external_id !== undefined && input.external_id !== null) updates.external_id = clean(input.external_id);
  if (finite(input.total_spent) !== undefined) updates.total_spent = finite(input.total_spent)!;
  if (finite(input.orders_count) !== undefined) updates.orders_count = Math.trunc(finite(input.orders_count)!);
  if (input.last_order_at !== undefined && input.last_order_at !== null) updates.last_order_at = clean(input.last_order_at);
  // A contact first created elsewhere keeps its original source, except that Shopify data "claims" it.
  if (input.source === 'shopify' && existing.source !== 'shopify') updates.source = 'shopify';

  updateContactColumns(db, existing.id, updates);
  return { contact: findContact(db, accountId, existing.id)!, created: false, addedTags };
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

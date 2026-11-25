import { z } from 'zod';
import { get, now, parseJson, run, scalar, type DatabaseSync, type SQLInputValue } from '../db.js';
import { badRequest } from '../lib/http.js';
import { offload } from '../lib/offload.js';
import { t } from '../i18n.js';

export const SEGMENT_FIELDS = [
  'email',
  'first_name',
  'last_name',
  'status',
  'source',
  'tags',
  'total_spent',
  'orders_count',
  'last_order_at',
  'created_at',
  'last_seen_at',
  'visited_page',
] as const;
export const SEGMENT_OPS = [
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
  'has_tag',
  'not_has_tag',
  'within_days',
  'older_than_days',
] as const;

type Field = (typeof SEGMENT_FIELDS)[number];
type Op = (typeof SEGMENT_OPS)[number];

const TEXT_FIELDS = new Set<Field>(['email', 'first_name', 'last_name', 'status', 'source']);
const NUMBER_FIELDS = new Set<Field>(['total_spent', 'orders_count']);
const DATE_FIELDS = new Set<Field>(['last_order_at', 'created_at', 'last_seen_at']);

const ALLOWED_OPS: Record<'text' | 'number' | 'date' | 'tags' | 'page', ReadonlySet<Op>> = {
  text: new Set<Op>(['eq', 'neq', 'contains', 'gt', 'lt']),
  number: new Set<Op>(['eq', 'neq', 'gt', 'lt']),
  date: new Set<Op>(['within_days', 'older_than_days', 'gt', 'lt', 'eq']),
  tags: new Set<Op>(['has_tag', 'not_has_tag', 'eq', 'neq', 'contains']),
  page: new Set<Op>(['contains', 'neq']),
};

export const conditionSchema = z.object({
  field: z.enum(SEGMENT_FIELDS),
  op: z.enum(SEGMENT_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const rulesSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).max(50).default([]),
});

export type SegmentRules = z.output<typeof rulesSchema>;
export type SegmentCondition = z.output<typeof conditionSchema>;

export interface CompiledRules {
  /** SQL boolean expression over the `contacts` table (unaliased). */
  sql: string;
  params: SQLInputValue[];
}

function kindOf(field: Field): keyof typeof ALLOWED_OPS {
  if (field === 'tags') return 'tags';
  if (field === 'visited_page') return 'page';
  if (NUMBER_FIELDS.has(field)) return 'number';
  if (DATE_FIELDS.has(field)) return 'date';
  return 'text';
}

function requireNumber(c: SegmentCondition): number {
  const n = Number(c.value);
  if (c.value === null || c.value === undefined || c.value === '' || !Number.isFinite(n)) {
    throw badRequest(t(`Règle « ${c.field} ${c.op} » : une valeur numérique est requise`, `Rule “${c.field} ${c.op}”: a numeric value is required`));
  }
  return n;
}

function requireText(c: SegmentCondition): string {
  if (c.value === null || c.value === undefined || String(c.value).trim() === '') {
    throw badRequest(t(`Règle « ${c.field} ${c.op} » : une valeur est requise`, `Rule “${c.field} ${c.op}”: a value is required`));
  }
  return String(c.value).trim();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function compileCondition(c: SegmentCondition): CompiledRules {
  const kind = kindOf(c.field);
  if (!ALLOWED_OPS[kind].has(c.op)) {
    throw badRequest(t(`Opérateur « ${c.op} » non supporté pour le champ « ${c.field} »`, `Operator “${c.op}” isn’t supported for field “${c.field}”`));
  }
  // Column names come from a closed enum, never from user input.
  const col = c.field;

  if (kind === 'tags') {
    const tag = requireText(c).toLowerCase();
    if (c.op === 'contains') {
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(contacts.tags) WHERE LOWER(json_each.value) LIKE ? ESCAPE '\\')`,
        params: [`%${escapeLike(tag)}%`],
      };
    }
    const exists = `EXISTS (SELECT 1 FROM json_each(contacts.tags) WHERE LOWER(json_each.value) = ?)`;
    const negate = c.op === 'not_has_tag' || c.op === 'neq';
    const pre = tagPrefilter(tag);
    // The cheap LIKE on the raw JSON skips json_each for the (many) contacts that cannot have the tag.
    const test = pre ? `(contacts.tags LIKE ? ESCAPE '\\' AND ${exists})` : exists;
    return { sql: negate ? `NOT ${test}` : test, params: pre ? [pre, tag] : [tag] };
  }

  if (kind === 'number') {
    const n = requireNumber(c);
    const sqlOp = { eq: '=', neq: '!=', gt: '>', lt: '<' }[c.op as 'eq' | 'neq' | 'gt' | 'lt'];
    return { sql: `COALESCE(${col}, 0) ${sqlOp} ?`, params: [n] };
  }

  if (kind === 'date') {
    if (c.op === 'within_days' || c.op === 'older_than_days') {
      const days = requireNumber(c);
      const cutoff = daysAgoIso(days);
      return c.op === 'within_days'
        ? { sql: `(${col} IS NOT NULL AND ${col} >= ?)`, params: [cutoff] }
        : { sql: `(${col} IS NOT NULL AND ${col} < ?)`, params: [cutoff] };
    }
    const value = requireText(c);
    if (c.op === 'eq') return { sql: `substr(${col}, 1, ?) = ?`, params: [value.length, value] };
    return { sql: `(${col} IS NOT NULL AND ${col} ${c.op === 'gt' ? '>' : '<'} ?)`, params: [value] };
  }

  // Pages seen on the site (site tracking): « a visité une page contenant /tarifs ».
  if (c.field === 'visited_page') {
    const value = requireText(c).toLowerCase();
    const exists = `EXISTS (SELECT 1 FROM web_pageviews wp WHERE wp.contact_id = contacts.id AND (LOWER(wp.url) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(wp.title, '')) LIKE ? ESCAPE '\\'))`;
    const like = `%${escapeLike(value)}%`;
    return { sql: c.op === 'neq' ? `NOT ${exists}` : exists, params: [like, like] };
  }

  // text
  if (!TEXT_FIELDS.has(c.field)) throw badRequest(t(`Champ inconnu : ${c.field}`, `Unknown field: ${c.field}`));
  const value = c.value === null || c.value === undefined ? '' : String(c.value).trim().toLowerCase();
  switch (c.op) {
    case 'eq':
      return { sql: `LOWER(COALESCE(${col}, '')) = ?`, params: [value] };
    case 'neq':
      return { sql: `LOWER(COALESCE(${col}, '')) != ?`, params: [value] };
    case 'contains':
      if (!value) throw badRequest(t(`Règle « ${c.field} contains » : une valeur est requise`, `Rule “${c.field} contains”: a value is required`));
      return { sql: `LOWER(COALESCE(${col}, '')) LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(value)}%`] };
    case 'gt':
      return { sql: `LOWER(COALESCE(${col}, '')) > ?`, params: [value] };
    case 'lt':
      return { sql: `LOWER(COALESCE(${col}, '')) < ?`, params: [value] };
    default:
      throw badRequest(t(`Opérateur « ${c.op} » non supporté pour le champ « ${c.field} »`, `Operator “${c.op}” isn’t supported for field “${c.field}”`));
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * LIKE pattern that every `tags` JSON holding `tag` (any ASCII case) matches: `%"tag"%`. Only for plain
 * printable ASCII tags without quotes or backslashes, whose JSON spelling is the tag itself (LIKE folds
 * ASCII case like LOWER()); null otherwise (no shortcut, json_each alone).
 */
export function tagPrefilter(tag: string): string | null {
  return /^[\x20-\x7e]+$/.test(tag) && !/["\\]/.test(tag) ? `%"${escapeLike(tag)}"%` : null;
}

/** Compiles segment rules into a parameterized SQL boolean expression. An empty rule set matches everyone. */
export function compileRules(rules: SegmentRules): CompiledRules {
  if (!rules.conditions.length) return { sql: '1 = 1', params: [] };
  const parts = rules.conditions.map(compileCondition);
  const joiner = rules.match === 'any' ? ' OR ' : ' AND ';
  return {
    sql: `(${parts.map((p) => `(${p.sql})`).join(joiner)})`,
    params: parts.flatMap((p) => p.params),
  };
}

/** Parses + validates rules (throws 400 on invalid input) and checks they compile. */
export function validateRules(input: unknown): SegmentRules {
  const result = rulesSchema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(
      t(
        `Règles invalides — ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
        `Invalid rules — ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      ),
    );
  }
  compileRules(result.data);
  return result.data;
}

export function loadSegmentRules(db: DatabaseSync, accountId: string, segmentId: string): SegmentRules | undefined {
  const row = get<{ rules: string }>(db, 'SELECT rules FROM segments WHERE id = ? AND account_id = ?', segmentId, accountId);
  if (!row) return undefined;
  const parsed = rulesSchema.safeParse(parseJson(row.rules, {}));
  return parsed.success ? parsed.data : { match: 'all', conditions: [] };
}

export function countMatching(db: DatabaseSync, accountId: string, rules: SegmentRules, subscribedOnly = false): number {
  const { sql, params } = compileRules(rules);
  return scalar(
    db,
    `SELECT COUNT(*) AS n FROM contacts WHERE account_id = ? AND ${sql}${subscribedOnly ? " AND status = 'subscribed'" : ''}`,
    accountId,
    ...params,
  );
}

/** Read-worker task: number of contacts matching each rule set (stored JSON), in order. */
export function segmentCounts(db: DatabaseSync, accountId: string, rulesJson: string[]): number[] {
  return rulesJson.map((json) => {
    const parsed = rulesSchema.safeParse(parseJson(json, {}));
    return countMatching(db, accountId, parsed.success ? parsed.data : { match: 'all', conditions: [] });
  });
}

/** A segment's cached count is recomputed in the background once older than this. */
export const SEGMENT_COUNT_TTL_MS = 10 * 60_000;
const counting = new Map<string, Promise<number | null>>();

/**
 * Counts of the given segments rows without counting 2 M contacts on every page load: the count stored
 * on the segment (`contacts_count`, `counted_at`) is served; a missing one is computed now, off the main
 * thread; a stale one is served and refreshed in the background.
 */
export async function cachedSegmentCounts(db: DatabaseSync, accountId: string, rows: Array<Record<string, unknown>>): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const missing: Array<Record<string, unknown>> = [];
  const stale: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const id = String(r.id);
    if (r.counted_at == null || r.contacts_count == null) missing.push(r);
    else {
      out.set(id, Number(r.contacts_count));
      if (Date.now() - Date.parse(String(r.counted_at)) > SEGMENT_COUNT_TTL_MS) stale.push(r);
    }
  }
  if (stale.length) refreshSegmentCounts(db, accountId, stale).catch((err) => console.error('[segments] count refresh failed:', err));
  if (missing.length) {
    const counts = await refreshSegmentCounts(db, accountId, missing);
    missing.forEach((r, i) => out.set(String(r.id), counts[i]));
  }
  return out;
}

async function refreshSegmentCounts(db: DatabaseSync, accountId: string, rows: Array<Record<string, unknown>>): Promise<Array<number | null>> {
  const todo = rows.filter((r) => !counting.has(String(r.id)));
  if (todo.length) {
    const startedAt = now();
    for (const r of todo) {
      const id = String(r.id);
      // One task per segment: the read workers count several segments side by side.
      const p = offload(db, 'segmentCounts', accountId, [String(r.rules)]).then(
        ([count]) => {
          // Skipped if the rules changed meanwhile (that edit cleared counted_at and counts again).
          try {
            run(db, 'UPDATE segments SET contacts_count = ?, counted_at = ? WHERE id = ? AND rules = ?', count, startedAt, id, String(r.rules));
          } catch (err) {
            console.error('[segments] count not saved:', err);
          }
          return count;
        },
        (err) => {
          console.error('[segments] count failed:', err);
          return null;
        },
      );
      counting.set(id, p);
      p.finally(() => counting.delete(id)).catch(() => {});
    }
  }
  return Promise.all(rows.map((r) => counting.get(String(r.id)) ?? Promise.resolve(r.contacts_count == null ? null : Number(r.contacts_count))));
}

export function serializeSegment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name),
    rules: parseJson<SegmentRules>(row.rules, { match: 'all', conditions: [] }),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

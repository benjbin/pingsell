import { z } from 'zod';
import { get, parseJson, scalar, type DatabaseSync, type SQLInputValue } from '../db.js';
import { badRequest } from '../lib/http.js';

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
const DATE_FIELDS = new Set<Field>(['last_order_at', 'created_at']);

const ALLOWED_OPS: Record<'text' | 'number' | 'date' | 'tags', ReadonlySet<Op>> = {
  text: new Set<Op>(['eq', 'neq', 'contains', 'gt', 'lt']),
  number: new Set<Op>(['eq', 'neq', 'gt', 'lt']),
  date: new Set<Op>(['within_days', 'older_than_days', 'gt', 'lt', 'eq']),
  tags: new Set<Op>(['has_tag', 'not_has_tag', 'eq', 'neq', 'contains']),
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
  if (NUMBER_FIELDS.has(field)) return 'number';
  if (DATE_FIELDS.has(field)) return 'date';
  return 'text';
}

function requireNumber(c: SegmentCondition): number {
  const n = Number(c.value);
  if (c.value === null || c.value === undefined || c.value === '' || !Number.isFinite(n)) {
    throw badRequest(`Règle « ${c.field} ${c.op} » : une valeur numérique est requise`);
  }
  return n;
}

function requireText(c: SegmentCondition): string {
  if (c.value === null || c.value === undefined || String(c.value).trim() === '') {
    throw badRequest(`Règle « ${c.field} ${c.op} » : une valeur est requise`);
  }
  return String(c.value).trim();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function compileCondition(c: SegmentCondition): CompiledRules {
  const kind = kindOf(c.field);
  if (!ALLOWED_OPS[kind].has(c.op)) {
    throw badRequest(`Opérateur « ${c.op} » non supporté pour le champ « ${c.field} »`);
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
    return { sql: negate ? `NOT ${exists}` : exists, params: [tag] };
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

  // text
  if (!TEXT_FIELDS.has(c.field)) throw badRequest(`Champ inconnu : ${c.field}`);
  const value = c.value === null || c.value === undefined ? '' : String(c.value).trim().toLowerCase();
  switch (c.op) {
    case 'eq':
      return { sql: `LOWER(COALESCE(${col}, '')) = ?`, params: [value] };
    case 'neq':
      return { sql: `LOWER(COALESCE(${col}, '')) != ?`, params: [value] };
    case 'contains':
      if (!value) throw badRequest(`Règle « ${c.field} contains » : une valeur est requise`);
      return { sql: `LOWER(COALESCE(${col}, '')) LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(value)}%`] };
    case 'gt':
      return { sql: `LOWER(COALESCE(${col}, '')) > ?`, params: [value] };
    case 'lt':
      return { sql: `LOWER(COALESCE(${col}, '')) < ?`, params: [value] };
    default:
      throw badRequest(`Opérateur « ${c.op} » non supporté pour le champ « ${c.field} »`);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
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
    throw badRequest(`Règles invalides — ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim());
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

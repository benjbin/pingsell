import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { conflict, listResponse, notFound, pagination, parse, zmsg } from '../lib/http.js';
import { serializeContact } from '../services/contacts.js';
import { offload } from '../lib/offload.js';
import { cachedSegmentCounts, compileRules, serializeSegment, validateRules } from '../services/segments.js';
import { t } from '../i18n.js';

const createSchema = z.object({
  name: z.string().trim().min(1, zmsg('Le nom est requis', 'Name is required')).max(120),
  rules: z.unknown(),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rules: z.unknown().optional(),
});
const previewSchema = z.object({ rules: z.unknown() });

type Params = { Params: { id: string } };

export async function segmentRoutes(app: FastifyInstance, { db }: Deps) {
  /** `count` is the cached count (see cachedSegmentCounts), `count_updated_at` says when it was computed. */
  const withCounts = async (accountId: string, rows: Array<Record<string, unknown>>) => {
    const counts = await cachedSegmentCounts(db, accountId, rows);
    const fresh = new Map(
      rows.length ? all<{ id: string; counted_at: string | null }>(db, `SELECT id, counted_at FROM segments WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => String(r.id))).map((r) => [r.id, r.counted_at]) : [],
    );
    return rows.map((row) => {
      const segment = serializeSegment(row);
      return { ...segment, count: counts.get(segment.id) ?? 0, count_updated_at: fresh.get(segment.id) ?? null };
    });
  };
  const withCount = async (accountId: string, row: Record<string, unknown>) => (await withCounts(accountId, [row]))[0];

  app.get('/segments', async (request) => {
    const p = pagination(request.query);
    const total = scalar(db, 'SELECT COUNT(*) FROM segments WHERE account_id = ?', request.accountId);
    const rows = all(
      db,
      'SELECT * FROM segments WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      request.accountId,
      p.limit,
      p.offset,
    );
    return listResponse(await withCounts(request.accountId, rows), total, p);
  });

  app.post('/segments', async (request, reply) => {
    const body = parse(createSchema, request.body);
    const rules = validateRules(body.rules);
    const id = newId();
    const timestamp = now();
    run(
      db,
      'INSERT INTO segments (id, account_id, name, rules, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      request.accountId,
      body.name,
      JSON.stringify(rules),
      timestamp,
      timestamp,
    );
    return reply.code(201).send(await withCount(request.accountId, get(db, 'SELECT * FROM segments WHERE id = ?', id)!));
  });

  // Declared before `/segments/:id` for readability; Fastify always prefers static routes anyway.
  app.post('/segments/preview', async (request) => {
    const body = parse(previewSchema, request.body);
    const rules = validateRules(body.rules);
    const { sql, params } = compileRules(rules);
    // Counting up to 2 M contacts against arbitrary rules takes a while: off the main thread.
    const [countRow, sample] = await Promise.all([
      offload(db, 'get', `SELECT COUNT(*) AS n FROM contacts WHERE account_id = ? AND ${sql}`, [request.accountId, ...params]),
      offload(db, 'all', `SELECT * FROM contacts WHERE account_id = ? AND ${sql} ORDER BY created_at DESC LIMIT 10`, [request.accountId, ...params]),
    ]);
    return { count: Number(countRow?.n ?? 0), sample: sample.map(serializeContact) };
  });

  app.get<Params>('/segments/:id', async (request) => {
    const row = get(db, 'SELECT * FROM segments WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!row) throw notFound(t('Segment introuvable', 'Segment not found'));
    return await withCount(request.accountId, row);
  });

  app.patch<Params>('/segments/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const row = get(db, 'SELECT * FROM segments WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!row) throw notFound(t('Segment introuvable', 'Segment not found'));
    const segment = serializeSegment(row);
    const rules = body.rules !== undefined ? validateRules(body.rules) : segment.rules;
    run(
      db,
      // New rules: the cached count is dropped (recomputed below).
      'UPDATE segments SET name = ?, rules = ?, updated_at = ?, counted_at = CASE WHEN rules = ? THEN counted_at END WHERE id = ?',
      body.name ?? segment.name,
      JSON.stringify(rules),
      now(),
      JSON.stringify(rules),
      segment.id,
    );
    return await withCount(request.accountId, get(db, 'SELECT * FROM segments WHERE id = ?', segment.id)!);
  });

  app.delete<Params>('/segments/:id', async (request, reply) => {
    const inUse = scalar(
      db,
      "SELECT COUNT(*) FROM campaigns WHERE segment_id = ? AND account_id = ? AND status IN ('scheduled','sending')",
      request.params.id,
      request.accountId,
    );
    if (inUse) throw conflict(t('Ce segment est utilisé par une campagne programmée ou en cours d’envoi', 'This segment is used by a scheduled or sending campaign'));
    const changes = transaction(db, () => {
      // Drafts targeting this segment are detached (they will need a new audience before sending).
      run(
        db,
        "UPDATE campaigns SET segment_id = NULL, updated_at = ? WHERE segment_id = ? AND account_id = ? AND status = 'draft'",
        now(),
        request.params.id,
        request.accountId,
      );
      return run(db, 'DELETE FROM segments WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    });
    if (!changes) throw notFound(t('Segment introuvable', 'Segment not found'));
    return reply.code(204).send();
  });
}

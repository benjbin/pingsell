import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { conflict, listResponse, notFound, pagination, parse } from '../lib/http.js';
import { serializeContact } from '../services/contacts.js';
import { compileRules, countMatching, serializeSegment, validateRules } from '../services/segments.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(120),
  rules: z.unknown(),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rules: z.unknown().optional(),
});
const previewSchema = z.object({ rules: z.unknown() });

type Params = { Params: { id: string } };

export async function segmentRoutes(app: FastifyInstance, { db }: Deps) {
  const withCount = (accountId: string, row: Record<string, unknown>) => {
    const segment = serializeSegment(row);
    return { ...segment, count: countMatching(db, accountId, segment.rules) };
  };

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
    return listResponse(
      rows.map((r) => withCount(request.accountId, r)),
      total,
      p,
    );
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
    return reply.code(201).send(withCount(request.accountId, get(db, 'SELECT * FROM segments WHERE id = ?', id)!));
  });

  // Declared before `/segments/:id` for readability; Fastify always prefers static routes anyway.
  app.post('/segments/preview', async (request) => {
    const body = parse(previewSchema, request.body);
    const rules = validateRules(body.rules);
    const { sql, params } = compileRules(rules);
    const count = scalar(db, `SELECT COUNT(*) FROM contacts WHERE account_id = ? AND ${sql}`, request.accountId, ...params);
    const sample = all(
      db,
      `SELECT * FROM contacts WHERE account_id = ? AND ${sql} ORDER BY created_at DESC LIMIT 10`,
      request.accountId,
      ...params,
    ).map(serializeContact);
    return { count, sample };
  });

  app.get<Params>('/segments/:id', async (request) => {
    const row = get(db, 'SELECT * FROM segments WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!row) throw notFound('Segment introuvable');
    return withCount(request.accountId, row);
  });

  app.patch<Params>('/segments/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const row = get(db, 'SELECT * FROM segments WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!row) throw notFound('Segment introuvable');
    const segment = serializeSegment(row);
    const rules = body.rules !== undefined ? validateRules(body.rules) : segment.rules;
    run(
      db,
      'UPDATE segments SET name = ?, rules = ?, updated_at = ? WHERE id = ?',
      body.name ?? segment.name,
      JSON.stringify(rules),
      now(),
      segment.id,
    );
    return withCount(request.accountId, get(db, 'SELECT * FROM segments WHERE id = ?', segment.id)!);
  });

  app.delete<Params>('/segments/:id', async (request, reply) => {
    const inUse = scalar(
      db,
      "SELECT COUNT(*) FROM campaigns WHERE segment_id = ? AND account_id = ? AND status IN ('scheduled','sending')",
      request.params.id,
      request.accountId,
    );
    if (inUse) throw conflict('Ce segment est utilisé par une campagne programmée ou en cours d’envoi');
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
    if (!changes) throw notFound('Segment introuvable');
    return reply.code(204).send();
  });
}

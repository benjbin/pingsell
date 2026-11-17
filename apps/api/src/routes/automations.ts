import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, transaction, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, listResponse, notFound, pagination, parse } from '../lib/http.js';
import {
  TRIGGERS,
  automationStats,
  serializeAutomation,
  stepsSchema,
  triggerConfigSchema,
} from '../services/automations.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(200),
  trigger: z.enum(TRIGGERS),
  trigger_config: triggerConfigSchema.optional(),
  steps: stepsSchema,
  status: z.enum(['active', 'paused']).optional(),
});
const patchSchema = createSchema.partial();

type Params = { Params: { id: string } };

export async function automationRoutes(app: FastifyInstance, { db }: Deps) {
  const load = (accountId: string, id: string) => {
    const row = get(db, 'SELECT * FROM automations WHERE id = ? AND account_id = ?', id, accountId);
    if (!row) throw notFound('Automatisation introuvable');
    return serializeAutomation(row);
  };
  const withStats = (accountId: string, id: string) => {
    const automation = load(accountId, id);
    return { ...automation, ...automationStats(db, automation.id) };
  };
  const assertTagConfig = (trigger: string, config: { tag?: string } | undefined) => {
    if (trigger === 'tag_added' && !config?.tag) {
      throw badRequest('Le déclencheur « tag ajouté » nécessite trigger_config.tag');
    }
  };

  app.get('/automations', async (request) => {
    const p = pagination(request.query);
    const total = scalar(db, 'SELECT COUNT(*) FROM automations WHERE account_id = ?', request.accountId);
    const rows = all(
      db,
      'SELECT * FROM automations WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      request.accountId,
      p.limit,
      p.offset,
    ).map(serializeAutomation);
    return listResponse(
      rows.map((a) => ({ ...a, ...automationStats(db, a.id) })),
      total,
      p,
    );
  });

  app.post('/automations', async (request, reply) => {
    const body = parse(createSchema, request.body);
    assertTagConfig(body.trigger, body.trigger_config);
    const id = newId();
    const timestamp = now();
    run(
      db,
      `INSERT INTO automations (id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      request.accountId,
      body.name,
      body.trigger,
      JSON.stringify(body.trigger_config ?? {}),
      JSON.stringify(body.steps),
      body.status ?? 'active',
      timestamp,
      timestamp,
    );
    return reply.code(201).send(withStats(request.accountId, id));
  });

  app.get<Params>('/automations/:id', async (request) => {
    const automation = withStats(request.accountId, request.params.id);
    const recent_runs = all(
      db,
      `SELECT r.id, r.contact_id, c.email, r.step_index, r.next_run_at, r.status, r.created_at
         FROM automation_runs r LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.automation_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      automation.id,
    );
    return { ...automation, recent_runs };
  });

  app.patch<Params>('/automations/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const automation = load(request.accountId, request.params.id);
    const trigger = body.trigger ?? automation.trigger;
    assertTagConfig(trigger, body.trigger_config ?? automation.trigger_config);

    const updates: Record<string, SQLInputValue> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.trigger !== undefined) updates.trigger = body.trigger;
    if (body.trigger_config !== undefined) updates.trigger_config = JSON.stringify(body.trigger_config);
    if (body.steps !== undefined) updates.steps = JSON.stringify(body.steps);
    if (body.status !== undefined) updates.status = body.status;
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        db,
        `UPDATE automations SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...keys.map((k) => updates[k]),
        now(),
        automation.id,
      );
    }
    return withStats(request.accountId, automation.id);
  });

  app.delete<Params>('/automations/:id', async (request, reply) => {
    const automation = load(request.accountId, request.params.id);
    transaction(db, () => {
      run(db, 'DELETE FROM automation_runs WHERE automation_id = ?', automation.id);
      run(db, 'DELETE FROM automations WHERE id = ?', automation.id);
    });
    return reply.code(204).send();
  });

  const setStatus = (status: 'active' | 'paused') => async (request: { accountId: string; params: { id: string } }) => {
    const automation = load(request.accountId, request.params.id);
    run(db, 'UPDATE automations SET status = ?, updated_at = ? WHERE id = ?', status, now(), automation.id);
    return withStats(request.accountId, automation.id);
  };
  app.post<Params>('/automations/:id/activate', setStatus('active'));
  app.post<Params>('/automations/:id/pause', setStatus('paused'));
}

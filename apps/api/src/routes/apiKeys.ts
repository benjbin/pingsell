import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, run } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, parse } from '../lib/http.js';
import { createApiKey } from '../services/auth.js';

const createSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est requis').max(80).default('Clé API'),
});

interface ApiKeyRow {
  id: string;
  key: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

function maskKey(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export async function apiKeyRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/api-keys', async (request) => {
    const rows = all<ApiKeyRow>(
      db,
      'SELECT id, key, label, created_at, last_used_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC',
      request.accountId,
    );
    return {
      data: rows.map(({ key, ...rest }) => ({ ...rest, key_preview: maskKey(key) })),
    };
  });

  app.post('/api-keys', async (request, reply) => {
    const { label } = parse(createSchema, request.body);
    const record = createApiKey(db, request.accountId, label);
    // The full key is only ever returned here.
    return reply.code(201).send({
      id: record.id,
      label: record.label,
      key: record.key,
      key_preview: maskKey(record.key),
      created_at: record.created_at,
      last_used_at: null,
    });
  });

  app.delete<{ Params: { id: string } }>('/api-keys/:id', async (request, reply) => {
    const changes = run(db, 'DELETE FROM api_keys WHERE id = ? AND account_id = ?', request.params.id, request.accountId);
    if (!changes) throw notFound('Clé API introuvable');
    return reply.code(204).send();
  });
}

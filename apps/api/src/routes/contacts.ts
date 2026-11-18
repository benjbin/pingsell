import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, parseJson, run, scalar, transaction, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { csvToContacts } from '../lib/csv.js';
import { badRequest, conflict, listResponse, notFound, pagination, parse, queryString } from '../lib/http.js';
import { cancelRunsForContact } from '../services/automations.js';
import { contactVisits } from '../services/webTracking.js';
import {
  CONTACT_STATUSES,
  findContact,
  findContactByEmail,
  isValidEmail,
  normalizeEmail,
  normalizeTags,
  recordEvent,
  serializeContact,
  updateContactColumns,
  upsertContact,
  type Contact,
} from '../services/contacts.js';
import { compileRules, loadSegmentRules } from '../services/segments.js';
import { serializeMessage } from '../services/messages.js';
import { t } from '../i18n.js';
import { upsertCart } from '../services/carts.js';
import { cartSchema, contactInputSchema, createIngest, orderSchema } from '../services/ingest.js';

const patchSchema = contactInputSchema.partial();

const tagsSchema = z.object({
  add: z.array(z.string().max(64)).max(100).optional(),
  remove: z.array(z.string().max(64)).max(100).optional(),
});

const importSchema = z.union([
  z.object({
    contacts: z.array(z.record(z.string(), z.unknown())).max(50_000),
    trigger_automations: z.boolean().optional(),
  }),
  z.object({ csv: z.string().min(1).max(20_000_000), trigger_automations: z.boolean().optional() }),
]);

type Params = { Params: { id: string } };

export async function contactRoutes(app: FastifyInstance, { db }: Deps) {
  const { saveContact, placeOrder, ingestEvent, onCreated, onTagsAdded } = createIngest(db);

  app.get('/contacts', async (request) => {
    const p = pagination(request.query);
    const where: string[] = ['account_id = ?'];
    const params: SQLInputValue[] = [request.accountId];

    const search = queryString(request.query, 'search');
    if (search) {
      const like = `%${search.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push(
        `(ULOWER(email) LIKE ? ESCAPE '\\' OR ULOWER(COALESCE(first_name, '')) LIKE ? ESCAPE '\\'
          OR ULOWER(COALESCE(last_name, '')) LIKE ? ESCAPE '\\'
          OR ULOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(like, like, like, like);
    }
    const tag = queryString(request.query, 'tag');
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM json_each(contacts.tags) WHERE LOWER(json_each.value) = ?)');
      params.push(tag.toLowerCase());
    }
    const status = queryString(request.query, 'status');
    if (status) {
      if (!(CONTACT_STATUSES as readonly string[]).includes(status)) throw badRequest(t('Statut inconnu', 'Unknown status'));
      where.push('status = ?');
      params.push(status);
    }
    const segmentId = queryString(request.query, 'segment_id');
    if (segmentId) {
      const rules = loadSegmentRules(db, request.accountId, segmentId);
      if (!rules) throw notFound(t('Segment introuvable', 'Segment not found'));
      const compiled = compileRules(rules);
      where.push(compiled.sql);
      params.push(...compiled.params);
    }

    const whereSql = where.join(' AND ');
    const total = scalar(db, `SELECT COUNT(*) FROM contacts WHERE ${whereSql}`, ...params);
    const rows = all(
      db,
      `SELECT * FROM contacts WHERE ${whereSql} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      ...params,
      p.limit,
      p.offset,
    );
    return listResponse(rows.map(serializeContact), total, p);
  });

  app.post('/contacts', async (request, reply) => {
    const body = parse(contactInputSchema, request.body);
    const result = saveContact(request.accountId, body);
    return reply.code(result.created ? 201 : 200).send({ ...result.contact, created: result.created });
  });

  app.post('/carts', async (request, reply) => {
    const body = parse(cartSchema, request.body);
    if (!isValidEmail(normalizeEmail(body.email))) throw badRequest(t(`Adresse email invalide : ${body.email}`, `Invalid email address: ${body.email}`));
    const result = upsertCart(db, request.accountId, { ...body, email: normalizeEmail(body.email) });
    return reply.code(result === 'created' ? 201 : 200).send({ ok: true, status: result === 'closed' ? 'closed' : 'pending' });
  });

  app.post('/orders', async (request, reply) => {
    const body = parse(orderSchema, request.body);
    const result = placeOrder(request.accountId, body);
    if (result.skipped) {
      return reply.code(200).send({
        ok: true,
        skipped: true,
        message: t(
          "Contact inconnu : envoyez d'abord la commande (status « created ») ou créez le contact, puis l'expédition.",
          'Unknown contact: send the order first (status "created") or create the contact, then the shipment.',
        ),
      });
    }
    return reply.code(result.duplicate ? 200 : 201).send({ ok: true, contact_id: result.contact!.id, duplicate: result.duplicate });
  });

  /** The single call a website needs: see services/ingest.ts. */
  app.post('/events', async (request, reply) => {
    const r = ingestEvent(request.accountId, (request.body ?? {}) as Record<string, unknown>);
    return reply.code(r.code).send(r.body);
  });

  app.get<Params>('/contacts/:id', async (request) => {
    const contact = findContact(db, request.accountId, request.params.id);
    if (!contact) throw notFound(t('Contact introuvable', 'Contact not found'));
    const events = all(
      db,
      'SELECT id, type, data, created_at FROM events WHERE contact_id = ? AND account_id = ? ORDER BY created_at DESC LIMIT 50',
      contact.id,
      request.accountId,
    ).map((e) => ({ id: e.id, type: e.type, data: parseJson(e.data, {}), created_at: e.created_at }));
    const messages = all(
      db,
      'SELECT * FROM messages WHERE contact_id = ? AND account_id = ? ORDER BY created_at DESC LIMIT 20',
      contact.id,
      request.accountId,
    ).map((m) => serializeMessage(m, false));
    return { ...contact, events, messages, site: contactVisits(db, request.accountId, contact.id, 30) };
  });

  app.patch<Params>('/contacts/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const existing = findContact(db, request.accountId, request.params.id);
    if (!existing) throw notFound(t('Contact introuvable', 'Contact not found'));

    const updates: Record<string, SQLInputValue> = {};
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw badRequest(t('Adresse email invalide', 'Invalid email address'));
      const other = findContactByEmail(db, request.accountId, email);
      if (other && other.id !== existing.id) throw conflict(t('Un autre contact utilise déjà cette adresse email', 'Another contact already uses this email address'));
      updates.email = email;
    }
    for (const key of ['first_name', 'last_name', 'phone'] as const) {
      if (body[key] !== undefined) updates[key] = body[key] ? body[key] : null;
    }
    let addedTags: string[] = [];
    if (body.tags !== undefined) {
      const tags = normalizeTags(body.tags);
      addedTags = tags.filter((t) => !existing.tags.includes(t));
      updates.tags = JSON.stringify(tags);
    }
    if (body.attributes !== undefined) updates.attributes = JSON.stringify(body.attributes);
    if (body.status !== undefined) updates.status = body.status;

    transaction(db, () => {
      updateContactColumns(db, existing.id, updates);
      if (body.status && body.status !== 'subscribed') cancelRunsForContact(db, existing.id);
      if (body.status === 'unsubscribed' && existing.status !== 'unsubscribed') {
        recordEvent(db, request.accountId, existing.id, 'unsubscribe', { source: 'manual' });
      }
      onTagsAdded(request.accountId, existing.id, addedTags);
    });
    return findContact(db, request.accountId, existing.id);
  });

  app.delete<Params>('/contacts/:id', async (request, reply) => {
    const contact = findContact(db, request.accountId, request.params.id);
    if (!contact) throw notFound(t('Contact introuvable', 'Contact not found'));
    transaction(db, () => {
      run(db, 'DELETE FROM events WHERE contact_id = ? AND account_id = ?', contact.id, request.accountId);
      run(db, 'DELETE FROM contacts WHERE id = ?', contact.id);
    });
    return reply.code(204).send();
  });

  app.post<Params>('/contacts/:id/tags', async (request) => {
    const body = parse(tagsSchema, request.body);
    const contact = findContact(db, request.accountId, request.params.id);
    if (!contact) throw notFound(t('Contact introuvable', 'Contact not found'));
    const remove = new Set(normalizeTags(body.remove));
    const add = normalizeTags(body.add).filter((t) => !contact.tags.includes(t));
    const tags = [...contact.tags.filter((t) => !remove.has(t)), ...add.filter((t) => !remove.has(t))];
    transaction(db, () => {
      updateContactColumns(db, contact.id, { tags: JSON.stringify(tags) });
      onTagsAdded(request.accountId, contact.id, add.filter((t) => !remove.has(t)));
    });
    return findContact(db, request.accountId, contact.id);
  });

  app.post('/contacts/import', async (request) => {
    const body = parse(importSchema, request.body);
    const triggers = body.trigger_automations === true;
    const inputs: { row: number; data: Record<string, unknown> }[] =
      'csv' in body
        ? csvToContacts(body.csv).map(({ row, ...data }) => ({ row, data }))
        : body.contacts.map((data, i) => ({ row: i + 1, data }));
    if (inputs.length > 50_000) throw badRequest(t('Import limité à 50 000 contacts par requête', 'Imports are limited to 50,000 contacts per request'));

    let created = 0;
    let updated = 0;
    const errorDetails: { row: number; email: string | null; error: string }[] = [];

    transaction(db, () => {
      for (const { row, data } of inputs) {
        const parsed = contactInputSchema.safeParse(data);
        if (!parsed.success) {
          errorDetails.push({
            row,
            email: typeof data.email === 'string' ? data.email : null,
            error: parsed.error.issues[0]?.message ?? t('Ligne invalide', 'Invalid row'),
          });
          continue;
        }
        try {
          const r = upsertContact(db, request.accountId, { ...parsed.data, source: 'import' });
          if (r.created) {
            created++;
            onCreated(request.accountId, r.contact, triggers);
          } else updated++;
          if (triggers) onTagsAdded(request.accountId, r.contact.id, r.created ? r.contact.tags : r.addedTags);
        } catch (err) {
          errorDetails.push({ row, email: parsed.data.email, error: (err as Error).message });
        }
      }
    });

    return { created, updated, errors: errorDetails.length, error_details: errorDetails.slice(0, 100) };
  });

  app.get('/tags', async (request) => {
    const rows = all<{ tag: string; count: number }>(
      db,
      `SELECT LOWER(j.value) AS tag, COUNT(DISTINCT c.id) AS count
         FROM contacts c, json_each(c.tags) j
        WHERE c.account_id = ?
        GROUP BY LOWER(j.value)
        ORDER BY count DESC, tag ASC`,
      request.accountId,
    );
    return { data: rows.map((r) => ({ tag: r.tag, count: Number(r.count) })) };
  });
}

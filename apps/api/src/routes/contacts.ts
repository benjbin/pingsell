import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, parseJson, run, scalar, transaction, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { csvToContactsWithColumns } from '../lib/csv.js';
import { badRequest, conflict, listResponse, notFound, pagination, parse, queryString } from '../lib/http.js';
import { cancelRunsForContact } from '../services/automations.js';
import { contactVisits } from '../services/webTracking.js';
import {
  CONTACT_STATUSES,
  contactSearchSql,
  findContact,
  findContactByEmail,
  isValidEmail,
  normalizeEmail,
  normalizeTags,
  recordEvent,
  serializeContact,
  startContactSearchBackfill,
  updateContactColumns,
  upsertContact,
  type Contact,
} from '../services/contacts.js';
import { compileRules, loadSegmentRules, tagPrefilter } from '../services/segments.js';
import { memo, memoInvalidate, offload } from '../lib/offload.js';
import { serializeMessage } from '../services/messages.js';
import { t } from '../i18n.js';
import { upsertCart } from '../services/carts.js';
import { cartSchema, contactInputSchema, createIngest, orderSchema } from '../services/ingest.js';

const patchSchema = contactInputSchema.partial();

const tagsSchema = z.object({
  add: z.array(z.string().max(64)).max(100).optional(),
  remove: z.array(z.string().max(64)).max(100).optional(),
});

/** One import transaction: at most this many rows, or this many milliseconds of work. */
const IMPORT_CHUNK_ROWS = 500;
const IMPORT_CHUNK_MS = 40;
const IMPORT_MAX_ROWS = 50_000;
/** A search's `total` stops at this many contacts (`total_capped: true` beyond). */
const SEARCH_COUNT_CAP = 10_000;
const tooManyRows = () => t('Import limité à 50 000 contacts par requête', 'Imports are limited to 50,000 contacts per request');

const importSchema = z.union([
  z.object({
    contacts: z.array(z.record(z.string(), z.unknown())).max(IMPORT_MAX_ROWS),
    trigger_automations: z.boolean().optional(),
  }),
  z.object({ csv: z.string().min(1).max(20_000_000), trigger_automations: z.boolean().optional() }),
]);

type Params = { Params: { id: string } };

const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}~${id}`).toString('base64url');
function decodeCursor(value: string | undefined): { created_at: string; id: string } | null {
  if (!value) return null;
  const [created_at, id] = Buffer.from(value, 'base64url').toString('utf8').split('~');
  if (!created_at || !id) throw badRequest(t('Curseur de pagination invalide', 'Invalid pagination cursor'));
  return { created_at, id };
}

export async function contactRoutes(app: FastifyInstance, { db }: Deps) {
  const { saveContact, placeOrder, ingestEvent, onCreated, onTagsAdded } = createIngest(db);
  // Contacts that predate the search index are indexed in the background, in short batches.
  setTimeout(() => startContactSearchBackfill(db).catch((err) => console.error('[contacts] search index backfill failed:', err)), 1000).unref();

  app.get('/contacts', async (request) => {
    const p = pagination(request.query);
    const where: string[] = ['account_id = ?'];
    const params: SQLInputValue[] = [request.accountId];

    const search = queryString(request.query, 'search');
    if (search) {
      const s = contactSearchSql(db, search);
      // The index's few rowids lead (`+account_id`: not a walk of every contact of the account).
      if (s.indexed) where[0] = '+account_id = ?';
      where.push(s.sql);
      params.push(...s.params);
    }
    // `ids=a,b,c`: fetch given contacts (e.g. those picked for a campaign).
    const ids = queryString(request.query, 'ids');
    if (ids) {
      const list = [...new Set(ids.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
      if (list.length) {
        where.push(`id IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
      }
    }
    const tag = queryString(request.query, 'tag');
    if (tag) {
      const pre = tagPrefilter(tag.toLowerCase());
      if (pre) {
        where.push("contacts.tags LIKE ? ESCAPE '\\'");
        params.push(pre);
      }
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
    // Keyset pagination (`cursor` = the `next_cursor` of the previous page): no OFFSET walk on deep pages.
    const cursor = decodeCursor(queryString(request.query, 'cursor'));
    const pageSql = cursor ? `${whereSql} AND (created_at < ? OR (created_at = ? AND id > ?))` : whereSql;
    const pageParams = cursor ? [...params, cursor.created_at, cursor.created_at, cursor.id] : params;
    // Counting / filtering up to 2 M contacts (search, tag, segment) runs off the main thread. A search (one
    // request per keystroke) is counted up to SEARCH_COUNT_CAP only: `total_capped` then says « more than ».
    const countSql = search
      ? `SELECT COUNT(*) AS n FROM (SELECT 1 FROM contacts WHERE ${whereSql} LIMIT ${SEARCH_COUNT_CAP + 1})`
      : `SELECT COUNT(*) AS n FROM contacts WHERE ${whereSql}`;
    const [count, rows] = await Promise.all([
      offload(db, 'get', countSql, params),
      offload(db, 'all', `SELECT * FROM contacts WHERE ${pageSql} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [
        ...pageParams,
        p.limit,
        cursor ? 0 : p.offset,
      ]),
    ]);
    const last = rows.length === p.limit ? rows[rows.length - 1] : undefined;
    const total = Number(count?.n ?? 0);
    const capped = !!search && total > SEARCH_COUNT_CAP;
    return {
      ...listResponse(rows.map(serializeContact), capped ? SEARCH_COUNT_CAP : total, p),
      total_capped: capped,
      next_cursor: last ? encodeCursor(String(last.created_at), String(last.id)) : null,
    };
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
      // `+account_id`: this contact's few messages (idx_messages_contact), not a walk of the account's by date.
      'SELECT * FROM messages WHERE contact_id = ? AND +account_id = ? ORDER BY created_at DESC LIMIT 20',
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
    if (body.tags !== undefined) memoInvalidate(`tags:${request.accountId}`);
    return findContact(db, request.accountId, existing.id);
  });

  app.delete<Params>('/contacts/:id', async (request, reply) => {
    const contact = findContact(db, request.accountId, request.params.id);
    if (!contact) throw notFound(t('Contact introuvable', 'Contact not found'));
    transaction(db, () => {
      // `+account_id`: never let the planner walk every event of the account instead of this contact's few (idx_events_contact).
      run(db, 'DELETE FROM events WHERE contact_id = ? AND +account_id = ?', contact.id, request.accountId);
      run(db, 'DELETE FROM contacts WHERE id = ?', contact.id);
    });
    if (contact.tags.length) memoInvalidate(`tags:${request.accountId}`);
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
    memoInvalidate(`tags:${request.accountId}`);
    return findContact(db, request.accountId, contact.id);
  });

  app.post('/contacts/import', async (request) => {
    const body = parse(importSchema, request.body);
    const triggers = body.trigger_automations === true;
    let inputs: { row: number; data: Record<string, unknown> }[];
    if ('csv' in body) {
      const file = csvToContactsWithColumns(body.csv, IMPORT_MAX_ROWS);
      if (file.tooMany) throw badRequest(tooManyRows());
      if (file.rows.length && !file.hasEmail)
        throw badRequest(
          t(
            `Aucune colonne d'adresses email trouvée dans ce fichier (colonnes : ${file.headers.join(', ')}). Ajoutez une colonne « email ».`,
            `No email address column found in this file (columns: ${file.headers.join(', ')}). Add an "email" column.`,
          ),
        );
      inputs = file.rows.map(({ row, ...data }) => ({ row, data }));
    } else inputs = body.contacts.map((data, i) => ({ row: i + 1, data }));
    if (inputs.length > IMPORT_MAX_ROWS) throw badRequest(tooManyRows());

    let created = 0;
    let updated = 0;
    let noEmail = 0;
    const errorDetails: { row: number; email: string | null; error: string }[] = [];
    // Same address twice in the file (case and spaces ignored): only the first row is kept, the others are reported.
    const firstRow = new Map<string, number>();
    const duplicateDetails: { row: number; email: string; first_row: number }[] = [];

    const importRow = (row: number, data: Record<string, unknown>) => {
      // No address: nothing to write to, the row is set aside (counted, not an error).
      if (typeof data.email !== 'string' || data.email.trim() === '' || /^(null|n\/a|none|undefined|-)$/i.test(data.email.trim())) {
        noEmail++;
        return;
      }
      const parsed = contactInputSchema.safeParse(data);
      if (!parsed.success) {
        errorDetails.push({
          row,
          email: typeof data.email === 'string' ? data.email : null,
          error: parsed.error.issues[0]?.message ?? t('Ligne invalide', 'Invalid row'),
        });
        return;
      }
      const key = normalizeEmail(parsed.data.email);
      const first = firstRow.get(key);
      if (first !== undefined) {
        duplicateDetails.push({ row, email: key, first_row: first });
        return;
      }
      firstRow.set(key, row);
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
    };

    // Short transactions (<= IMPORT_CHUNK_ROWS rows or ~IMPORT_CHUNK_MS) with a yield in between: a 50,000-row
    // import no longer holds the write lock and the event loop for 10 s, other requests are served meanwhile.
    for (let i = 0; i < inputs.length; ) {
      const started = performance.now();
      transaction(db, () => {
        for (; i < inputs.length; ) {
          const { row, data } = inputs[i++];
          importRow(row, data);
          if (i % IMPORT_CHUNK_ROWS === 0 || performance.now() - started > IMPORT_CHUNK_MS) break;
        }
      });
      if (i < inputs.length) await new Promise((r) => setImmediate(r));
    }
    memoInvalidate(`tags:${request.accountId}`);

    return {
      created,
      updated,
      duplicates: duplicateDetails.length,
      duplicate_details: duplicateDetails.slice(0, 100),
      skipped_no_email: noEmail,
      errors: errorDetails.length,
      error_details: errorDetails.slice(0, 100),
    };
  });

  // json_each over every contact of the account: off the main thread, cached (a tag edit refreshes it).
  app.get('/tags', async (request) => ({
    data: await memo(`tags:${request.accountId}`, 5 * 60_000, 3600_000, () => offload(db, 'tagCounts', request.accountId)),
  }));
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, transaction, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, listResponse, notFound, pagination, parse, queryString } from '../lib/http.js';
import {
  CAMPAIGN_STATUSES,
  audienceCount,
  campaignStatsDetail,
  campaignStatsMap,
  campaignStatsSummary,
  serializeCampaign,
} from '../services/campaigns.js';
import { findContactByEmail, isValidEmail, normalizeEmail } from '../services/contacts.js';
import { accountSender, createMessage, markFailed, markSent } from '../services/messages.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(200),
  subject: z.string().trim().max(300).optional(),
  preheader: nullableText(300),
  from_name: nullableText(120),
  from_email: z.email('Adresse expéditeur invalide').nullable().optional(),
  html: z.string().max(1_000_000).nullable().optional(),
  design: z.string().max(2_000_000).nullable().optional(),
  segment_id: z.string().trim().min(1).nullable().optional(),
});
const patchSchema = createSchema.partial();
const testSchema = z.object({ to: z.string().trim().min(1, 'Destinataire requis') });
const scheduleSchema = z.object({ scheduled_at: z.iso.datetime({ offset: true, message: 'Date ISO 8601 attendue' }) });

type Params = { Params: { id: string } };

export async function campaignRoutes(app: FastifyInstance, { db, config, provider, kickWorker }: Deps) {
  const load = (accountId: string, id: string) => {
    const row = get(db, 'SELECT * FROM campaigns WHERE id = ? AND account_id = ?', id, accountId);
    if (!row) throw notFound('Campagne introuvable');
    return serializeCampaign(row);
  };

  const assertSegment = (accountId: string, segmentId: string | null | undefined) => {
    if (segmentId && !get(db, 'SELECT id FROM segments WHERE id = ? AND account_id = ?', segmentId, accountId)) {
      throw badRequest('Segment introuvable');
    }
  };

  const withStats = (accountId: string, id: string) => {
    const campaign = load(accountId, id);
    return { ...campaign, stats: campaignStatsSummary(db, id) };
  };

  /** Preconditions shared by send + schedule. */
  const assertSendable = (campaign: ReturnType<typeof serializeCampaign>) => {
    if (!campaign.subject.trim()) throw badRequest("L'objet de la campagne est requis");
    if (!campaign.html?.trim()) throw badRequest('Le contenu HTML de la campagne est requis');
    if (campaign.segment_id) assertSegment(campaign.account_id, campaign.segment_id);
    if (audienceCount(db, campaign.account_id, campaign.segment_id) === 0) {
      throw badRequest('Aucun destinataire abonné ne correspond à cette audience');
    }
  };

  app.get('/campaigns', async (request) => {
    const p = pagination(request.query);
    const where = ['account_id = ?'];
    const params: SQLInputValue[] = [request.accountId];
    const status = queryString(request.query, 'status');
    if (status) {
      if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) throw badRequest('Statut inconnu');
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = where.join(' AND ');
    const total = scalar(db, `SELECT COUNT(*) FROM campaigns WHERE ${whereSql}`, ...params);
    const rows = all(
      db,
      `SELECT * FROM campaigns WHERE ${whereSql}
        ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC, created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      p.limit,
      p.offset,
    ).map(serializeCampaign);
    const stats = campaignStatsMap(
      db,
      rows.map((c) => c.id),
    );
    const empty = { recipients: 0, sent: 0, opened: 0, clicked: 0, open_rate: 0, click_rate: 0 };
    return listResponse(
      rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? empty })),
      total,
      p,
    );
  });

  app.post('/campaigns', async (request, reply) => {
    const body = parse(createSchema, request.body);
    assertSegment(request.accountId, body.segment_id);
    const sender = accountSender(db, config, request.accountId);
    const id = newId();
    const timestamp = now();
    run(
      db,
      `INSERT INTO campaigns (id, account_id, name, subject, preheader, from_name, from_email, html, design, segment_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      request.accountId,
      body.name,
      body.subject ?? '',
      body.preheader ?? null,
      body.from_name || sender.name,
      body.from_email || sender.email,
      body.html ?? null,
      body.design ?? null,
      body.segment_id ?? null,
      timestamp,
      timestamp,
    );
    return reply.code(201).send(withStats(request.accountId, id));
  });

  app.get<Params>('/campaigns/:id', async (request) => withStats(request.accountId, request.params.id));

  app.patch<Params>('/campaigns/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'draft') throw conflict('Seules les campagnes en brouillon sont modifiables');
    if (body.segment_id !== undefined) assertSegment(request.accountId, body.segment_id);
    const updates: Record<string, SQLInputValue> = {};
    for (const key of ['name', 'subject', 'preheader', 'from_name', 'from_email', 'html', 'design', 'segment_id'] as const) {
      if (body[key] !== undefined) updates[key] = key === 'subject' ? (body.subject ?? '') : (body[key] ?? null);
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      run(
        db,
        `UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...keys.map((k) => updates[k]),
        now(),
        campaign.id,
      );
    }
    return withStats(request.accountId, campaign.id);
  });

  app.delete<Params>('/campaigns/:id', async (request, reply) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status === 'sending') throw conflict("Impossible de supprimer une campagne en cours d'envoi");
    transaction(db, () => {
      // Keep message history (account-level statistics) but detach it from the campaign.
      run(db, 'UPDATE messages SET campaign_id = NULL WHERE campaign_id = ?', campaign.id);
      run(db, 'DELETE FROM campaigns WHERE id = ?', campaign.id);
    });
    return reply.code(204).send();
  });

  app.post<Params>('/campaigns/:id/test', async (request) => {
    const { to } = parse(testSchema, request.body);
    const email = normalizeEmail(to);
    if (!isValidEmail(email)) throw badRequest('Adresse de test invalide');
    const campaign = load(request.accountId, request.params.id);
    if (!campaign.html?.trim()) throw badRequest('Le contenu HTML de la campagne est requis');

    const known = findContactByEmail(db, request.accountId, email);
    const contact = known ?? { email, first_name: 'Camille', last_name: 'Martin' };
    const sender = accountSender(db, config, request.accountId);
    const { id, rendered } = createMessage(db, config, {
      accountId: request.accountId,
      contactId: known?.id ?? null,
      contact,
      subject: `[TEST] ${campaign.subject || campaign.name}`,
      html: campaign.html,
      preheader: campaign.preheader,
      senderName: campaign.from_name || sender.name,
      // Not 'queued': the test is sent synchronously below and must never be picked up by the worker.
      status: 'sent',
    });
    try {
      const result = await provider.send({
        messageId: id,
        to: email,
        fromName: campaign.from_name || sender.name,
        fromEmail: campaign.from_email || sender.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        unsubscribeUrl: rendered.unsubscribeUrl,
      });
      markSent(db, id, result.providerId);
    } catch (err) {
      markFailed(db, id, (err as Error).message);
      throw badRequest(`Échec de l'envoi du test : ${(err as Error).message}`);
    }
    return { ok: true, message_id: id, to: email, subject: rendered.subject };
  });

  app.post<Params>('/campaigns/:id/send', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw conflict('Cette campagne a déjà été envoyée ou est en cours d’envoi');
    }
    assertSendable(campaign);
    run(
      db,
      "UPDATE campaigns SET status = 'sending', scheduled_at = NULL, updated_at = ? WHERE id = ?",
      now(),
      campaign.id,
    );
    kickWorker();
    return withStats(request.accountId, campaign.id);
  });

  app.post<Params>('/campaigns/:id/schedule', async (request) => {
    const { scheduled_at } = parse(scheduleSchema, request.body);
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw conflict('Seules les campagnes en brouillon peuvent être programmées');
    }
    const when = new Date(scheduled_at);
    if (when.getTime() < Date.now() - 60_000) throw badRequest('La date de programmation doit être dans le futur');
    assertSendable(campaign);
    run(
      db,
      "UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?",
      when.toISOString(),
      now(),
      campaign.id,
    );
    return withStats(request.accountId, campaign.id);
  });

  app.post<Params>('/campaigns/:id/unschedule', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'scheduled') throw conflict("Cette campagne n'est pas programmée");
    run(db, "UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?", now(), campaign.id);
    return withStats(request.accountId, campaign.id);
  });

  app.get<Params>('/campaigns/:id/stats', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    return campaignStatsDetail(db, campaign.id);
  });
}

import { convertEmailImages } from '../services/emailImages.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, transaction, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, listResponse, notFound, pagination, parse, queryString, zmsg } from '../lib/http.js';
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
import { effectiveFrom, senderAllowed } from '../services/sendingDomains.js';
import { t } from '../i18n.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(1, zmsg('Le nom est requis', 'Name is required')).max(200),
  subject: z.string().trim().max(300).optional(),
  preheader: nullableText(300),
  from_name: nullableText(120),
  from_email: z.email(zmsg('Adresse expéditeur invalide', 'Invalid sender address')).nullable().optional(),
  html: z.string().max(1_000_000).nullable().optional(),
  design: z.string().max(2_000_000).nullable().optional(),
  segment_id: z.string().trim().min(1).nullable().optional(),
  /** Chosen contacts (takes precedence over the segment). Empty or null = everyone / the segment. */
  contact_ids: z.array(z.string().trim().min(1).max(64)).max(5000).nullable().optional(),
});
const patchSchema = createSchema.partial();
const testSchema = z.object({ to: z.string().trim().min(1, zmsg('Destinataire requis', 'Recipient is required')) });
const scheduleSchema = z.object({ scheduled_at: z.iso.datetime({ offset: true, ...zmsg('Date ISO 8601 attendue', 'ISO 8601 date expected') }) });

type Params = { Params: { id: string } };

export async function campaignRoutes(app: FastifyInstance, { db, config, provider, kickWorker }: Deps) {
  const load = (accountId: string, id: string) => {
    const row = get(db, 'SELECT * FROM campaigns WHERE id = ? AND account_id = ?', id, accountId);
    if (!row) throw notFound(t('Campagne introuvable', 'Campaign not found'));
    return serializeCampaign(row);
  };

  const assertSegment = (accountId: string, segmentId: string | null | undefined) => {
    if (segmentId && !get(db, 'SELECT id FROM segments WHERE id = ? AND account_id = ?', segmentId, accountId)) {
      throw badRequest(t('Segment introuvable', 'Segment not found'));
    }
  };

  const withStats = (accountId: string, id: string) => {
    const campaign = load(accountId, id);
    return { ...campaign, stats: campaignStatsSummary(db, id) };
  };

  /** Preconditions shared by send + schedule. */
  const assertSendable = (campaign: ReturnType<typeof serializeCampaign>) => {
    if (!campaign.subject.trim()) throw badRequest(t("L'objet de la campagne est requis", 'Campaign subject is required'));
    if (!campaign.html?.trim()) throw badRequest(t('Le contenu HTML de la campagne est requis', 'Campaign HTML content is required'));
    if (campaign.segment_id) assertSegment(campaign.account_id, campaign.segment_id);
    if (audienceCount(db, campaign.account_id, campaign.segment_id, campaign.contact_ids) === 0) {
      throw badRequest(t('Aucun destinataire abonné ne correspond à cette audience', 'No subscribed recipients match this audience'));
    }
  };

  app.get('/campaigns', async (request) => {
    const p = pagination(request.query);
    const where = ['account_id = ?'];
    const params: SQLInputValue[] = [request.accountId];
    const status = queryString(request.query, 'status');
    if (status) {
      if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) throw badRequest(t('Statut inconnu', 'Unknown status'));
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

  /** Keeps only this account's contacts (deduplicated). null = not in "chosen contacts" mode; "[]" = nobody chosen yet. */
  function idsJson(accountId: string, ids: string[] | null | undefined): string | null {
    if (!ids) return null;
    const unique = [...new Set(ids)];
    if (!unique.length) return '[]';
    const own = new Set<string>();
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      for (const r of all<{ id: string }>(db, `SELECT id FROM contacts WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})`, accountId, ...chunk)) own.add(r.id);
    }
    const kept = unique.filter((id) => own.has(id));
    return JSON.stringify(kept);
  }

  /** Only our shared address or one on the account's verified domain: anything else would be spoofing and land in spam. */
  function assertSender(accountId: string, email: string | null | undefined) {
    if (email && !senderAllowed(db, config, accountId, email)) {
      throw badRequest(
        t(
          `Vous ne pouvez pas envoyer depuis ${email} : choisissez une adresse de la liste. Pour utiliser votre adresse pro, ajoutez-la dans Paramètres, section « Votre adresse d'envoi ».`,
          `You can't send from ${email}: pick an address from the list. To use your work address, add it under Settings, “Your sending address”.`,
        ),
      );
    }
  }

  app.post('/campaigns', async (request, reply) => {
    const body = parse(createSchema, request.body);
    assertSegment(request.accountId, body.segment_id);
    assertSender(request.accountId, body.from_email);
    const sender = accountSender(db, config, request.accountId);
    const id = newId();
    const timestamp = now();
    run(
      db,
      `INSERT INTO campaigns (id, account_id, name, subject, preheader, from_name, from_email, html, design, segment_id, contact_ids, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      request.accountId,
      body.name,
      body.subject ?? '',
      body.preheader ?? null,
      body.from_name || sender.name,
      // Empty = the account's default address, read at send time (so it follows a newly verified domain).
      body.from_email || null,
      body.html ?? null,
      body.design ?? null,
      body.segment_id ?? null,
      idsJson(request.accountId, body.contact_ids),
      timestamp,
      timestamp,
    );
    return reply.code(201).send(withStats(request.accountId, id));
  });

  app.get<Params>('/campaigns/:id', async (request) => withStats(request.accountId, request.params.id));

  app.patch<Params>('/campaigns/:id', async (request) => {
    const body = parse(patchSchema, request.body);
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'draft') throw conflict(t('Seules les campagnes en brouillon sont modifiables', 'Only draft campaigns can be edited'));
    if (body.segment_id !== undefined) assertSegment(request.accountId, body.segment_id);
    assertSender(request.accountId, body.from_email);
    const updates: Record<string, SQLInputValue> = {};
    for (const key of ['name', 'subject', 'preheader', 'from_name', 'from_email', 'html', 'design', 'segment_id'] as const) {
      if (body[key] !== undefined) updates[key] = key === 'subject' ? (body.subject ?? '') : (body[key] ?? null);
    }
    if (body.contact_ids !== undefined) updates.contact_ids = idsJson(request.accountId, body.contact_ids);
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
    if (campaign.status === 'sending') throw conflict(t("Impossible de supprimer une campagne en cours d'envoi", 'You can’t delete a campaign that is sending'));
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
    if (!isValidEmail(email)) throw badRequest(t('Adresse de test invalide', 'Invalid test address'));
    const campaign = load(request.accountId, request.params.id);
    if (!campaign.html?.trim()) throw badRequest(t('Le contenu HTML de la campagne est requis', 'Campaign HTML content is required'));

    const known = findContactByEmail(db, request.accountId, email);
    const contact = known ?? { email, ...t({ first_name: 'Camille', last_name: 'Martin' }, { first_name: 'Taylor', last_name: 'Smith' }) };
    const sender = accountSender(db, config, request.accountId);
    const { id, rendered } = createMessage(db, config, {
      accountId: request.accountId,
      contactId: known?.id ?? null,
      contact,
      subject: `[TEST] ${campaign.subject || campaign.name}`,
      // The same conversion as the real send (SVG/WebP → PNG/JPG), so the test looks like what recipients get.
      html: (await convertEmailImages(db, config, request.accountId, campaign.html)).html,
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
        fromEmail: effectiveFrom(db, config, request.accountId, campaign.from_email),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        unsubscribeUrl: rendered.unsubscribeUrl,
        accountId: request.accountId,
        campaignId: campaign.id,
      });
      markSent(db, id, result.providerId);
    } catch (err) {
      markFailed(db, id, (err as Error).message);
      throw badRequest(t(`Échec de l'envoi du test : ${(err as Error).message}`, `Test send failed: ${(err as Error).message}`));
    }
    return { ok: true, message_id: id, to: email, subject: rendered.subject };
  });

  app.post<Params>('/campaigns/:id/send', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw conflict(t('Cette campagne a déjà été envoyée ou est en cours d’envoi', 'This campaign has already been sent or is sending'));
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
      throw conflict(t('Seules les campagnes en brouillon peuvent être programmées', 'Only draft campaigns can be scheduled'));
    }
    const when = new Date(scheduled_at);
    if (when.getTime() < Date.now() - 60_000) throw badRequest(t('La date de programmation doit être dans le futur', 'The scheduled date must be in the future'));
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
    if (campaign.status !== 'scheduled') throw conflict(t("Cette campagne n'est pas programmée", 'This campaign isn’t scheduled'));
    run(db, "UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?", now(), campaign.id);
    return withStats(request.accountId, campaign.id);
  });

  app.get<Params>('/campaigns/:id/stats', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    return campaignStatsDetail(db, campaign.id);
  });

  /** Who the campaign went to, with what happened for each person (sent, opened, clicked, failed, unsubscribed). */
  app.get<Params>('/campaigns/:id/recipients', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    const p = pagination(request.query);
    const unsub = `EXISTS (SELECT 1 FROM events e WHERE e.account_id = m.account_id AND e.type = 'unsubscribe' AND json_extract(e.data, '$.message_id') = m.id)`;
    const where = ['m.campaign_id = ?', 'm.account_id = ?'];
    const params: SQLInputValue[] = [campaign.id, request.accountId];
    const filter = queryString(request.query, 'filter');
    if (filter === 'opened') where.push('m.opened_at IS NOT NULL');
    else if (filter === 'clicked') where.push('m.clicked_at IS NOT NULL');
    else if (filter === 'not_opened') where.push("m.status = 'sent' AND m.opened_at IS NULL");
    else if (filter === 'failed') where.push("m.status IN ('failed', 'bounced')");
    else if (filter === 'unsubscribed') where.push(unsub);
    else if (filter === 'queued') where.push("m.status = 'queued'");
    const search = queryString(request.query, 'search');
    if (search) {
      const like = `%${search.toLowerCase().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      where.push(`(LOWER(m.to_email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const whereSql = where.join(' AND ');
    const total = scalar(db, `SELECT COUNT(*) FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id WHERE ${whereSql}`, ...params);
    const rows = all<{
      id: string; contact_id: string | null; to_email: string; first_name: string | null; last_name: string | null;
      status: string; error: string | null; sent_at: string | null; opened_at: string | null; clicked_at: string | null; unsubscribed: number;
    }>(
      db,
      `SELECT m.id, m.contact_id, m.to_email, c.first_name, c.last_name, m.status, m.error, m.sent_at, m.opened_at, m.clicked_at, ${unsub} AS unsubscribed
         FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id
        WHERE ${whereSql}
        ORDER BY COALESCE(m.clicked_at, m.opened_at, m.sent_at, m.created_at) DESC, m.id
        LIMIT ? OFFSET ?`,
      ...params,
      p.limit,
      p.offset,
    );
    return listResponse(rows.map((r) => ({ ...r, unsubscribed: !!r.unsubscribed })), total, p);
  });
}

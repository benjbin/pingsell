import { convertEmailImages } from '../services/emailImages.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, scalar, type SQLInputValue } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, listResponse, notFound, pagination, parse, queryString, zmsg } from '../lib/http.js';
import {
  CAMPAIGN_STATUSES,
  audienceExists,
  campaignStatsDetail,
  campaignStatsMap,
  campaignStatsSummary,
  serializeCampaign,
  stopCampaign,
} from '../services/campaigns.js';
import { findContactByEmail, isValidEmail, normalizeContactLanguage, normalizeEmail } from '../services/contacts.js';
import {
  accountSender,
  campaignTranslationSource,
  createMessage,
  forgetTranslations,
  loadCampaignTemplate,
  markFailed,
  markSent,
} from '../services/messages.js';
import {
  accountLanguages,
  campaignLanguage,
  deeplTarget,
  deeplTranslator,
  sameLanguage,
  saveTranslation,
  translateSource,
} from '../services/translate.js';
import { personalizeEmail } from '../services/render.js';
import { withAccountLang } from '../i18n.js';
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
  /** Langue dans laquelle la campagne est écrite (« fr », « en »…) ; null = celle du compte. */
  language: z.string().trim().max(35).nullable().optional(),
  /** Traduire automatiquement dans la langue de chaque contact. */
  auto_translate: z.boolean().optional(),
});
const patchSchema = createSchema.partial();
const langField = z.string().trim().max(35).nullable().optional();
const testSchema = z.object({ to: z.string().trim().min(1, zmsg('Destinataire requis', 'Recipient is required')), language: langField });
const previewLangSchema = z.object({ language: z.string().trim().min(2).max(35) });
const scheduleSchema = z.object({ scheduled_at: z.iso.datetime({ offset: true, ...zmsg('Date ISO 8601 attendue', 'ISO 8601 date expected') }) });

type Params = { Params: { id: string } };

/** Code de langue saisi → code stocké (« fr-FR » → « fr ») ; invalide → 400. */
function langOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const code = normalizeContactLanguage(v);
  if (!code) throw badRequest(t('Langue invalide (ex : fr, en, de)', 'Invalid language (e.g. fr, en, de)'));
  return code;
}

export async function campaignRoutes(app: FastifyInstance, { db, config, provider, kickWorker }: Deps) {
  const load = (accountId: string, id: string) => {
    const row = get(db, 'SELECT * FROM campaigns WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id, accountId);
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
    if (campaign.auto_translate && !config.translate.deeplKey) {
      throw badRequest(
        t(
          'Traduction automatique indisponible : la clé DeepL n’est pas configurée sur le serveur. Désactivez la traduction ou ajoutez la clé.',
          'Automatic translation unavailable: no DeepL key on the server. Turn translation off or add the key.',
        ),
      );
    }
    // Synchronous on the event loop: an existence probe, not a COUNT of the whole audience (~0.6 s at 2 M contacts).
    if (!audienceExists(db, campaign.account_id, campaign.segment_id, campaign.contact_ids)) {
      throw badRequest(t('Aucun destinataire abonné ne correspond à cette audience', 'No subscribed recipients match this audience'));
    }
  };

  app.get('/campaigns', async (request) => {
    const p = pagination(request.query);
    const where = ['account_id = ?', 'deleted_at IS NULL'];
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
      `INSERT INTO campaigns (id, account_id, name, subject, preheader, from_name, from_email, html, design, segment_id, contact_ids, language, auto_translate, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
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
      langOrNull(body.language),
      body.auto_translate ? 1 : 0,
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
    if (body.language !== undefined) updates.language = langOrNull(body.language);
    if (body.auto_translate !== undefined) updates.auto_translate = body.auto_translate ? 1 : 0;
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
    // A campaign that never sent anything simply goes. One with messages is only hidden (soft delete): its
    // message history stays for the account-level statistics, without rewriting millions of message rows.
    if (get(db, 'SELECT 1 AS x FROM messages WHERE campaign_id = ? LIMIT 1', campaign.id)) {
      run(db, "UPDATE campaigns SET deleted_at = ?, status = CASE WHEN status = 'scheduled' THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?", now(), now(), campaign.id);
    } else {
      run(db, 'DELETE FROM campaigns WHERE id = ?', campaign.id);
    }
    return reply.code(204).send();
  });

  /**
   * La traduction d'une campagne dans une langue, faite maintenant si elle manque ou date d'une autre version
   * (gardée : l'envoi la réutilise). null quand c'est la langue de la campagne.
   */
  async function ensureTranslation(accountId: string, campaignId: string, rawLang: string) {
    const lang = langOrNull(rawLang)!;
    const tpl = loadCampaignTemplate(db, campaignId);
    if (!tpl || tpl.account_id !== accountId) throw notFound(t('Campagne introuvable', 'Campaign not found'));
    if (sameLanguage(lang, campaignLanguage(db, tpl))) return null;
    if (!deeplTarget(lang)) throw badRequest(t(`Langue non prise en charge par la traduction : ${lang}`, `Language not supported by translation: ${lang}`));
    if (!config.translate.deeplKey) {
      throw badRequest(t('Traduction automatique indisponible : la clé DeepL n’est pas configurée sur le serveur', 'Automatic translation unavailable: no DeepL key on the server'));
    }
    // Les images converties comme à l'envoi : la traduction correspond au modèle réellement envoyé.
    if (tpl.html) {
      const conv = await convertEmailImages(db, config, accountId, tpl.html);
      if (conv.converted) {
        run(db, 'UPDATE campaigns SET html = ? WHERE id = ?', conv.html, campaignId);
        tpl.html = conv.html;
      }
    }
    const src = campaignTranslationSource(db, config, tpl);
    const existing = get<{ source_hash: string; subject: string; preheader: string | null; html: string }>(
      db,
      'SELECT source_hash, subject, preheader, html FROM campaign_translations WHERE campaign_id = ? AND lang = ?',
      campaignId,
      lang,
    );
    if (existing && existing.source_hash === src.hash) return { lang, ...existing, kept: 0, total: 0 };
    try {
      const tr = await translateSource(src, lang, deeplTranslator(config));
      saveTranslation(db, campaignId, lang, src.hash, tr);
      forgetTranslations(campaignId);
      return { lang, source_hash: src.hash, ...tr };
    } catch (err) {
      throw badRequest(t(`Traduction impossible : ${(err as Error).message}`, `Translation failed: ${(err as Error).message}`));
    }
  }

  /** Les langues des contacts du compte, et celles qui seront traduites. */
  app.get<Params>('/campaigns/:id/languages', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    const source = campaignLanguage(db, campaign);
    const done = new Map(
      all<{ lang: string; created_at: string }>(db, 'SELECT lang, created_at FROM campaign_translations WHERE campaign_id = ?', campaign.id).map((r) => [r.lang, r.created_at]),
    );
    const langs = accountLanguages(db, request.accountId);
    return {
      source,
      translation_available: Boolean(config.translate.deeplKey),
      languages: langs.map((lang) => ({
        lang,
        same_as_source: sameLanguage(lang, source),
        supported: Boolean(deeplTarget(lang)),
        translated_at: done.get(lang) ?? null,
      })),
    };
  });

  /** Aperçu de la campagne traduite dans une langue (la traduction est gardée pour l'envoi). */
  app.post<Params>('/campaigns/:id/translation-preview', async (request) => {
    const { language } = parse(previewLangSchema, request.body);
    const campaign = load(request.accountId, request.params.id);
    if (!campaign.html?.trim()) throw badRequest(t('Le contenu HTML de la campagne est requis', 'Campaign HTML content is required'));
    const tr = await ensureTranslation(request.accountId, campaign.id, language);
    const sample = { email: 'client@exemple.com', ...t({ first_name: 'Camille', last_name: 'Martin' }, { first_name: 'Taylor', last_name: 'Smith' }) };
    if (!tr) {
      return { language, same_as_source: true, subject: campaign.subject, preheader: campaign.preheader, html: null, kept: 0, total: 0 };
    }
    const rendered = withAccountLang(db, request.accountId, () =>
      personalizeEmail(tr.html, { messageId: 'preview', publicUrl: config.publicUrl, subject: tr.subject, preheader: tr.preheader, contact: sample, tracking: false }),
    );
    return { language: tr.lang, same_as_source: false, subject: rendered.subject, preheader: tr.preheader, html: rendered.html, kept: tr.kept, total: tr.total };
  });

  app.post<Params>('/campaigns/:id/test', async (request) => {
    const { to, language } = parse(testSchema, request.body);
    const email = normalizeEmail(to);
    if (!isValidEmail(email)) throw badRequest(t('Adresse de test invalide', 'Invalid test address'));
    const campaign = load(request.accountId, request.params.id);
    if (!campaign.html?.trim()) throw badRequest(t('Le contenu HTML de la campagne est requis', 'Campaign HTML content is required'));

    const known = findContactByEmail(db, request.accountId, email);
    const contact = known ?? { email, ...t({ first_name: 'Camille', last_name: 'Martin' }, { first_name: 'Taylor', last_name: 'Smith' }) };
    const sender = accountSender(db, config, request.accountId);
    // Test dans une langue : la traduction que recevront les contacts de cette langue.
    const tr = language ? await ensureTranslation(request.accountId, campaign.id, language) : null;
    const { id, rendered } = createMessage(db, config, {
      accountId: request.accountId,
      contactId: known?.id ?? null,
      contact,
      subject: `[TEST] ${tr ? tr.subject : campaign.subject || campaign.name}`,
      // The same conversion as the real send (SVG/WebP → PNG/JPG), so the test looks like what recipients get.
      html: tr ? tr.html : (await convertEmailImages(db, config, request.accountId, campaign.html)).html,
      prepared: Boolean(tr),
      preheader: tr ? tr.preheader : campaign.preheader,
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

  /** Holds the sending (the queue is kept). */
  app.post<Params>('/campaigns/:id/pause', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'sending') throw conflict(t("Cette campagne n'est pas en cours d'envoi", 'This campaign isn’t sending'));
    if (!campaign.paused) run(db, 'UPDATE campaigns SET paused_reason = ?, updated_at = ? WHERE id = ?', JSON.stringify({ kind: 'manual', at: now() }), now(), campaign.id);
    return withStats(request.accountId, campaign.id);
  });

  /** Sends the rest. After an automatic pause, the red lines then only count the emails sent from now on. */
  app.post<Params>('/campaigns/:id/resume', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'sending' || !campaign.paused) throw conflict(t("Cette campagne n'est pas en pause", 'This campaign isn’t paused'));
    run(
      db,
      'UPDATE campaigns SET paused_reason = NULL, guard_since = ?, g_handled = 0, g_bounces = 0, g_blocks = 0, g_complaints = 0, updated_at = ? WHERE id = ?',
      now(),
      now(),
      campaign.id,
    );
    kickWorker();
    return withStats(request.accountId, campaign.id);
  });

  /**
   * Stops for good: the campaign ends at once with what already left (nothing more is sent from now on, not even
   * from the batch in flight); the emails not sent yet are deleted in the background by small chunks.
   */
  app.post<Params>('/campaigns/:id/stop', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    if (campaign.status !== 'sending') throw conflict(t("Cette campagne n'est pas en cours d'envoi", 'This campaign isn’t sending'));
    stopCampaign(db, campaign.id);
    kickWorker();
    return withStats(request.accountId, campaign.id);
  });

  app.get<Params>('/campaigns/:id/stats', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    return campaignStatsDetail(db, campaign.id);
  });

  /**
   * Who the campaign went to, with what happened for each person (sent, opened, clicked, failed, unsubscribed).
   * Polled while sending, so it never scans the whole campaign: each filter walks its own index, totals come from
   * the campaign counters, "unsubscribed" is looked up for the rows of the page only, and a search looks through
   * the SEARCH_WINDOW most recent recipients of a large campaign (`search_truncated: true` when it stopped there).
   */
  app.get<Params>('/campaigns/:id/recipients', async (request) => {
    const campaign = load(request.accountId, request.params.id);
    const p = pagination(request.query);
    const meta = get<Record<string, number>>(
      db,
      'SELECT lean, counters_ok, n_total, n_queued, n_sent, n_failed, n_bounced, n_opened, n_clicked, n_unsub FROM campaigns WHERE id = ?',
      campaign.id,
    )!;
    const n = (k: string) => Number(meta[k] ?? 0);
    // Campaigns queued by this version: their messages are in the partial indexes (in_queue IS NOT NULL).
    const lean = !!n('lean');
    const where = ['m.campaign_id = ?'];
    const params: SQLInputValue[] = [campaign.id];
    if (lean) where.push('m.in_queue IS NOT NULL');
    let order = lean ? 'm.sent_at DESC, m.rowid DESC' : 'm.rowid DESC';
    const filter = queryString(request.query, 'filter');
    let counted: number | null = n('counters_ok') ? n('n_total') : null;
    const ifCounted = (v: number) => (counted === null ? null : v);
    if (filter === 'opened') {
      where.push('m.opened_at IS NOT NULL');
      if (lean) order = 'm.opened_at DESC, m.rowid DESC';
      counted = ifCounted(n('n_opened'));
    } else if (filter === 'clicked') {
      where.push('m.clicked_at IS NOT NULL');
      if (lean) order = 'm.clicked_at DESC, m.rowid DESC';
      counted = ifCounted(n('n_clicked'));
    } else if (filter === 'not_opened') {
      where.push("m.sent_at IS NOT NULL AND m.status = 'sent' AND m.opened_at IS NULL");
      // Opens on emails that bounced afterwards are rare: close enough for a page count.
      counted = ifCounted(Math.max(0, n('n_sent') - n('n_opened')));
    } else if (filter === 'failed') {
      where.push("m.status IN ('failed', 'bounced')");
      order = 'm.rowid DESC';
      counted = ifCounted(n('n_failed') + n('n_bounced'));
    } else if (filter === 'unsubscribed') {
      // Events carry the campaign id since this version; older ones only have it in their JSON.
      where.push(
        `m.id IN (SELECT message_id FROM events WHERE campaign_id = ? AND type = 'unsubscribe' AND message_id IS NOT NULL${
          lean
            ? ''
            : ` UNION SELECT json_extract(data, '$.message_id') FROM events
                 WHERE account_id = ? AND type = 'unsubscribe' AND created_at >= ? AND campaign_id IS NULL AND json_extract(data, '$.campaign_id') = ?`
        })`,
      );
      params.push(campaign.id, ...(lean ? [] : [request.accountId, campaign.created_at, campaign.id]));
      // Driven by the (few) unsubscribe events, not by the campaign's index ("+" keeps the planner off it).
      where[0] = '+m.campaign_id = ?';
      if (lean) where[1] = '+m.in_queue IS NOT NULL';
      order = 'm.rowid DESC';
      counted = ifCounted(n('n_unsub'));
    } else if (filter === 'queued') {
      where.push(lean ? 'm.in_queue = 1' : "m.status = 'queued'");
      order = 'm.rowid DESC';
      counted = ifCounted(n('n_queued'));
    }
    const cols = 'm.rowid AS rid, m.id, m.contact_id, m.to_email, m.status, m.error, m.sent_at, m.opened_at, m.clicked_at';
    const whereSql = where.join(' AND ');
    const outerOrder = order.replace(/m\.rowid/g, 'm.rid');
    const search = queryString(request.query, 'search');
    type RecipientRow = {
      id: string; contact_id: string | null; to_email: string; first_name: string | null; last_name: string | null;
      status: string; error: string | null; sent_at: string | null; opened_at: string | null; clicked_at: string | null;
    };
    const select = 'SELECT m.id, m.contact_id, m.to_email, c.first_name, c.last_name, m.status, m.error, m.sent_at, m.opened_at, m.clicked_at';
    let rows: RecipientRow[];
    let total: number;
    let truncated = false;
    if (!search) {
      // The page is cut from the index first, then joined with the contacts.
      rows = all<RecipientRow>(
        db,
        `${select} FROM (SELECT ${cols} FROM messages m WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?) m
           LEFT JOIN contacts c ON c.id = m.contact_id ORDER BY ${outerOrder}`,
        ...params,
        p.limit,
        p.offset,
      );
      total = counted ?? scalar(db, `SELECT COUNT(*) FROM messages m WHERE ${whereSql}`, ...params);
    } else {
      const term = search.toLowerCase();
      const like = `%${term.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      const searchSql = `(LOWER(m.to_email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\')`;
      // 1. Anywhere in the email or the name, among the SEARCH_WINDOW first recipients in display order…
      const hits = new Set(
        all<{ rid: number }>(
          db,
          `SELECT m.rid FROM (SELECT ${cols} FROM messages m WHERE ${whereSql} ORDER BY ${order}${lean ? ` LIMIT ${SEARCH_WINDOW}` : ''}) m
             LEFT JOIN contacts c ON c.id = m.contact_id WHERE ${searchSql}`,
          ...params,
          like,
          like,
        ).map((r) => r.rid),
      );
      // 2. …plus, over the whole campaign, the addresses that start with the search (contacts' email index).
      for (const r of all<{ rid: number }>(
        db,
        `SELECT m.rowid AS rid FROM (SELECT id FROM contacts WHERE account_id = ? AND email >= ? AND email < ? LIMIT 200) pc
           CROSS JOIN messages m ON m.contact_id = pc.id WHERE ${whereSql}`,
        request.accountId,
        term,
        `${term}￿`,
        ...params,
      )) hits.add(r.rid);
      truncated = lean && (counted ?? SEARCH_WINDOW + 1) > SEARCH_WINDOW;
      total = hits.size;
      rows = all<RecipientRow>(
        db,
        `${select} FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id
          WHERE m.rowid IN (SELECT value FROM json_each(?)) ORDER BY ${order} LIMIT ? OFFSET ?`,
        JSON.stringify([...hits]),
        p.limit,
        p.offset,
      );
    }
    const unsubscribed = unsubscribedAmong(campaign, rows.map((r) => r.id), lean);
    return {
      ...listResponse(rows.map((r) => ({ ...r, unsubscribed: unsubscribed.has(r.id) })), total, p),
      ...(search ? { search_truncated: truncated } : {}),
    };
  });

  /** Which of these messages (one page) led to an unsubscribe. */
  function unsubscribedAmong(campaign: { account_id: string; created_at: string }, ids: string[], lean: boolean): Set<string> {
    const out = new Set<string>();
    if (!ids.length) return out;
    const marks = ids.map(() => '?').join(',');
    for (const r of all<{ mid: string }>(db, `SELECT message_id AS mid FROM events WHERE message_id IN (${marks}) AND type = 'unsubscribe'`, ...ids)) out.add(r.mid);
    if (!lean) {
      // Unsubscribes recorded before events had a message_id column (bounded: this account, since the campaign).
      for (const r of all<{ mid: string }>(
        db,
        `SELECT json_extract(data, '$.message_id') AS mid FROM events
          WHERE account_id = ? AND type = 'unsubscribe' AND created_at >= ? AND message_id IS NULL
            AND json_extract(data, '$.message_id') IN (${marks})`,
        campaign.account_id,
        campaign.created_at,
        ...ids,
      )) out.add(r.mid);
    }
    return out;
  }
}

/** A search in the recipients of a large campaign looks through this many of its most recent recipients. */
const SEARCH_WINDOW = 10_000;

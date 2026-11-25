import type { AppConfig } from './config.js';
import { all, checkpointWal, get, now, run, scalar, type DatabaseSync } from './db.js';
import { markWorkerTick } from './lib/health.js';
import { optimizeDatabase } from './services/maintenance.js';
import { backfillLegacy, finalizeCampaigns, purgeStoppedQueues, queueCampaign } from './services/campaigns.js';
import { processDueRuns, processScheduledTriggers, takeWebhooks } from './services/automations.js';
import { sendTeamNotifications, sendWebhooks } from './services/automationOutbox.js';
import { processAbandonedCarts } from './services/carts.js';
import { processTracking } from './services/webTracking.js';
import { finalizePushCampaigns, queuePushCampaigns, sendPushBatch } from './services/push.js';
import { processPushResends } from './services/pushGrowth.js';
import { accountSender, loadCampaignTemplate, markFailed, markRetry, markSent, renderCampaignMessage } from './services/messages.js';
import { effectiveFrom } from './services/sendingDomains.js';
import { platformAdminAccountIds } from './services/platformAdmin.js';
import { htmlToText } from './services/render.js';
import { convertEmailImages } from './services/emailImages.js';
import { classifySendError, type EmailProvider } from './services/mailer.js';
import { outsideLang } from './i18n.js';
import { guardCampaigns } from './services/deliverability.js';
import { backupDue, backupInProgress, runBackup } from './services/backup.js';
import { purgeDataAccessLog } from './services/dataAccess.js';

export interface WorkerLogger {
  info(msg: string): void;
  error(msg: string): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errText = (err: unknown) => (err instanceof Error ? (err.stack ?? err.message) : String(err));

/** A transient provider error is retried this many times (with growing delays) before the email is given up. */
export const MAX_SEND_ATTEMPTS = 6;
/** This many provider errors in a row pause all sending for a while (provider down, account throttled…). */
const BREAKER_FAILURES = 10;
/** A campaign whose queueing keeps failing is marked failed after this many attempts. */
const MAX_QUEUE_ATTEMPTS = 5;
/** Campaigns queued at the same time (each yields between slices, so they interleave). */
const PARALLEL_QUEUEING = 4;

/** Delay before the n-th retry (n >= 1): 30 s, 1 min, 2 min… capped at 30 min. */
export const retryDelayMs = (n: number) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, n - 1));

let lastTick: number | null = null;
/** When the worker last ran a tick (ms epoch), null before the first one. */
export const lastWorkerTickAt = (): number | null => lastTick;

interface Queued {
  rid: number;
  id: string;
  account_id: string;
  campaign_id: string | null;
  automation_id: string | null;
  contact_id: string | null;
  to_email: string;
  subject: string;
  html: string;
  attempts: number;
}

/**
 * In-process background worker (setInterval loop):
 *  1. promotes due scheduled campaigns to `sending`
 *  2. queues messages for `sending` campaigns (in the background, a few at a time, in short slices)
 *  3. advances due automation runs
 *  4. sends queued messages in rate-limited batches, round-robin across accounts and campaigns
 *  5. marks finished campaigns as `sent`
 *  6. queues / sends push notifications (campaigns, resends to non-openers, automation steps, tests)
 * Each stage has its own try/catch: one failing stage never stops the others (sending above all).
 * Every database call is synchronous on the event loop that also serves the API, so any long job is
 * cut into short slices with a yield in between.
 */
export class SendingWorker {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private running = false;
  private rerun = false;
  private current: Promise<void> | null = null;
  private maintenanceAt = 0;
  private checkpointAt = 0;
  private optimizeAt = 0;
  private optimizeRunning = false;
  private backupRunning = false;
  private backupWarned = false;
  private readonly queueing = new Map<string, Promise<void>>();
  private background = new Set<Promise<unknown>>();
  private backfillRunning = false;
  private backfillDone = false;
  private purgeRunning = false;
  /** Provider circuit breaker. */
  private failuresInRow = 0;
  private breakerTrips = 0;
  private providerPausedUntil = 0;
  /** Round-robin position across accounts / campaigns. */
  private rr = 0;

  constructor(
    private readonly db: DatabaseSync,
    private readonly config: AppConfig,
    private readonly provider: EmailProvider,
    private readonly log: WorkerLogger = { info: console.log, error: console.error },
  ) {}

  /** When the last tick started (ms epoch), null before the first one. */
  get lastTickAt(): number | null {
    return lastTick;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.config.worker.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stops the timer and waits (at most `timeoutMs`) for the tick and background jobs in flight. */
  async stopAndWait(timeoutMs = 10_000): Promise<boolean> {
    this.stop();
    const pending = [this.current, ...this.queueing.values(), ...this.background].filter(Boolean) as Promise<unknown>[];
    if (!pending.length) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
    const done = Promise.allSettled(pending).then(() => true as const);
    const result = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return result;
  }

  /** Requests an immediate tick (e.g. right after a campaign is sent). */
  kick(): void {
    // Leave the caller's request language behind: each job uses its account's language.
    setImmediate(() => outsideLang(() => void this.tick()));
  }

  /** Une fois par heure au plus : purge du journal des accès, checkpoint du WAL et sauvegarde chiffrée si elle est due. */
  private maintenance(): void {
    const at = Date.now();
    if (at - this.maintenanceAt < 3_600_000) return;
    this.maintenanceAt = at;
    try {
      const purged = purgeDataAccessLog(this.db);
      if (purged) this.log.info(`[worker] journal des accès : ${purged} ligne(s) de plus d'un an supprimée(s)`);
    } catch (err) {
      this.log.error(`[worker] purge du journal des accès : ${err instanceof Error ? err.message : String(err)}`);
    }
    const cfg = this.config.backup;
    if (!cfg.key) {
      if (!this.backupWarned && this.config.isProduction) this.log.error('[worker] BACKUP_ENCRYPTION_KEY absente : aucune sauvegarde de la base');
      this.backupWarned = true;
      return;
    }
    if (this.backupRunning || !backupDue(cfg, at) || this.config.databasePath === ':memory:') return;
    this.backupRunning = true;
    runBackup(this.db, { ...cfg, key: cfg.key })
      .then((file) => this.log.info(`[worker] sauvegarde chiffrée : ${file}${cfg.s3 ? ' (copiée sur S3)' : ''}`))
      .catch((err) => this.log.error(`[worker] sauvegarde : ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => (this.backupRunning = false));
  }

  /** Checkpoint du WAL une fois par heure (hors sauvegarde en cours) ; checkpointWal ne rejette jamais. */
  private checkpoint(): void {
    const at = Date.now();
    if (at - this.checkpointAt < 3_600_000 || backupInProgress()) return;
    this.checkpointAt = at;
    void this.track(
      checkpointWal(this.db).then((r) => {
        if (r && r.walBefore > 0) this.log.info(`[worker] checkpoint du WAL : ${JSON.stringify(r)}`);
      }),
    );
  }

  /** Statistiques du planificateur une fois par heure (comptage dans un thread de lecture, quelques ms ici). */
  private optimize(): void {
    const at = Date.now();
    if (this.optimizeRunning || at - this.optimizeAt < 3_600_000) return;
    this.optimizeAt = at;
    this.optimizeRunning = true;
    void this.track(
      optimizeDatabase(this.db)
        .then((r) => {
          if (r.tables) this.log.info(`[worker] statistiques de la base : ${r.tables} table(s), ${r.indexes} index, ${r.total_ms} ms`);
        })
        .catch((err) => this.log.error(`[worker] statistiques de la base : ${errText(err)}`))
        .finally(() => (this.optimizeRunning = false)),
    );
  }

  private async stage(name: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.error(`[worker] ${name} : ${errText(err)}`);
    }
  }

  tick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.current ?? Promise.resolve();
    }
    this.running = true;
    this.current = this.runTick().finally(() => {
      this.running = false;
      this.current = null;
    });
    return this.current;
  }

  private async runTick(): Promise<void> {
    do {
      this.rerun = false;
      lastTick = Date.now();
      let sent = 0;
      let pushed = 0;
      markWorkerTick();
      await this.stage('maintenance', () => this.maintenance());
      await this.stage('checkpoint du WAL', () => this.checkpoint());
      await this.stage('statistiques de la base', () => this.optimize());
      await this.stage('campagnes programmées', () => this.promoteScheduled());
      await this.stage('rattrapage des compteurs', () => this.backfill());
      await this.stage('mise en file des campagnes', () => this.queueSendingCampaigns());
      await this.stage('files des campagnes arrêtées', () => this.purgeStopped());
      await this.stage('paniers abandonnés', () => processAbandonedCarts(this.db));
      await this.stage('déclencheurs programmés', () => processScheduledTriggers(this.db));
      await this.stage('suivi web', () => processTracking(this.db));
      await this.stage('automatisations', () => processDueRuns(this.db, this.config));
      await this.stage('garde-fou', () => {
        for (const p of guardCampaigns(this.db)) {
          this.log.info(`[worker] campagne « ${p.name} » mise en pause automatiquement (${p.reason.kind} : ${p.reason.count}/${p.reason.of})`);
        }
      });
      await this.stage('webhooks', () => sendWebhooks(takeWebhooks(), this.log));
      await this.stage('notifications équipe', () => sendTeamNotifications(this.db, this.config, this.provider));
      await this.stage('envoi', async () => (sent = await this.sendBatch()));
      await this.stage('fin des campagnes', () => finalizeCampaigns(this.db));
      await this.stage('push : mise en file', () => queuePushCampaigns(this.db));
      await this.stage('push : relances', () => processPushResends(this.db));
      await this.stage('push : envoi', async () => (pushed = await sendPushBatch(this.db, this.config, this.config.worker.batchSize)));
      await this.stage('push : fin des campagnes', () => finalizePushCampaigns(this.db));
      // Keep draining while there is a full batch of work pending.
      if (sent >= this.config.worker.batchSize || pushed >= this.config.worker.batchSize) this.rerun = true;
    } while (this.rerun && this.timer);
  }

  private promoteScheduled(): void {
    const changed = run(
      this.db,
      "UPDATE campaigns SET status = 'sending', updated_at = ? WHERE status = 'scheduled' AND scheduled_at <= ? AND deleted_at IS NULL",
      now(),
      now(),
    );
    if (changed) this.log.info(`[worker] ${changed} campagne(s) programmée(s) démarrée(s)`);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.background.add(p);
    void p.finally(() => this.background.delete(p)).catch(() => {});
    return p;
  }

  /** Catches up, in the background, the counters of campaigns sent before they existed (one-off). */
  private backfill(): void {
    if (this.backfillDone || this.backfillRunning) return;
    this.backfillRunning = true;
    this.track(
      backfillLegacy(this.db)
        .then((done) => {
          if (done && !this.backfillDone) this.log.info('[worker] compteurs des anciennes campagnes à jour');
          this.backfillDone = done;
        })
        .catch((err) => this.log.error(`[worker] rattrapage des compteurs : ${errText(err)}`))
        .finally(() => (this.backfillRunning = false)),
    );
  }

  /** Deletes, a chunk at a time, the emails a stopped campaign will never send. */
  private purgeStopped(): void {
    if (this.purgeRunning) return;
    if (!get(this.db, 'SELECT 1 AS x FROM campaigns WHERE purge_pending = 1 LIMIT 1')) return;
    this.purgeRunning = true;
    this.track(
      purgeStoppedQueues(this.db)
        .catch((err) => this.log.error(`[worker] purge des files arrêtées : ${errText(err)}`))
        .finally(() => (this.purgeRunning = false)),
    );
  }

  /**
   * Queues campaigns that just started sending. Runs in the background, a few campaigns at a time, so a large
   * campaign never holds up the rest of the worker nor the other accounts; sending starts as soon as the first
   * messages are in. A queueing that fails is retried later, and the campaign is marked failed after a few attempts.
   */
  private queueSendingCampaigns(): void {
    if (this.queueing.size >= PARALLEL_QUEUEING) return;
    const campaigns = all<{ id: string; name: string; account_id: string; queue_cursor: string | null; queue_attempts: number }>(
      this.db,
      `SELECT id, name, account_id, queue_cursor, queue_attempts FROM campaigns
        WHERE status = 'sending' AND queued_at IS NULL AND deleted_at IS NULL AND (queue_retry_at IS NULL OR queue_retry_at <= ?)
        ORDER BY updated_at`,
      now(),
    );
    for (const c of campaigns) {
      if (this.queueing.size >= PARALLEL_QUEUEING) break;
      if (this.queueing.has(c.id)) continue;
      const task = this.queueOne(c).finally(() => this.queueing.delete(c.id));
      this.queueing.set(c.id, task);
    }
  }

  private async queueOne(c: { id: string; name: string; account_id: string; queue_cursor: string | null; queue_attempts: number }): Promise<void> {
    try {
      // Pictures Gmail can't show (SVG, WebP) become PNG/JPG first, so every recipient gets the same email.
      const started = c.queue_cursor || get(this.db, 'SELECT 1 AS x FROM messages WHERE campaign_id = ? LIMIT 1', c.id);
      const html = started ? null : get<{ html: string | null }>(this.db, 'SELECT html FROM campaigns WHERE id = ?', c.id)?.html;
      if (html) {
        try {
          const res = await convertEmailImages(this.db, this.config, c.account_id, html);
          if (res.converted) run(this.db, 'UPDATE campaigns SET html = ? WHERE id = ?', res.html, c.id);
          if (res.converted || res.failed.length) this.log.info(`[worker] campagne « ${c.name} » : ${res.converted} image(s) convertie(s)${res.failed.length ? `, échecs : ${res.failed.join(' ; ')}` : ''}`);
        } catch (err) {
          this.log.error(`[worker] conversion des images de « ${c.name} » : ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const t = Date.now();
      const queued = await queueCampaign(this.db, this.config, c.id, { aborted: () => this.stopped });
      if (c.queue_attempts) run(this.db, 'UPDATE campaigns SET queue_attempts = 0, queue_error = NULL, queue_retry_at = NULL WHERE id = ?', c.id);
      this.log.info(`[worker] campagne « ${c.name} » : ${queued} message(s) en file (${Math.round((Date.now() - t) / 1000)} s)`);
    } catch (err) {
      const attempts = Number(c.queue_attempts) + 1;
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`[worker] mise en file de « ${c.name} » (essai ${attempts}/${MAX_QUEUE_ATTEMPTS}) : ${errText(err)}`);
      try {
        if (attempts >= MAX_QUEUE_ATTEMPTS) {
          // Given up: what was already queued is dropped like a stop, so nobody gets half a campaign later.
          run(
            this.db,
            "UPDATE campaigns SET status = 'failed', queue_attempts = ?, queue_error = ?, purge_pending = 1, queued_at = COALESCE(queued_at, ?), updated_at = ? WHERE id = ?",
            attempts,
            reason.slice(0, 1000),
            now(),
            now(),
            c.id,
          );
        } else {
          run(
            this.db,
            'UPDATE campaigns SET queue_attempts = ?, queue_error = ?, queue_retry_at = ? WHERE id = ?',
            attempts,
            reason.slice(0, 1000),
            new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
            c.id,
          );
        }
      } catch (inner) {
        this.log.error(`[worker] mise en file de « ${c.name} » : ${errText(inner)}`);
      }
    }
  }

  /** Emails handed to the provider today (UTC): persisted in sends_daily, cached and bumped as we send. */
  private sentToday = { day: '', count: 0 };
  private warmupLogged = '';
  private windowLogged = '';

  /** Reads today's counter (sends_daily); the first time of a day without one, estimates it from an index. */
  private loadSentToday(admins: string[]): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.sentToday.day === today) return;
    const row = get<{ count: number }>(this.db, 'SELECT count FROM sends_daily WHERE day = ?', today);
    let count = row ? Number(row.count) : 0;
    if (!row && this.config.warmup) {
      // Day started before this counter existed (deploy day): one index range count per account.
      const since = `${today}T00:00:00.000Z`;
      for (const a of all<{ id: string }>(this.db, 'SELECT id FROM accounts')) {
        count += scalar(
          this.db,
          `SELECT COUNT(*) FROM messages WHERE account_id = ? AND sent_at >= ?${admins.includes(a.id) ? ' AND campaign_id IS NOT NULL' : ''}`,
          a.id,
          since,
        );
      }
    }
    if (!row) run(this.db, 'INSERT OR IGNORE INTO sends_daily (day, count) VALUES (?, ?)', today, count);
    this.sentToday = { day: today, count };
  }

  private countSent(): void {
    this.sentToday.count++;
    run(this.db, 'INSERT INTO sends_daily (day, count) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET count = count + 1', this.sentToday.day);
  }

  /**
   * Today's warm-up cap (null when no warm-up is configured). Everything counts toward it except the
   * platform admin's own automation / transactional emails; the admin's campaigns do count, since they
   * share the same IP reputation.
   */
  private warmupLimit(): { limit: number; day: number } | null {
    const w = this.config.warmup;
    if (!w) return null;
    const start = Date.parse(`${w.startDate.slice(0, 10)}T00:00:00Z`);
    const day = Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 86_400_000)) : 0;
    return { limit: Math.min(w.max, Math.round(w.initial * Math.pow(w.growth, day))), day };
  }

  /** Fraction of today's sending window already elapsed (0 before it opens, 1 once it is closed). */
  private windowFraction(): number {
    const { startHour, endHour, timeZone } = this.config.sendWindow;
    let hour = 0;
    let minute = 0;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    } catch {
      return 1; // unknown time zone: no window
    }
    const span = Math.max(1, (endHour - startHour) * 60);
    const elapsed = (hour - startHour) * 60 + minute;
    if (elapsed < 0) return 0;
    // A quarter of an hour ahead, so the drip starts as soon as the window opens.
    return Math.min(1, (elapsed + 15) / span);
  }

  /** How many campaign emails may leave right now: today's cap, released gradually over the sending window. */
  private campaignAllowance(cap: { limit: number; day: number } | null): number {
    if (!cap) return Infinity;
    const today = new Date().toISOString().slice(0, 10);
    const { startHour, endHour } = this.config.sendWindow;
    const fraction = this.windowFraction();
    const allowed = Math.max(0, Math.ceil(cap.limit * fraction) - this.sentToday.count);
    if (!allowed && this.sentToday.count >= cap.limit && this.warmupLogged !== today) {
      this.warmupLogged = today;
      this.log.info(`[worker] warm-up : plafond du jour atteint (${cap.limit} emails, jour ${cap.day + 1}), la suite partira demain à partir de ${startHour} h`);
    } else if (!allowed && fraction === 0 && this.windowLogged !== today) {
      this.windowLogged = today;
      this.log.info(`[worker] campagnes en attente : envoi étalé entre ${startHour} h et ${endHour} h`);
    }
    return allowed;
  }

  private static readonly COLS = `SELECT rowid AS rid, id, account_id, campaign_id, automation_id, contact_id, to_email, subject, html, attempts
    FROM messages`;
  private static readonly DUE = '(next_attempt_at IS NULL OR next_attempt_at <= ?)';

  /** Next due messages of one campaign: an index range on the queue, whatever the campaign size. */
  private campaignQueue(campaignId: string, limit: number): Queued[] {
    return all<Queued>(
      this.db,
      `${SendingWorker.COLS} WHERE in_queue = 1 AND campaign_id = ? AND ${SendingWorker.DUE} ORDER BY rowid LIMIT ?`,
      campaignId,
      now(),
      limit,
    );
  }

  /**
   * Campaign emails for this batch: shared between the accounts sending, then between each account's
   * campaigns, starting from a different one each tick, so a 2-million-recipient campaign never starves the others.
   */
  private pickCampaignMessages(room: number): Queued[] {
    const active = all<{ id: string; account_id: string }>(
      this.db,
      "SELECT id, account_id FROM campaigns WHERE status = 'sending' AND paused_reason IS NULL AND deleted_at IS NULL ORDER BY created_at, id",
    );
    if (!active.length || room <= 0) return [];
    const byAccount = new Map<string, string[]>();
    for (const c of active) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c.id]);
    const accounts = [...byAccount.values()];
    const rotate = <T>(list: T[], by: number) => list.map((_, i) => list[(i + by) % list.length]);
    const lists: Queued[][] = [];
    const taken = new Map<string, number>();
    let left = room;
    // Two passes: an even share first, then what the smaller queues left over goes to the others.
    for (let pass = 0; pass < 2 && left > 0; pass++) {
      const order = rotate(accounts, this.rr % accounts.length);
      const share = Math.ceil(left / order.length);
      for (const campaigns of order) {
        let accountLeft = Math.min(share, left);
        const inner = rotate(campaigns, this.rr % campaigns.length);
        for (let i = 0; i < inner.length && accountLeft > 0; i++) {
          const id = inner[i];
          const already = taken.get(id) ?? 0;
          if (already < 0) continue; // drained in the first pass
          const want = Math.ceil(accountLeft / (inner.length - i));
          const rows = pass === 0 ? this.campaignQueue(id, want) : this.campaignQueue(id, already + want).slice(already);
          if (rows.length < want) taken.set(id, -1);
          else taken.set(id, already + rows.length);
          if (rows.length) lists.push(rows);
          accountLeft -= rows.length;
          left -= rows.length;
        }
        if (left <= 0) break;
      }
    }
    this.rr++;
    // Interleave the campaigns so they leave side by side.
    const out: Queued[] = [];
    for (let i = 0; out.length < room && lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (i < l.length && out.length < room) out.push(l[i]);
    }
    return out;
  }

  /** Why this queued email must not leave any more (null: it can go). Read fresh, right before the send. */
  private holdOrSkip(m: Queued): 'hold' | string | null {
    if (m.campaign_id) {
      const c = get<{ status: string; paused_reason: string | null; deleted_at: string | null }>(
        this.db,
        'SELECT status, paused_reason, deleted_at FROM campaigns WHERE id = ?',
        m.campaign_id,
      );
      // Paused: kept in the queue. Stopped / deleted: its queue is being purged.
      if (!c || c.status !== 'sending' || c.paused_reason || c.deleted_at) return 'hold';
    }
    if (m.campaign_id || m.automation_id) {
      if (!m.contact_id) return 'skipped: contact deleted';
      const contact = get<{ status: string }>(this.db, 'SELECT status FROM contacts WHERE id = ?', m.contact_id);
      if (!contact) return 'skipped: contact deleted';
      // Campaigns: subscribed contacts only. Automations already chose (transactional ones reach unsubscribed
      // customers on purpose), but never a hard-bounced or complaining address.
      if (m.campaign_id ? contact.status !== 'subscribed' : contact.status === 'bounced' || contact.status === 'complained') {
        return `skipped: contact ${contact.status}`;
      }
    }
    return null;
  }

  private async sendBatch(): Promise<number> {
    if (Date.now() < this.providerPausedUntil) return 0;
    const cols = SendingWorker.COLS;
    const due = SendingWorker.DUE;
    const size = this.config.worker.batchSize;
    const admins = this.config.warmup ? platformAdminAccountIds(this.db) : [];
    const inAdmins = admins.map(() => '?').join(',');
    const notAdmin = admins.length ? ` AND account_id NOT IN (${inAdmins})` : '';
    this.loadSentToday(admins);
    const cap = this.warmupLimit();
    const dailyLeft = cap ? Math.max(0, cap.limit - this.sentToday.count) : Infinity;
    const batch: Queued[] = [];

    // 1. The platform admin's own automation / transactional emails: outside the cap (tests, notifications).
    if (admins.length) {
      batch.push(...all<Queued>(this.db, `${cols} WHERE in_queue = 1 AND campaign_id IS NULL AND ${due} AND account_id IN (${inAdmins}) ORDER BY rowid LIMIT ?`, now(), ...admins, size));
    }
    // 2. Everyone else's automation / transactional emails (welcome, abandoned cart…): daily cap only, any hour.
    let room = Math.min(size - batch.length, dailyLeft);
    let counted = 0;
    if (room > 0) {
      const rows = all<Queued>(this.db, `${cols} WHERE in_queue = 1 AND campaign_id IS NULL AND ${due}${notAdmin} ORDER BY rowid LIMIT ?`, now(), ...admins, room);
      counted += rows.length;
      batch.push(...rows);
    }
    // 3. Campaign emails, the admin's included: daily cap, released gradually over the sending window.
    room = Math.min(size - batch.length, dailyLeft - counted, this.campaignAllowance(cap) - counted);
    if (room > 0) batch.push(...this.pickCampaignMessages(room));
    if (!batch.length) return 0;

    const minInterval = 1000 / this.config.worker.ratePerSecond;
    const senders = new Map<string, { name: string; email: string }>();
    const templates = new Map<string, ReturnType<typeof loadCampaignTemplate>>();
    let handled = 0;
    for (const message of batch) {
      if (Date.now() < this.providerPausedUntil || this.stopped) break;
      const verdict = this.holdOrSkip(message);
      if (verdict === 'hold') continue;
      if (verdict) {
        // Unsubscribed, bounced, complained or deleted since it was queued: never sent.
        markFailed(this.db, message.id, verdict);
        handled++;
        continue;
      }
      // Claim: still queued (a stop or a delete may have removed it while the batch was going).
      if (!run(this.db, "UPDATE messages SET attempts = attempts + 1 WHERE id = ? AND status = 'queued' AND in_queue = 1", message.id)) {
        run(this.db, "UPDATE messages SET in_queue = 0 WHERE id = ? AND in_queue = 1 AND status != 'queued'", message.id);
        continue;
      }
      const attempt = Number(message.attempts) + 1;
      handled++;
      const started = Date.now();
      try {
        let subject = message.subject;
        let html = message.html;
        if (!html && message.campaign_id) {
          // Campaign emails are stored without their HTML: rendered here, exactly as they used to be at queueing.
          if (!templates.has(message.campaign_id)) templates.set(message.campaign_id, loadCampaignTemplate(this.db, message.campaign_id));
          const rendered = renderCampaignMessage(this.db, this.config, message, { campaign: templates.get(message.campaign_id) });
          if (!rendered) {
            markFailed(this.db, message.id, 'campaign not found');
            continue;
          }
          subject = rendered.subject;
          html = rendered.html;
        }
        const sender = this.senderFor(message.account_id, message.campaign_id, senders);
        const { providerId } = await this.provider.send({
          messageId: message.id,
          to: message.to_email,
          fromName: sender.name,
          fromEmail: sender.email,
          subject,
          html,
          text: htmlToText(html),
          unsubscribeUrl: `${this.config.publicUrl}/u/${message.id}`,
          accountId: message.account_id,
          campaignId: message.campaign_id,
        });
        markSent(this.db, message.id, providerId);
        this.failuresInRow = 0;
        this.breakerTrips = 0;
        if (message.campaign_id || !admins.includes(message.account_id)) this.countSent();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const kind = classifySendError(err);
        if (kind === 'permanent' || attempt >= MAX_SEND_ATTEMPTS) {
          markFailed(this.db, message.id, kind === 'permanent' ? reason : `${reason} (${attempt} attempts)`);
          this.log.error(`[worker] échec d'envoi à ${message.to_email} : ${reason}`);
        } else {
          markRetry(this.db, message.id, reason, new Date(Date.now() + retryDelayMs(attempt)).toISOString());
          this.log.error(`[worker] envoi à ${message.to_email} reporté (essai ${attempt}/${MAX_SEND_ATTEMPTS}) : ${reason}`);
        }
        if (kind === 'permanent') this.failuresInRow = 0;
        else if (++this.failuresInRow >= BREAKER_FAILURES) {
          const pause = Math.min(10 * 60_000, 30_000 * 2 ** this.breakerTrips++);
          this.providerPausedUntil = Date.now() + pause;
          this.failuresInRow = 0;
          this.log.error(`[worker] ${BREAKER_FAILURES} erreurs du fournisseur d'envoi d'affilée : envois suspendus ${Math.round(pause / 1000)} s`);
        }
      }
      const elapsed = Date.now() - started;
      if (elapsed < minInterval) await sleep(minInterval - elapsed);
    }
    return handled;
  }

  private senderFor(
    accountId: string,
    campaignId: string | null,
    cache: Map<string, { name: string; email: string }>,
  ): { name: string; email: string } {
    const key = `${accountId}:${campaignId ?? ''}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const fallback = accountSender(this.db, this.config, accountId);
    let sender = fallback;
    if (campaignId) {
      const c = get<{ from_name: string | null; from_email: string | null }>(
        this.db,
        'SELECT from_name, from_email FROM campaigns WHERE id = ?',
        campaignId,
      );
      // An address that is no longer allowed (domain removed, old draft) falls back to the account's default.
      sender = { name: c?.from_name || fallback.name, email: effectiveFrom(this.db, this.config, accountId, c?.from_email) };
    }
    cache.set(key, sender);
    return sender;
  }
}

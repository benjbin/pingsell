import type { AppConfig } from './config.js';
import { all, get, now, run, type DatabaseSync } from './db.js';
import { finalizeCampaigns, queueCampaign } from './services/campaigns.js';
import { processDueRuns, processScheduledTriggers, takeWebhooks } from './services/automations.js';
import { sendTeamNotifications, sendWebhooks } from './services/automationOutbox.js';
import { processAbandonedCarts } from './services/carts.js';
import { processTracking } from './services/webTracking.js';
import { finalizePushCampaigns, queuePushCampaigns, sendPushBatch } from './services/push.js';
import { processPushResends } from './services/pushGrowth.js';
import { accountSender, markFailed, markSent } from './services/messages.js';
import { effectiveFrom } from './services/sendingDomains.js';
import { platformAdminAccountIds } from './services/platformAdmin.js';
import { htmlToText } from './services/render.js';
import { convertEmailImages } from './services/emailImages.js';
import type { EmailProvider } from './services/mailer.js';
import { outsideLang } from './i18n.js';
import { guardCampaigns } from './services/deliverability.js';

export interface WorkerLogger {
  info(msg: string): void;
  error(msg: string): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-process background worker (setInterval loop):
 *  1. promotes due scheduled campaigns to `sending`
 *  2. queues messages for `sending` campaigns
 *  3. advances due automation runs
 *  4. sends queued messages in rate-limited batches
 *  5. marks finished campaigns as `sent`
 *  6. queues / sends push notifications (campaigns, resends to non-openers, automation steps, tests)
 */
export class SendingWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private rerun = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly config: AppConfig,
    private readonly provider: EmailProvider,
    private readonly log: WorkerLogger = { info: console.log, error: console.error },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.worker.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Requests an immediate tick (e.g. right after a campaign is sent). */
  kick(): void {
    // Leave the caller's request language behind: each job uses its account's language.
    setImmediate(() => outsideLang(() => void this.tick()));
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        this.promoteScheduled();
        await this.queueSendingCampaigns();
        processAbandonedCarts(this.db);
        processScheduledTriggers(this.db);
        processTracking(this.db);
        processDueRuns(this.db, this.config);
        for (const p of guardCampaigns(this.db)) {
          this.log.info(`[worker] campagne « ${p.name} » mise en pause automatiquement (${p.reason.kind} : ${p.reason.count}/${p.reason.of})`);
        }
        await sendWebhooks(takeWebhooks(), this.log);
        await sendTeamNotifications(this.db, this.config, this.provider);
        const sent = await this.sendBatch();
        finalizeCampaigns(this.db);
        queuePushCampaigns(this.db);
        processPushResends(this.db);
        const pushed = await sendPushBatch(this.db, this.config, this.config.worker.batchSize);
        finalizePushCampaigns(this.db);
        // Keep draining while there is a full batch of work pending.
        if (sent >= this.config.worker.batchSize || pushed >= this.config.worker.batchSize) this.rerun = true;
      } while (this.rerun && this.timer);
    } catch (err) {
      this.log.error(`[worker] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private promoteScheduled(): void {
    const changed = run(
      this.db,
      "UPDATE campaigns SET status = 'sending', updated_at = ? WHERE status = 'scheduled' AND scheduled_at <= ?",
      now(),
      now(),
    );
    if (changed) this.log.info(`[worker] ${changed} campagne(s) programmée(s) démarrée(s)`);
  }

  private async queueSendingCampaigns(): Promise<void> {
    const campaigns = all<{ id: string; name: string; account_id: string; html: string | null }>(
      this.db,
      `SELECT c.id, c.name, c.account_id, c.html FROM campaigns c
        WHERE c.status = 'sending' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = c.id)`,
    );
    for (const c of campaigns) {
      // Pictures Gmail can't show (SVG, WebP) become PNG/JPG first, so every recipient gets the same email.
      if (c.html) {
        try {
          const res = await convertEmailImages(this.db, this.config, c.account_id, c.html);
          if (res.converted) run(this.db, 'UPDATE campaigns SET html = ? WHERE id = ?', res.html, c.id);
          if (res.converted || res.failed.length) this.log.info(`[worker] campagne « ${c.name} » : ${res.converted} image(s) convertie(s)${res.failed.length ? `, échecs : ${res.failed.join(' ; ')}` : ''}`);
        } catch (err) {
          this.log.error(`[worker] conversion des images de « ${c.name} » : ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const queued = queueCampaign(this.db, this.config, c.id);
      this.log.info(`[worker] campagne « ${c.name} » : ${queued} message(s) en file`);
    }
  }

  /** Emails handed to the provider today (UTC), cached and bumped as we send. */
  private sentToday = { day: '', count: 0 };
  private warmupLogged = '';
  private windowLogged = '';

  /**
   * Today's warm-up cap (null when no warm-up is configured). Everything counts toward it except the
   * platform admin's own automation / transactional emails; the admin's campaigns do count, since they
   * share the same IP reputation.
   */
  private warmupLimit(admins: string[]): { limit: number; day: number } | null {
    const w = this.config.warmup;
    if (!w) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (this.sentToday.day !== today) {
      const inAdmins = admins.map(() => '?').join(',');
      const row = get<{ n: number }>(
        this.db,
        `SELECT COUNT(*) AS n FROM messages WHERE sent_at >= ? AND status IN ('sent','bounced')${admins.length ? ` AND NOT (account_id IN (${inAdmins}) AND campaign_id IS NULL)` : ''}`,
        `${today}T00:00:00.000Z`,
        ...admins,
      );
      this.sentToday = { day: today, count: Number(row?.n ?? 0) };
    }
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

  private async sendBatch(): Promise<number> {
    type Queued = { id: string; account_id: string; campaign_id: string | null; to_email: string; subject: string; html: string };
    const cols = 'SELECT id, account_id, campaign_id, to_email, subject, html FROM messages';
    // A paused campaign keeps its queue but sends nothing until it is resumed.
    const notPaused = "NOT EXISTS (SELECT 1 FROM campaigns p WHERE p.id = messages.campaign_id AND p.paused_reason IS NOT NULL)";
    const size = this.config.worker.batchSize;
    const admins = this.config.warmup ? platformAdminAccountIds(this.db) : [];
    const inAdmins = admins.map(() => '?').join(',');
    const notAdmin = admins.length ? ` AND account_id NOT IN (${inAdmins})` : '';
    const cap = this.warmupLimit(admins);
    const dailyLeft = cap ? Math.max(0, cap.limit - this.sentToday.count) : Infinity;
    const batch: Queued[] = [];

    // 1. The platform admin's own automation / transactional emails: outside the cap (tests, notifications).
    if (admins.length) {
      batch.push(...all<Queued>(this.db, `${cols} WHERE status = 'queued' AND campaign_id IS NULL AND account_id IN (${inAdmins}) ORDER BY created_at, rowid LIMIT ?`, ...admins, size));
    }
    // 2. Everyone else's automation / transactional emails (welcome, abandoned cart…): daily cap only, any hour.
    let room = Math.min(size - batch.length, dailyLeft);
    let counted = 0;
    if (room > 0) {
      const rows = all<Queued>(this.db, `${cols} WHERE status = 'queued' AND campaign_id IS NULL${notAdmin} ORDER BY created_at, rowid LIMIT ?`, ...admins, room);
      counted += rows.length;
      batch.push(...rows);
    }
    // 3. Campaign emails, the admin's included: daily cap, released gradually over the sending window.
    room = Math.min(size - batch.length, dailyLeft - counted, this.campaignAllowance(cap) - counted);
    if (room > 0) {
      batch.push(...all<Queued>(this.db, `${cols} WHERE status = 'queued' AND campaign_id IS NOT NULL AND ${notPaused} ORDER BY created_at, rowid LIMIT ?`, room));
    }
    if (!batch.length) return 0;

    const minInterval = 1000 / this.config.worker.ratePerSecond;
    const senders = new Map<string, { name: string; email: string }>();
    for (const message of batch) {
      const started = Date.now();
      const sender = this.senderFor(message.account_id, message.campaign_id, senders);
      try {
        const { providerId } = await this.provider.send({
          messageId: message.id,
          to: message.to_email,
          fromName: sender.name,
          fromEmail: sender.email,
          subject: message.subject,
          html: message.html,
          text: htmlToText(message.html),
          unsubscribeUrl: `${this.config.publicUrl}/u/${message.id}`,
          accountId: message.account_id,
          campaignId: message.campaign_id,
        });
        markSent(this.db, message.id, providerId);
        if (message.campaign_id || !admins.includes(message.account_id)) this.sentToday.count++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        markFailed(this.db, message.id, reason);
        this.log.error(`[worker] échec d'envoi à ${message.to_email} : ${reason}`);
      }
      const elapsed = Date.now() - started;
      if (elapsed < minInterval) await sleep(minInterval - elapsed);
    }
    return batch.length;
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

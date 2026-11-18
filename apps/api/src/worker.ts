import type { AppConfig } from './config.js';
import { all, get, now, run, type DatabaseSync } from './db.js';
import { finalizeCampaigns, queueCampaign } from './services/campaigns.js';
import { processDueRuns } from './services/automations.js';
import { processAbandonedCarts } from './services/carts.js';
import { finalizePushCampaigns, queuePushCampaigns, sendPushBatch } from './services/push.js';
import { processPushResends } from './services/pushGrowth.js';
import { accountSender, markFailed, markSent } from './services/messages.js';
import { htmlToText } from './services/render.js';
import type { EmailProvider } from './services/mailer.js';
import { outsideLang } from './i18n.js';

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
        this.queueSendingCampaigns();
        processAbandonedCarts(this.db);
        processDueRuns(this.db, this.config);
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

  private queueSendingCampaigns(): void {
    const campaigns = all<{ id: string; name: string }>(
      this.db,
      `SELECT c.id, c.name FROM campaigns c
        WHERE c.status = 'sending' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = c.id)`,
    );
    for (const c of campaigns) {
      const queued = queueCampaign(this.db, this.config, c.id);
      this.log.info(`[worker] campagne « ${c.name} » : ${queued} message(s) en file`);
    }
  }

  /** Emails handed to the provider today (UTC), cached and bumped as we send. */
  private sentToday = { day: '', count: 0 };
  private warmupLogged = '';

  /** How many more emails the IP warm-up allows today (Infinity when no warm-up is configured). */
  private warmupRemaining(): number {
    const w = this.config.warmup;
    if (!w) return Infinity;
    const today = new Date().toISOString().slice(0, 10);
    if (this.sentToday.day !== today) {
      const row = get<{ n: number }>(
        this.db,
        "SELECT COUNT(*) AS n FROM messages WHERE sent_at >= ? AND status IN ('sent','bounced')",
        `${today}T00:00:00.000Z`,
      );
      this.sentToday = { day: today, count: Number(row?.n ?? 0) };
    }
    const start = Date.parse(`${w.startDate.slice(0, 10)}T00:00:00Z`);
    const day = Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 86_400_000)) : 0;
    const limit = Math.min(w.max, Math.round(w.initial * Math.pow(w.growth, day)));
    const remaining = Math.max(0, limit - this.sentToday.count);
    if (!remaining && this.warmupLogged !== today) {
      this.warmupLogged = today;
      this.log.info(`[worker] warm-up : plafond du jour atteint (${limit} emails, jour ${day + 1}), la suite partira demain`);
    }
    return remaining;
  }

  private async sendBatch(): Promise<number> {
    const allowed = this.warmupRemaining();
    if (allowed <= 0) return 0;
    const batch = all<{
      id: string;
      account_id: string;
      campaign_id: string | null;
      to_email: string;
      subject: string;
      html: string;
    }>(
      this.db,
      "SELECT id, account_id, campaign_id, to_email, subject, html FROM messages WHERE status = 'queued' ORDER BY created_at LIMIT ?",
      Math.min(this.config.worker.batchSize, allowed),
    );
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
        this.sentToday.count++;
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
      sender = { name: c?.from_name || fallback.name, email: c?.from_email || fallback.email };
    }
    cache.set(key, sender);
    return sender;
  }
}

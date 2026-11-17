import type { AppConfig } from './config.js';
import { all, get, now, run, type DatabaseSync } from './db.js';
import { finalizeCampaigns, queueCampaign } from './services/campaigns.js';
import { processDueRuns } from './services/automations.js';
import { accountSender, markFailed, markSent } from './services/messages.js';
import { htmlToText } from './services/render.js';
import type { EmailProvider } from './services/mailer.js';

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
    setImmediate(() => void this.tick());
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
        processDueRuns(this.db, this.config);
        const sent = await this.sendBatch();
        finalizeCampaigns(this.db);
        // Keep draining while there is a full batch of work pending.
        if (sent >= this.config.worker.batchSize) this.rerun = true;
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

  private async sendBatch(): Promise<number> {
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
      this.config.worker.batchSize,
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
        });
        markSent(this.db, message.id, providerId);
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

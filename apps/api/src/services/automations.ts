import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync, type Row } from '../db.js';
import { accountSender, createMessage } from './messages.js';
import { queuePushForContact } from './push.js';

export const TRIGGERS = ['contact_created', 'tag_added', 'order_created', 'cart_abandoned'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wait'),
    hours: z.number().positive().max(24 * 365),
  }),
  z.object({
    type: z.literal('email'),
    subject: z.string().trim().min(1).max(300),
    html: z.string().min(1).max(500_000),
    preheader: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal('push'),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(500),
    url: z.string().trim().max(2000).nullable().optional(),
    image_url: z.string().trim().url().max(2000).nullable().optional(),
  }),
]);
export const stepsSchema = z.array(stepSchema).min(1).max(50);
export type AutomationStep = z.output<typeof stepSchema>;

export const triggerConfigSchema = z
  .object({
    tag: z.string().trim().min(1).max(64).optional(),
    min_total: z.number().nonnegative().optional(),
  })
  .loose();
export type TriggerConfig = z.output<typeof triggerConfigSchema>;

export function serializeAutomation(row: Row) {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name),
    trigger: row.trigger as Trigger,
    trigger_config: parseJson<TriggerConfig>(row.trigger_config, {}),
    steps: parseJson<AutomationStep[]>(row.steps, []),
    status: row.status as 'active' | 'paused',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function automationStats(db: DatabaseSync, automationId: string) {
  return {
    runs_active: scalar(db, "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND status = 'pending'", automationId),
    emails_sent: scalar(db, "SELECT COUNT(*) FROM messages WHERE automation_id = ? AND status = 'sent'", automationId),
    push_sent: scalar(db, "SELECT COUNT(*) FROM push_messages WHERE automation_id = ? AND status = 'sent'", automationId),
  };
}

function matchesConfig(trigger: Trigger, config: TriggerConfig, data: Record<string, unknown>): boolean {
  if (trigger === 'tag_added' && config.tag) {
    return typeof data.tag === 'string' && data.tag.trim().toLowerCase() === config.tag.trim().toLowerCase();
  }
  if (trigger === 'order_created' && config.min_total !== undefined) {
    const total = Number(data.total ?? data.total_price ?? 0);
    return Number.isFinite(total) && total >= config.min_total;
  }
  return true;
}

/**
 * Starts matching active automations for a contact.
 * Guards against duplicates: `contact_created` runs once per (automation, contact);
 * other triggers do not start a second run while one is still pending.
 * An `order_created` event cancels pending abandoned-cart runs for the contact.
 */
export function fireTrigger(
  db: DatabaseSync,
  accountId: string,
  contactId: string,
  trigger: Trigger,
  data: object = {},
): number {
  return transaction(db, () => {
    const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ? AND account_id = ?', contactId, accountId);
    if (!contact) return 0;

    if (trigger === 'order_created') {
      run(
        db,
        `UPDATE automation_runs SET status = 'cancelled'
          WHERE contact_id = ? AND status = 'pending'
            AND automation_id IN (SELECT id FROM automations WHERE account_id = ? AND trigger = 'cart_abandoned')`,
        contactId,
        accountId,
      );
    }
    if (contact.status !== 'subscribed') return 0;

    const automations = all(
      db,
      "SELECT * FROM automations WHERE account_id = ? AND trigger = ? AND status = 'active'",
      accountId,
      trigger,
    ).map(serializeAutomation);

    let started = 0;
    const timestamp = now();
    for (const automation of automations) {
      if (!matchesConfig(trigger, automation.trigger_config, data as Record<string, unknown>)) continue;
      const duplicateFilter = trigger === 'contact_created' ? "status != 'cancelled'" : "status = 'pending'";
      const existing = scalar(
        db,
        `SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND contact_id = ? AND ${duplicateFilter}`,
        automation.id,
        contactId,
      );
      if (existing > 0) continue;
      run(
        db,
        `INSERT INTO automation_runs (id, automation_id, contact_id, step_index, next_run_at, status, created_at)
         VALUES (?, ?, ?, 0, ?, 'pending', ?)`,
        newId(),
        automation.id,
        contactId,
        timestamp,
        timestamp,
      );
      started++;
    }
    return started;
  });
}

export function cancelRunsForContact(db: DatabaseSync, contactId: string): void {
  run(db, "UPDATE automation_runs SET status = 'cancelled' WHERE contact_id = ? AND status = 'pending'", contactId);
}

/**
 * Advances due automation runs: consecutive email / push steps are queued immediately,
 * a wait step reschedules the run. Paused automations keep their runs pending.
 */
export function processDueRuns(db: DatabaseSync, config: AppConfig, limit = 200): number {
  const due = all<{ id: string; automation_id: string; contact_id: string; step_index: number }>(
    db,
    `SELECT r.id, r.automation_id, r.contact_id, r.step_index
       FROM automation_runs r JOIN automations a ON a.id = r.automation_id
      WHERE r.status = 'pending' AND r.next_run_at <= ? AND a.status = 'active'
      ORDER BY r.next_run_at LIMIT ?`,
    now(),
    limit,
  );

  for (const runRow of due) {
    transaction(db, () => {
      const automation = serializeAutomation(get(db, 'SELECT * FROM automations WHERE id = ?', runRow.automation_id)!);
      const contact = get<{ id: string; email: string; first_name: string | null; last_name: string | null; status: string }>(
        db,
        'SELECT id, email, first_name, last_name, status FROM contacts WHERE id = ?',
        runRow.contact_id,
      );
      if (!contact || contact.status !== 'subscribed') {
        run(db, "UPDATE automation_runs SET status = 'cancelled' WHERE id = ?", runRow.id);
        return;
      }

      let index = Number(runRow.step_index);
      let nextRunAt = now();
      let waiting = false;
      const senderName = accountSender(db, config, automation.account_id).name;
      while (index < automation.steps.length) {
        const step = automation.steps[index];
        index++;
        if (step.type === 'wait') {
          nextRunAt = new Date(Date.now() + step.hours * 3_600_000).toISOString();
          waiting = true;
          break;
        }
        if (step.type === 'push') {
          // Contacts without the app simply skip this step.
          queuePushForContact(db, automation.account_id, contact.id, step, automation.id);
          continue;
        }
        createMessage(db, config, {
          accountId: automation.account_id,
          automationId: automation.id,
          contactId: contact.id,
          contact,
          subject: step.subject,
          html: step.html,
          preheader: step.preheader,
          senderName,
        });
      }

      const finished = !waiting && index >= automation.steps.length;
      run(
        db,
        'UPDATE automation_runs SET step_index = ?, next_run_at = ?, status = ? WHERE id = ?',
        index,
        nextRunAt,
        finished ? 'done' : 'pending',
        runRow.id,
      );
    });
  }
  return due.length;
}

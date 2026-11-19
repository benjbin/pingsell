import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { all, get, newId, now, parseJson, run, scalar, transaction, type DatabaseSync, type Row } from '../db.js';
import { accountSender, createMessage } from './messages.js';
import { queuePushForContact } from './push.js';
import { locale } from '../i18n.js';
import { recordEvent, updateContactColumns } from './contacts.js';
import { compileRules, loadSegmentRules } from './segments.js';
import { createHash } from 'node:crypto';

export const TRIGGERS = [
  'contact_created',
  'tag_added',
  'order_created',
  'cart_abandoned',
  'order_fulfilled',
  'app_signed_in',
  'push_subscribed',
  'event',
  'email_clicked',
  'date_anniversary',
  'inactive',
  'segment_entered',
  'page_visited',
  'product_viewed',
  'site_action',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** Actions que le script repère tout seul sur le site du marchand (déclencheur « Une action sur votre site »). */
export const SITE_ACTIONS = ['signup', 'login', 'newsletter', 'contact', 'form'] as const;
export type SiteAction = (typeof SITE_ACTIONS)[number];

/** « https://www.Exemple.fr/x » ou « www.exemple.fr » → « exemple.fr » (même règle que siteHost() des formulaires). */
export function hostOf(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** « Rappel Réservation » → « rappel_reservation »: the name a site sends and an automation listens to. */
export function normalizeEventName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/** Transactional triggers reach customers unsubscribed from marketing (never complaints or hard bounces). */
export const TRANSACTIONAL_TRIGGERS: readonly Trigger[] = ['order_fulfilled'];
/** A site event marked `transactional` (booking reminder, receipt…) also reaches unsubscribed customers. */
const reachable = (trigger: Trigger, status: string, data?: Record<string, unknown> | null) =>
  status === 'subscribed' ||
  ((TRANSACTIONAL_TRIGGERS.includes(trigger) || (trigger === 'event' && data?.transactional === true)) &&
    status !== 'complained' &&
    status !== 'bounced');

/** Conditions an `exit_if` step checks since the run started. */
export const EXIT_CONDITIONS = ['push_opened', 'email_opened', 'email_clicked', 'ordered'] as const;

/** What an « If / else » branch checks about the customer. */
export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email_opened') }),
  z.object({ type: z.literal('email_clicked') }),
  z.object({ type: z.literal('push_opened') }),
  z.object({ type: z.literal('ordered') }),
  z.object({
    type: z.literal('has_tag'),
    tag: z.string().trim().min(1).max(64),
  }),
  z.object({
    type: z.literal('in_segment'),
    segment_id: z.string().trim().min(1).max(64),
  }),
  z.object({ type: z.literal('has_app') }),
  z.object({ type: z.literal('total_spent'), min: z.number().nonnegative() }),
  z.object({
    type: z.literal('orders_count'),
    min: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('event_field'),
    field: z.string().trim().min(1).max(64),
    value: z.string().max(200),
  }),
]);
export type Condition = z.output<typeof conditionSchema>;

const leafStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wait'),
    hours: z
      .number()
      .positive()
      .max(24 * 365),
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
    /** Also add it to the notification centre inside the app (default: yes). */
    in_app: z.boolean().optional(),
  }),
  z.object({
    /** Waits until N hours before (or after) the date sent with the event, e.g. a booking reminder 24 h before. */
    type: z.literal('wait_until'),
    hours: z
      .number()
      .nonnegative()
      .max(24 * 365),
    direction: z.enum(['before', 'after']),
  }),
  z.object({
    type: z.literal('exit_if'),
    /** Ends the run when the customer already opened a notification / an email of this automation, or ordered. */
    condition: z.enum(EXIT_CONDITIONS),
  }),
  z.object({
    /** Adds or removes a tag on the customer (adding also starts « Tag ajouté » automations). */
    type: z.literal('tag'),
    action: z.enum(['add', 'remove']),
    tag: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((v) => v.toLowerCase()),
  }),
  z.object({
    /** Sends the customer and the event as JSON to any address (Zapier, Make, Slack, your server…). */
    type: z.literal('webhook'),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https:\/\//i.test(u) || process.env.ALLOW_HTTP_WEBHOOKS === '1', 'L’adresse doit commencer par https://'),
  }),
  z.object({
    /** Emails the merchant's team (new booking, VIP customer…). */
    type: z.literal('notify'),
    to: z.string().trim().max(500).optional(),
    subject: z.string().trim().min(1).max(300),
    message: z.string().trim().max(5000).optional(),
  }),
  z.object({
    /** Only goes on during the chosen days and hours (Paris time), otherwise waits for the next slot. */
    type: z.literal('send_window'),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start_hour: z.number().int().min(0).max(23),
    end_hour: z.number().int().min(1).max(24),
  }),
]);

export type LeafStep = z.output<typeof leafStepSchema>;
export type AutomationStep =
  | LeafStep
  | {
      type: 'branch';
      condition: Condition;
      yes: AutomationStep[];
      no: AutomationStep[];
    }
  | {
      type: 'split';
      percent: number;
      a: AutomationStep[];
      b: AutomationStep[];
    };

const branchListSchema: z.ZodType<AutomationStep[]> = z.lazy(() => z.array(stepSchema).max(50));
export const stepSchema: z.ZodType<AutomationStep> = z.lazy(() =>
  z.union([
    leafStepSchema,
    z.object({
      type: z.literal('branch'),
      condition: conditionSchema,
      yes: branchListSchema,
      no: branchListSchema,
    }),
    z.object({
      type: z.literal('split'),
      percent: z.number().int().min(1).max(99),
      a: branchListSchema,
      b: branchListSchema,
    }),
  ]),
) as z.ZodType<AutomationStep>;
export const stepsSchema = z.array(stepSchema).min(1).max(50);

/** Linear program the engine walks: branches become conditional jumps (run.step_index points into it). */
type Op =
  | LeafStep
  | { type: 'jump_unless'; condition: Condition; target: number }
  | { type: 'split_jump'; percent: number; target: number }
  | { type: 'jump'; target: number };

export function flattenSteps(steps: AutomationStep[], offset = 0): Op[] {
  const ops: Op[] = [];
  for (const step of steps) {
    if (step.type === 'branch' || step.type === 'split') {
      const head = ops.length;
      ops.push(
        step.type === 'branch'
          ? { type: 'jump_unless', condition: step.condition, target: -1 }
          : { type: 'split_jump', percent: step.percent, target: -1 },
      );
      ops.push(...flattenSteps(step.type === 'branch' ? step.yes : step.a, offset + ops.length));
      const skip = ops.length;
      ops.push({ type: 'jump', target: -1 });
      (ops[head] as { target: number }).target = offset + ops.length;
      ops.push(...flattenSteps(step.type === 'branch' ? step.no : step.b, offset + ops.length));
      (ops[skip] as { target: number }).target = offset + ops.length;
    } else {
      ops.push(step);
    }
  }
  return ops;
}

export const triggerConfigSchema = z
  .object({
    tag: z.string().trim().min(1).max(64).optional(),
    event: z.string().trim().min(1).max(64).transform(normalizeEventName).optional(),
    min_total: z.number().nonnegative().optional(),
    /** email_clicked: only links containing this text. */
    url_contains: z.string().trim().max(500).optional(),
    /** date_anniversary: contact field holding the date (« birthday », any attribute, or « created_at »). */
    field: z.string().trim().min(1).max(64).optional(),
    /** date_anniversary: start N days before the date. */
    days_before: z.number().int().min(0).max(60).optional(),
    /** inactive: no order for N days. */
    days: z.number().int().min(1).max(3650).optional(),
    /** segment_entered */
    segment_id: z.string().trim().min(1).max(64).optional(),
    /** product_viewed: hours without purchase before the journey starts. */
    hours: z.number().min(0.25).max(168).optional(),
    /** page_visited, product_viewed, site_action : un seul site (domaine) ; vide = tous les sites. */
    host: z
      .string()
      .trim()
      .max(253)
      .transform((v) => (v ? hostOf(v) || v.toLowerCase() : ''))
      .optional(),
    /** site_action : l'action repérée (création de compte, connexion…). */
    action: z.enum(SITE_ACTIONS).optional(),
    /** site_action : un formulaire précis (form_key) ; vide = tous les formulaires de cette action. */
    form: z.string().trim().max(200).optional(),
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
  if (trigger === 'event') {
    return !!config.event && typeof data.event === 'string' && normalizeEventName(config.event) === data.event;
  }
  if (trigger === 'tag_added' && config.tag) {
    return typeof data.tag === 'string' && data.tag.trim().toLowerCase() === config.tag.trim().toLowerCase();
  }
  if (trigger === 'site_action') {
    if (!config.action || data.action !== config.action) return false;
    if (config.host && data.host !== config.host) return false;
    return !config.form || data.form_key === config.form;
  }
  // « Page visitée » sur un seul site : le domaine de la page doit être celui choisi.
  if (trigger === 'page_visited' && config.host && (typeof data.url !== 'string' || hostOf(data.url) !== config.host)) return false;
  if ((trigger === 'email_clicked' || trigger === 'page_visited') && config.url_contains) {
    return typeof data.url === 'string' && data.url.toLowerCase().includes(config.url_contains.toLowerCase());
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
export function fireTrigger(db: DatabaseSync, accountId: string, contactId: string, trigger: Trigger, data: object = {}): number {
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
    const payload = data as Record<string, unknown>;
    if (!reachable(trigger, contact.status, payload)) return 0;

    const automations = all(
      db,
      "SELECT * FROM automations WHERE account_id = ? AND trigger = ? AND status = 'active'",
      accountId,
      trigger,
    ).map(serializeAutomation);

    let started = 0;
    const timestamp = now();
    for (const automation of automations) {
      if (!matchesConfig(trigger, automation.trigger_config, payload)) continue;
      if (trigger === 'event') {
        // Same event id sent again (booking moved): update the pending run instead of starting a second one.
        const eventKey = payload.id != null ? `${payload.event}:${String(payload.id)}` : null;
        if (eventKey) {
          const prev = get<{
            id: string;
            status: string;
            step_index: number;
            next_run_at: string;
          }>(
            db,
            "SELECT id, status, step_index, next_run_at FROM automation_runs WHERE automation_id = ? AND contact_id = ? AND event_key = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1",
            automation.id,
            contactId,
            eventKey,
          );
          if (prev) {
            if (prev.status === 'pending') {
              run(db, 'UPDATE automation_runs SET data = ? WHERE id = ?', JSON.stringify(payload), prev.id);
              // Waiting for the date and the date moved: re-evaluate that step now.
              const waitingOn = flattenSteps(automation.steps)[Number(prev.step_index) - 1];
              if (waitingOn?.type === 'wait_until' && prev.next_run_at > timestamp) {
                run(
                  db,
                  'UPDATE automation_runs SET step_index = ?, next_run_at = ? WHERE id = ?',
                  Number(prev.step_index) - 1,
                  timestamp,
                  prev.id,
                );
              }
            }
            continue;
          }
        }
        run(
          db,
          `INSERT INTO automation_runs (id, automation_id, contact_id, step_index, next_run_at, status, created_at, data, event_key)
           VALUES (?, ?, ?, 0, ?, 'pending', ?, ?, ?)`,
          newId(),
          automation.id,
          contactId,
          timestamp,
          timestamp,
          JSON.stringify(payload),
          eventKey,
        );
        started++;
        continue;
      }
      const duplicateFilter = trigger === 'contact_created' ? "status != 'cancelled'" : "status = 'pending'";
      const existing = scalar(
        db,
        `SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND contact_id = ? AND ${duplicateFilter}`,
        automation.id,
        contactId,
      );
      if (existing > 0) continue;
      // Keep what started the journey: {{event.checkout_url}}, {{event.total}}, {{event.url}}… in the messages.
      run(
        db,
        `INSERT INTO automation_runs (id, automation_id, contact_id, step_index, next_run_at, status, created_at, data)
         VALUES (?, ?, ?, 0, ?, 'pending', ?, ?)`,
        newId(),
        automation.id,
        contactId,
        timestamp,
        timestamp,
        JSON.stringify(payload ?? {}),
      );
      started++;
    }
    return started;
  });
}

/** A cancelled booking / appointment stops its reminders. Returns how many journeys were stopped. */
export function cancelEventRuns(db: DatabaseSync, accountId: string, contactId: string, event: string, id: string): number {
  return run(
    db,
    `UPDATE automation_runs SET status = 'cancelled'
      WHERE contact_id = ? AND event_key = ? AND status = 'pending'
        AND automation_id IN (SELECT id FROM automations WHERE account_id = ?)`,
    contactId,
    `${event}:${id}`,
    accountId,
  );
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Fills {{event.date}}, {{event.restaurant}}… with what the site sent (dates in plain words).
 * In email HTML the values are escaped: data from a website must never become markup or a link.
 */
export function fillEventTags(text: string, data: Record<string, unknown> | null, html = false): string {
  if (!data) return text;
  return text.replace(/\{\{\s*event\.([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g, (_m, key: string, fallback?: string) => {
    const out = eventValue(data, key, fallback);
    return html ? escHtml(out) : out;
  });
}

function eventValue(data: Record<string, unknown>, key: string, fallback?: string): string {
  const v = data[key] ?? (data.data as Record<string, unknown> | undefined)?.[key];
  if (v == null || v === '') return fallback ?? '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) {
    return new Date(v).toLocaleString(locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    });
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T12:00:00Z`).toLocaleDateString(locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Paris',
    });
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function cancelRunsForContact(db: DatabaseSync, contactId: string): void {
  run(db, "UPDATE automation_runs SET status = 'cancelled' WHERE contact_id = ? AND status = 'pending'", contactId);
}

/** Webhook calls produced by runs, sent by the worker outside the database transaction. */
const webhookQueue: Array<{ url: string; payload: unknown }> = [];
export const takeWebhooks = () => webhookQueue.splice(0, webhookQueue.length);

/** Paris wall-clock parts of an instant. */
function parisParts(t: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    wd,
  };
}
/** UTC instant of a Paris wall-clock time (handles summer / winter time). */
export function parisToUtc(y: number, m: number, d: number, h: number, min = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = parisParts(guess);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return guess - offset;
}
/** Next instant inside the window, or null when we're in it already. */
export function nextWindowStart(step: { days: number[]; start_hour: number; end_hour: number }, nowMs = Date.now()): number | null {
  const p = parisParts(nowMs);
  if (step.days.includes(p.wd) && p.h >= step.start_hour && p.h < step.end_hour) return null;
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i, 12));
    const wd = ((day.getUTCDay() + 6) % 7) + 1;
    if (!step.days.includes(wd)) continue;
    const at = parisToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), step.start_hour);
    if (at > nowMs) return at;
  }
  return null;
}

function evalCondition(
  db: DatabaseSync,
  c: Condition,
  ctx: {
    automationId: string;
    accountId: string;
    contactId: string;
    since: string;
    data: Record<string, unknown> | null;
  },
): boolean {
  switch (c.type) {
    case 'email_opened':
    case 'email_clicked':
    case 'push_opened':
    case 'ordered':
      return exitConditionMet(db, ctx.automationId, ctx.contactId, c.type, ctx.since);
    case 'has_tag': {
      const tags = parseJson<string[]>(
        get<{ tags: string }>(db, 'SELECT tags FROM contacts WHERE id = ?', ctx.contactId)?.tags ?? '[]',
        [],
      );
      return tags.map((x) => x.toLowerCase()).includes(c.tag.toLowerCase());
    }
    case 'in_segment': {
      const rules = loadSegmentRules(db, ctx.accountId, c.segment_id);
      if (!rules) return false;
      const compiled = compileRules(rules);
      return (
        scalar(
          db,
          `SELECT COUNT(*) FROM contacts WHERE id = ? AND account_id = ? AND ${compiled.sql}`,
          ctx.contactId,
          ctx.accountId,
          ...compiled.params,
        ) > 0
      );
    }
    case 'has_app':
      return scalar(db, 'SELECT COUNT(*) FROM push_devices WHERE contact_id = ? AND active = 1', ctx.contactId) > 0;
    case 'total_spent':
      return Number(get<{ v: number }>(db, 'SELECT total_spent AS v FROM contacts WHERE id = ?', ctx.contactId)?.v ?? 0) >= c.min;
    case 'orders_count':
      return Number(get<{ v: number }>(db, 'SELECT orders_count AS v FROM contacts WHERE id = ?', ctx.contactId)?.v ?? 0) >= c.min;
    case 'event_field': {
      const v = ctx.data?.[c.field] ?? (ctx.data?.data as Record<string, unknown> | undefined)?.[c.field];
      return v != null && String(v).trim().toLowerCase() === c.value.trim().toLowerCase();
    }
  }
}

/** Stable A/B draw per run: the same customer always stays in the same path. */
const inFirstPath = (runId: string, percent: number) =>
  parseInt(createHash('sha256').update(runId).digest('hex').slice(0, 8), 16) % 100 < percent;

const fillContactTags = (
  text: string,
  contact: {
    email: string;
    first_name: string | null;
    last_name: string | null;
  },
) =>
  text.replace(
    /\{\{\s*(first_name|last_name|email)\s*(?:\|([^}]*))?\}\}/g,
    (_m, k: 'first_name' | 'last_name' | 'email', fb?: string) => contact[k] || fb || '',
  );

/**
 * Advances due automation runs: consecutive email / push / tag… steps run immediately,
 * waits reschedule the run, branches jump. Paused automations keep their runs pending.
 */
export function processDueRuns(db: DatabaseSync, config: AppConfig, limit = 200): number {
  const due = all<{
    id: string;
    automation_id: string;
    contact_id: string;
    step_index: number;
    created_at: string;
    data: string | null;
  }>(
    db,
    `SELECT r.id, r.automation_id, r.contact_id, r.step_index, r.created_at, r.data
       FROM automation_runs r JOIN automations a ON a.id = r.automation_id
      WHERE r.status = 'pending' AND r.next_run_at <= ? AND a.status = 'active'
      ORDER BY r.next_run_at LIMIT ?`,
    now(),
    limit,
  );

  for (const runRow of due) {
    transaction(db, () => {
      const automation = serializeAutomation(get(db, 'SELECT * FROM automations WHERE id = ?', runRow.automation_id)!);
      const contact = get<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        status: string;
        tags: string;
        phone: string | null;
      }>(db, 'SELECT id, email, first_name, last_name, status, tags, phone FROM contacts WHERE id = ?', runRow.contact_id);
      const eventData = parseJson<Record<string, unknown> | null>(runRow.data, null);
      if (!contact || !reachable(automation.trigger, contact.status, eventData)) {
        run(db, "UPDATE automation_runs SET status = 'cancelled' WHERE id = ?", runRow.id);
        return;
      }

      const ops = flattenSteps(automation.steps);
      const ctx = {
        automationId: automation.id,
        accountId: automation.account_id,
        contactId: contact.id,
        since: String(runRow.created_at),
        data: eventData,
      };
      let index = Number(runRow.step_index);
      let nextRunAt = now();
      let waiting = false;
      let exited = false;
      let guard = 0;
      const senderName = accountSender(db, config, automation.account_id).name;
      while (index < ops.length && guard++ < 500) {
        const step = ops[index];
        index++;
        if (step.type === 'jump') {
          index = step.target;
          continue;
        }
        if (step.type === 'jump_unless') {
          if (!evalCondition(db, step.condition, ctx)) index = step.target;
          continue;
        }
        if (step.type === 'split_jump') {
          if (!inFirstPath(runRow.id, step.percent)) index = step.target;
          continue;
        }
        if (step.type === 'wait') {
          nextRunAt = new Date(Date.now() + step.hours * 3_600_000).toISOString();
          waiting = true;
          break;
        }
        if (step.type === 'wait_until') {
          const date = typeof eventData?.date === 'string' ? Date.parse(eventData.date) : NaN;
          // No date, or the moment already passed (booking made at the last minute): go on right away.
          if (Number.isNaN(date)) continue;
          const at = date + (step.direction === 'before' ? -1 : 1) * step.hours * 3_600_000;
          if (at <= Date.now()) continue;
          nextRunAt = new Date(at).toISOString();
          waiting = true;
          break;
        }
        if (step.type === 'send_window') {
          const at = nextWindowStart(step);
          if (at === null) continue;
          nextRunAt = new Date(at).toISOString();
          waiting = true;
          break;
        }
        if (step.type === 'exit_if') {
          if (exitConditionMet(db, automation.id, contact.id, step.condition, String(runRow.created_at))) {
            exited = true;
            break;
          }
          continue;
        }
        if (step.type === 'tag') {
          const tags = parseJson<string[]>(
            get<{ tags: string }>(db, 'SELECT tags FROM contacts WHERE id = ?', contact.id)?.tags ?? '[]',
            [],
          );
          const has = tags.includes(step.tag);
          if (step.action === 'add' && !has) {
            updateContactColumns(db, contact.id, {
              tags: JSON.stringify([...tags, step.tag]),
            });
            recordEvent(db, automation.account_id, contact.id, 'tag_added', {
              tag: step.tag,
              source: 'automation',
            });
            fireTrigger(db, automation.account_id, contact.id, 'tag_added', {
              tag: step.tag,
            });
          } else if (step.action === 'remove' && has) {
            updateContactColumns(db, contact.id, {
              tags: JSON.stringify(tags.filter((x) => x !== step.tag)),
            });
          }
          continue;
        }
        if (step.type === 'webhook') {
          const c = get<Record<string, unknown>>(
            db,
            'SELECT id, email, first_name, last_name, phone, tags, attributes, status, total_spent, orders_count, last_order_at, created_at FROM contacts WHERE id = ?',
            contact.id,
          )!;
          webhookQueue.push({
            url: step.url,
            payload: {
              automation: {
                id: automation.id,
                name: automation.name,
                trigger: automation.trigger,
              },
              contact: {
                ...c,
                tags: parseJson(String(c.tags ?? '[]'), []),
                attributes: parseJson(String(c.attributes ?? '{}'), {}),
              },
              event: eventData,
              sent_at: now(),
            },
          });
          continue;
        }
        if (step.type === 'notify') {
          const owner = get<{ email: string }>(db, 'SELECT email FROM accounts WHERE id = ?', automation.account_id);
          const to = (step.to?.trim() || owner?.email || '').slice(0, 500);
          if (to) {
            const fill = (x: string) => fillContactTags(fillEventTags(x, eventData), contact);
            run(
              db,
              `INSERT INTO team_notifications (id, account_id, automation_id, contact_id, to_email, subject, message, data, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
              newId(),
              automation.account_id,
              automation.id,
              contact.id,
              to,
              fill(step.subject),
              fill(step.message ?? ''),
              runRow.data,
              now(),
            );
          }
          continue;
        }
        if (step.type === 'push') {
          // Contacts without the app simply skip this step.
          queuePushForContact(
            db,
            automation.account_id,
            contact.id,
            {
              ...step,
              title: fillEventTags(step.title, eventData),
              body: fillEventTags(step.body, eventData),
            },
            automation.id,
            step.in_app === false ? ['push'] : ['push', 'in_app'],
          );
          continue;
        }
        createMessage(db, config, {
          accountId: automation.account_id,
          automationId: automation.id,
          contactId: contact.id,
          contact,
          subject: fillEventTags(step.subject, eventData),
          html: fillEventTags(step.html, eventData, true),
          preheader: step.preheader ? fillEventTags(step.preheader, eventData) : step.preheader,
          senderName,
        });
      }

      const finished = exited || (!waiting && index >= ops.length);
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

/** True when the goal of the automation is already reached for this run (stop sending). */
export function exitConditionMet(
  db: DatabaseSync,
  automationId: string,
  contactId: string,
  condition: (typeof EXIT_CONDITIONS)[number],
  since: string,
): boolean {
  if (condition === 'push_opened') {
    return (
      scalar(
        db,
        'SELECT COUNT(*) FROM push_messages WHERE automation_id = ? AND contact_id = ? AND created_at >= ? AND opened_at IS NOT NULL',
        automationId,
        contactId,
        since,
      ) +
        scalar(
          db,
          'SELECT COUNT(*) FROM app_inbox WHERE automation_id = ? AND contact_id = ? AND created_at >= ? AND read_at IS NOT NULL',
          automationId,
          contactId,
          since,
        ) >
      0
    );
  }
  if (condition === 'email_opened' || condition === 'email_clicked') {
    const col = condition === 'email_opened' ? 'opened_at' : 'clicked_at';
    return (
      scalar(
        db,
        `SELECT COUNT(*) FROM messages WHERE automation_id = ? AND contact_id = ? AND created_at >= ? AND ${col} IS NOT NULL`,
        automationId,
        contactId,
        since,
      ) > 0
    );
  }
  return scalar(db, "SELECT COUNT(*) FROM events WHERE contact_id = ? AND type = 'order' AND created_at > ?", contactId, since) > 0;
}

/* ---------------------------------------------------------------- time-based triggers */

/** Starts one automation for one contact, once per `key` (birthday year, inactivity period, segment entry). */
export function startOnce(db: DatabaseSync, automationId: string, contactId: string, key: string, data: Record<string, unknown>): boolean {
  const fresh = run(
    db,
    'INSERT OR IGNORE INTO automation_seen (automation_id, contact_id, key, created_at) VALUES (?, ?, ?, ?)',
    automationId,
    contactId,
    key,
    now(),
  );
  if (!fresh) return false;
  const ts = now();
  run(
    db,
    `INSERT INTO automation_runs (id, automation_id, contact_id, step_index, next_run_at, status, created_at, data, event_key) VALUES (?, ?, ?, 0, ?, 'pending', ?, ?, ?)`,
    newId(),
    automationId,
    contactId,
    ts,
    ts,
    JSON.stringify(data),
    key,
  );
  return true;
}

/**
 * A known, subscribed contact opened a page of the site: matching « Page visitée » journeys start,
 * at most once a day each (a customer browsing ten pages gets one email, not ten).
 */
export function firePageVisited(db: DatabaseSync, accountId: string, contactId: string, data: Record<string, unknown>): number {
  const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ? AND account_id = ?', contactId, accountId);
  if (contact?.status !== 'subscribed') return 0;
  const day = parisParts(Date.now());
  let started = 0;
  for (const a of all(db, "SELECT * FROM automations WHERE account_id = ? AND trigger = 'page_visited' AND status = 'active'", accountId).map(serializeAutomation)) {
    if (!matchesConfig('page_visited', a.trigger_config, data)) continue;
    if (scalar(db, "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND contact_id = ? AND status = 'pending'", a.id, contactId) > 0) continue;
    if (startOnce(db, a.id, contactId, `page:${day.y}-${day.m}-${day.d}`, data)) started++;
  }
  return started;
}

/**
 * « Une action sur votre site » : un contact abonné vient de créer un compte, se connecter, s'inscrire à la
 * newsletter, écrire via un formulaire… Une création de compte démarre chaque automatisation au plus une
 * fois par contact (à vie) ; les autres actions au plus une fois par jour. Le même envoi reçu deux fois
 * ne démarre donc jamais deux parcours.
 */
export function fireSiteAction(
  db: DatabaseSync,
  accountId: string,
  contactId: string,
  data: { action: SiteAction; host: string; form_key: string; site: string; page: string; form: string },
): number {
  return transaction(db, () => {
    const contact = get<{ status: string }>(db, 'SELECT status FROM contacts WHERE id = ? AND account_id = ?', contactId, accountId);
    if (contact?.status !== 'subscribed') return 0;
    const day = parisParts(Date.now());
    let started = 0;
    for (const a of all(db, "SELECT * FROM automations WHERE account_id = ? AND trigger = 'site_action' AND status = 'active'", accountId).map(serializeAutomation)) {
      if (!matchesConfig('site_action', a.trigger_config, data)) continue;
      const key = data.action === 'signup' ? 'site:signup' : `site:${data.action}:${day.y}-${day.m}-${day.d}`;
      if (data.action !== 'signup' && scalar(db, "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND contact_id = ? AND status = 'pending'", a.id, contactId) > 0) continue;
      if (startOnce(db, a.id, contactId, key, data)) started++;
    }
    return started;
  });
}

/** « 1990-05-14 », « 14/05/1990 », « 1990-05-14T… » → [month, day, year?]. */
function monthDay(v: unknown): [number, number, number | null] | null {
  if (typeof v !== 'string') return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return [Number(m[2]), Number(m[3]), Number(m[1])];
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) return [Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : null];
  return null;
}

let lastScheduledRun = 0;
/**
 * Birthdays / anniversaries, inactive customers, segment entries: checked every few minutes by the worker.
 * Each automation starts at most once per customer per occurrence (`automation_seen`).
 */
export function processScheduledTriggers(db: DatabaseSync, nowMs = Date.now(), force = false): number {
  const every = Number(process.env.SCHEDULED_TRIGGERS_MS ?? 300_000);
  if (!force && nowMs - lastScheduledRun < every) return 0;
  lastScheduledRun = nowMs;
  let started = 0;
  const automations = all(
    db,
    "SELECT * FROM automations WHERE status = 'active' AND trigger IN ('date_anniversary','inactive','segment_entered')",
  ).map(serializeAutomation);
  for (const a of automations) {
    transaction(db, () => {
      const cfg = a.trigger_config;
      if (a.trigger === 'date_anniversary') {
        const field = cfg.field || 'birthday';
        const target = parisParts(nowMs + (cfg.days_before ?? 0) * 86_400_000);
        const rows = all<{
          id: string;
          v: string | null;
          created_at: string;
          status: string;
        }>(
          db,
          field === 'created_at'
            ? 'SELECT id, created_at AS v, created_at, status FROM contacts WHERE account_id = ?'
            : `SELECT id, json_extract(attributes, '$.' || ?) AS v, created_at, status FROM contacts WHERE account_id = ? AND json_extract(attributes, '$.' || ?) IS NOT NULL`,
          ...(field === 'created_at' ? [a.account_id] : [field, a.account_id, field]),
        );
        for (const c of rows) {
          if (c.status !== 'subscribed') continue;
          const md = monthDay(c.v);
          if (!md || md[0] !== target.m || md[1] !== target.d) continue;
          if (field === 'created_at' && md[2] === target.y) continue; // signed up this year: not an anniversary yet
          const date = `${target.y}-${String(target.m).padStart(2, '0')}-${String(target.d).padStart(2, '0')}`;
          const years = md[2] ? target.y - md[2] : null;
          if (
            startOnce(db, a.id, c.id, `anniv:${target.y}`, {
              date,
              years,
              field,
            })
          )
            started++;
        }
      } else if (a.trigger === 'inactive') {
        const days = cfg.days ?? 90;
        const cutoff = new Date(nowMs - days * 86_400_000).toISOString();
        const rows = all<{ id: string; last_order_at: string }>(
          db,
          "SELECT id, last_order_at FROM contacts WHERE account_id = ? AND status = 'subscribed' AND orders_count > 0 AND last_order_at IS NOT NULL AND last_order_at <= ?",
          a.account_id,
          cutoff,
        );
        for (const c of rows)
          if (
            startOnce(db, a.id, c.id, `inactive:${c.last_order_at}`, {
              last_order_at: c.last_order_at,
              days,
            })
          )
            started++;
      } else if (a.trigger === 'segment_entered' && cfg.segment_id) {
        const rules = loadSegmentRules(db, a.account_id, cfg.segment_id);
        if (!rules) return;
        const compiled = compileRules(rules);
        const members = new Set(
          all<{ id: string }>(
            db,
            `SELECT id FROM contacts WHERE account_id = ? AND status = 'subscribed' AND ${compiled.sql}`,
            a.account_id,
            ...compiled.params,
          ).map((r) => r.id),
        );
        // First look: today's members are the baseline, only newcomers start the journey.
        const seeded =
          scalar(db, "SELECT COUNT(*) FROM automation_seen WHERE automation_id = ? AND contact_id = '' AND key = 'seg:seed'", a.id) > 0;
        const seen = new Set(
          all<{ contact_id: string }>(db, "SELECT contact_id FROM automation_seen WHERE automation_id = ? AND key = 'seg'", a.id).map(
            (r) => r.contact_id,
          ),
        );
        if (!seeded) {
          run(
            db,
            "INSERT OR IGNORE INTO automation_seen (automation_id, contact_id, key, created_at) VALUES (?, '', 'seg:seed', ?)",
            a.id,
            now(),
          );
          for (const id of members)
            run(
              db,
              "INSERT OR IGNORE INTO automation_seen (automation_id, contact_id, key, created_at) VALUES (?, ?, 'seg', ?)",
              a.id,
              id,
              now(),
            );
          return;
        }
        for (const id of members) if (!seen.has(id) && startOnce(db, a.id, id, 'seg', { segment_id: cfg.segment_id })) started++;
        // Left the segment: may enter again later.
        for (const id of seen)
          if (!members.has(id)) run(db, "DELETE FROM automation_seen WHERE automation_id = ? AND contact_id = ? AND key = 'seg'", a.id, id);
      }
    });
  }
  return started;
}

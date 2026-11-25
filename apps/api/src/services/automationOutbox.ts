import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { AppConfig } from '../config.js';
import { all, get, newId, now, parseJson, run, type DatabaseSync } from '../db.js';
import { t, withAccountLang } from '../i18n.js';
import type { EmailProvider } from './mailer.js';
import { renderSystemEmail } from './systemEmail.js';

/** The 8 16-bit groups of an IPv6 address (handles "::" and a trailing dotted IPv4), or null. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    v = v.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = v.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Private, loopback and link-local addresses: a merchant's webhook must never reach our own network. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true; // unparseable: refuse
    // ::/80 prefix: unspecified, loopback, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d) → judge the IPv4.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
      if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
      return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 (and /48 local use)
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // fe80::/10 link-local, fec0::/10 site-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g[0] === 0x2002) return isPrivateAddress(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/* -------------------------------------------------------------------------- */
/* Outgoing webhooks (automation step « Webhook »)                            */
/* -------------------------------------------------------------------------- */

/**
 * Durable outbox: a webhook step writes its call in the same transaction as the run (a rolled-back run sends
 * nothing, a restart loses nothing). The worker claims due rows, sends them signed, and retries with back-off.
 * Delivery is « at least once »: receivers deduplicate with the `Pingsell-Webhook-Id` header.
 * See apps/api/README.md « Webhooks sortants » for the signature format.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'Pingsell-Signature';
/** Delays before each retry (after the 1st, 2nd… failure); after the last one the call is marked failed. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
/** A claimed row not reported within this delay (process killed mid-send) is sent again. */
const LEASE_MS = 2 * 60_000;
const TIMEOUT_MS = 5_000;

export interface WebhookItem {
  url: string;
  payload: unknown;
  /** Outbox row (absent for a direct, unsigned call). */
  id?: string;
  accountId?: string;
  attempts?: number;
  /** Database the row lives in, to report the outcome. */
  db?: DatabaseSync;
}

/** Account's signing key (`whsec_…`), created on first use. */
export function webhookSecret(db: DatabaseSync, accountId: string): string {
  const current = get<{ webhook_secret: string | null }>(db, 'SELECT webhook_secret FROM accounts WHERE id = ?', accountId)?.webhook_secret;
  if (current) return current;
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  run(db, 'UPDATE accounts SET webhook_secret = ? WHERE id = ? AND webhook_secret IS NULL', secret, accountId);
  return get<{ webhook_secret: string | null }>(db, 'SELECT webhook_secret FROM accounts WHERE id = ?', accountId)?.webhook_secret ?? secret;
}

export function rotateWebhookSecret(db: DatabaseSync, accountId: string): string {
  run(db, 'UPDATE accounts SET webhook_secret = NULL WHERE id = ?', accountId);
  return webhookSecret(db, accountId);
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Receivers check it and refuse old timestamps. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Queues a webhook call, inside the caller's transaction. */
export function enqueueWebhook(
  db: DatabaseSync,
  input: { accountId: string; automationId?: string | null; contactId?: string | null; url: string; payload: unknown },
): string {
  const id = newId();
  const ts = now();
  run(
    db,
    `INSERT INTO webhook_outbox (id, account_id, automation_id, contact_id, url, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    id,
    input.accountId,
    input.automationId ?? null,
    input.contactId ?? null,
    input.url,
    JSON.stringify(input.payload ?? null),
    ts,
    ts,
  );
  return id;
}

let lastOutboxPrune = 0;

/** Claims up to `limit` due calls (2-minute lease), oldest first. Prunes old rows once an hour, in small batches. */
export function claimWebhooks(db: DatabaseSync, limit = 25): WebhookItem[] {
  if (Date.now() - lastOutboxPrune > 3_600_000) {
    lastOutboxPrune = Date.now();
    // Payloads carry customer data: delivered calls are kept 2 days, failed ones 14 days.
    run(
      db,
      "DELETE FROM webhook_outbox WHERE rowid IN (SELECT rowid FROM webhook_outbox WHERE status = 'sent' AND next_attempt_at < ? LIMIT 5000)",
      new Date(Date.now() - 2 * 86_400_000).toISOString(),
    );
    run(
      db,
      "DELETE FROM webhook_outbox WHERE rowid IN (SELECT rowid FROM webhook_outbox WHERE status = 'failed' AND next_attempt_at < ? LIMIT 5000)",
      new Date(Date.now() - 14 * 86_400_000).toISOString(),
    );
  }
  const ts = now();
  const due = (status: string, n: number) =>
    all<{ id: string; account_id: string; url: string; payload: string; attempts: number }>(
      db,
      'SELECT id, account_id, url, payload, attempts FROM webhook_outbox WHERE status = ? AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?',
      status,
      ts,
      n,
    );
  // Leases that expired (process stopped mid-send) first, then the queue.
  const rows = due('sending', limit);
  if (rows.length < limit) rows.push(...due('queued', limit - rows.length));
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  const claimed: WebhookItem[] = [];
  for (const r of rows) {
    if (!run(db, "UPDATE webhook_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND next_attempt_at <= ?", lease, r.id, ts)) continue;
    claimed.push({ id: r.id, accountId: r.account_id, url: r.url, payload: parseJson<unknown>(r.payload, null), attempts: Number(r.attempts) + 1, db });
  }
  return claimed;
}

class WebhookError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

/**
 * Resolves the host once, refuses private addresses, and returns a lookup that always answers that same
 * address: the connection cannot be sent elsewhere between the check and the call (DNS rebinding).
 */
export async function pinnedLookup(hostname: string): Promise<LookupFunction> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addrs.length) throw new WebhookError('no address', true);
  if (process.env.ALLOW_PRIVATE_WEBHOOKS !== '1' && addrs.some((x) => isPrivateAddress(x.address))) throw new WebhookError('private address refused', false);
  const pinned = addrs[0]!;
  return ((_name: string, options: { all?: boolean } | undefined, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
    else cb(null, pinned.address, pinned.family);
  }) as unknown as LookupFunction;
}

/** One POST connected to the pinned address (TLS still checks the certificate against the host name). */
async function postOnce(url: string, body: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.ALLOW_HTTP_WEBHOOKS === '1')) throw new WebhookError('https required', false);
  const lookupFn = await pinnedLookup(u.hostname);
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const req = send(
      u,
      {
        method: 'POST',
        lookup: lookupFn,
        agent: false,
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (res) => {
        res.resume(); // the answer's body is not needed
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', (err) => reject(new WebhookError(err.message, true)));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (err) => reject(err instanceof WebhookError ? err : new WebhookError(err.message, true)));
    req.end(body);
  });
}

/**
 * Calls the merchant's webhooks (Zapier, Make, Slack…): https only, public addresses only (pinned), 5 s max,
 * signed with the account's key. Outbox rows are then marked sent, rescheduled with back-off, or failed.
 */
export async function sendWebhooks(items: WebhookItem[], log: { error: (m: string) => void }): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      let error: WebhookError | null = null;
      try {
        const body = JSON.stringify(item.payload ?? null);
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Pingsell-Webhook/1.0' };
        if (item.id && item.db && item.accountId) {
          headers['Pingsell-Webhook-Id'] = item.id;
          headers[WEBHOOK_SIGNATURE_HEADER] = signWebhook(webhookSecret(item.db, item.accountId), body);
        }
        const status = await postOnce(item.url, body, headers);
        // Redirects are not followed (a 3xx could point to a private address).
        if (status < 200 || status >= 300) throw new WebhookError(`HTTP ${status}`, status >= 500 || status === 429 || status === 408);
      } catch (err) {
        error = err instanceof WebhookError ? err : new WebhookError(err instanceof Error ? err.message : String(err), true);
        log.error(`[worker] webhook ${item.url} : ${error.message}`);
      }
      if (!item.id || !item.db) return;
      try {
        if (!error) {
          run(item.db, "UPDATE webhook_outbox SET status = 'sent', sent_at = ?, next_attempt_at = ?, last_error = NULL WHERE id = ?", now(), now(), item.id);
          return;
        }
        const delay = RETRY_DELAYS_MS[(item.attempts ?? 1) - 1];
        if (error.retry && delay !== undefined) {
          run(
            item.db,
            "UPDATE webhook_outbox SET status = 'queued', next_attempt_at = ?, last_error = ? WHERE id = ?",
            new Date(Date.now() + delay).toISOString(),
            error.message.slice(0, 500),
            item.id,
          );
        } else {
          run(item.db, "UPDATE webhook_outbox SET status = 'failed', next_attempt_at = ?, last_error = ? WHERE id = ?", now(), error.message.slice(0, 500), item.id);
        }
      } catch (err) {
        log.error(`[worker] webhook ${item.url} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}

interface TeamRow {
  id: string;
  account_id: string;
  to_email: string;
  subject: string;
  message: string;
  data: string | null;
  contact_id: string | null;
}

/** Alerts to the merchant's team (« Nouvelle réservation de Camille »). One bad row never blocks the others. */
export async function sendTeamNotifications(db: DatabaseSync, config: AppConfig, provider: EmailProvider): Promise<number> {
  const rows = all<TeamRow>(db, "SELECT * FROM team_notifications WHERE status = 'queued' ORDER BY created_at LIMIT 50");
  for (const row of rows) {
    let error: string | null = null;
    try {
      const contact = row.contact_id
        ? all<{ email: string; first_name: string | null; last_name: string | null }>(db, 'SELECT email, first_name, last_name FROM contacts WHERE id = ?', row.contact_id)[0]
        : undefined;
      const data = parseJson<Record<string, unknown> | null>(row.data, null);
      const { html, text } = withAccountLang(db, row.account_id, () => {
        const who = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email : '';
        const details = [
          ...(contact ? [`${t('Client', 'Customer')} : ${who}${who !== contact.email ? ` (${contact.email})` : ''}`] : []),
          ...Object.entries(data ?? {})
            .filter(([k, v]) => v != null && v !== '' && !['transactional', 'data'].includes(k) && typeof v !== 'object')
            .slice(0, 12)
            .map(([k, v]) => `${k} : ${String(v)}`),
        ];
        const base = config.webUrls[0] ?? config.publicUrl;
        return renderSystemEmail({
          appUrl: base,
          preheader: row.message || row.subject,
          eyebrow: t('Alerte automatisation', 'Automation alert'),
          title: [row.subject, ''],
          paragraphs: [...(row.message ? [row.message] : []), ...details],
          cta: { label: t('Voir le client', 'View customer'), url: `${base}/contacts` },
          reason: t('Vous recevez cette alerte car une de vos automatisations Pingsell vous l’envoie.', 'You receive this alert because one of your Pingsell automations sends it.'),
        });
      });
      for (const to of row.to_email.split(/[,;\s]+/).filter(Boolean).slice(0, 5)) {
        try {
          await provider.send({ messageId: `team_${row.id}_${to}`, to, fromName: 'Pingsell', fromEmail: config.defaultFromEmail, subject: row.subject, html, text });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    run(db, 'UPDATE team_notifications SET status = ?, error = ?, sent_at = ? WHERE id = ?', error ? 'failed' : 'sent', error, now(), row.id);
  }
  return rows.length;
}

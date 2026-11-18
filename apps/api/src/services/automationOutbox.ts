import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { AppConfig } from '../config.js';
import { all, now, run, type DatabaseSync } from '../db.js';
import { t, withAccountLang } from '../i18n.js';
import type { EmailProvider } from './mailer.js';
import { renderSystemEmail } from './systemEmail.js';

/** Private, loopback and link-local addresses: a merchant's webhook must never reach our own network. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Calls the merchant's webhooks (Zapier, Make, Slack…): https only, public addresses only, 5 s max. */
export async function sendWebhooks(items: Array<{ url: string; payload: unknown }>, log: { error: (m: string) => void }): Promise<void> {
  await Promise.all(
    items.map(async ({ url, payload }) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && process.env.ALLOW_HTTP_WEBHOOKS !== '1') throw new Error('https required');
        const addrs = await lookup(u.hostname, { all: true });
        if (process.env.ALLOW_PRIVATE_WEBHOOKS !== '1' && addrs.some((x) => isPrivateAddress(x.address))) throw new Error('private address refused');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Pingsell-Webhook/1.0' },
          body: JSON.stringify(payload),
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        log.error(`[worker] webhook ${url} : ${err instanceof Error ? err.message : String(err)}`);
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

/** Alerts to the merchant's team (« Nouvelle réservation de Camille »). */
export async function sendTeamNotifications(db: DatabaseSync, config: AppConfig, provider: EmailProvider): Promise<number> {
  const rows = all<TeamRow>(db, "SELECT * FROM team_notifications WHERE status = 'queued' ORDER BY created_at LIMIT 50");
  for (const row of rows) {
    const contact = row.contact_id ? all<{ email: string; first_name: string | null; last_name: string | null }>(db, 'SELECT email, first_name, last_name FROM contacts WHERE id = ?', row.contact_id)[0] : undefined;
    const data = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null;
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
    let error: string | null = null;
    for (const to of row.to_email.split(/[,;\s]+/).filter(Boolean).slice(0, 5)) {
      try {
        await provider.send({ messageId: `team_${row.id}_${to}`, to, fromName: 'Pingsell', fromEmail: config.defaultFromEmail, subject: row.subject, html, text });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    run(db, 'UPDATE team_notifications SET status = ?, error = ?, sent_at = ? WHERE id = ?', error ? 'failed' : 'sent', error, now(), row.id);
  }
  return rows.length;
}

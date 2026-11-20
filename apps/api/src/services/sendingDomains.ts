import { generateKeyPairSync } from 'node:crypto';
import { resolveNs, resolveTxt } from 'node:dns/promises';
import type { AppConfig } from '../config.js';
import { get, newId, now, run, type DatabaseSync } from '../db.js';

/**
 * A merchant's own sending domain. We generate a DKIM key pair, the merchant publishes the public
 * key in their DNS, and once it is found there we sign their emails with it: `From: hello@shop.com`
 * then passes DMARC through DKIM alignment (the envelope sender stays on our bounce domain, so no
 * SPF change is needed on their side).
 */
export const DKIM_SELECTOR = 'pingsell';

export interface SendingDomainRow {
  id: string;
  account_id: string;
  domain: string;
  selector: string;
  private_key: string;
  public_key: string;
  status: 'pending' | 'verified';
  dmarc: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface DkimKey {
  domainName: string;
  keySelector: string;
  privateKey: string;
}

// Consumer mailboxes: their owners publish DMARC policies we can never satisfy.
const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'live.com', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'orange.fr', 'wanadoo.fr', 'free.fr',
  'sfr.fr', 'laposte.net', 'gmx.com', 'gmx.fr', 'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 'bbox.fr',
]);

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();

/** `https://www.Shop.com/` or `hello@shop.com` → `shop.com`-ish input cleanup. Returns null when invalid. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (d.includes('@')) d = domainOf(d);
  // A pasted website address (`https://www.shop.com/`) means the shop's domain itself.
  d = d.replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  return DOMAIN_RE.test(d) ? d : null;
}

export const isFreemail = (domain: string) => FREEMAIL.has(domain);

/** `p=` value of the DKIM record: base64 DER SubjectPublicKeyInfo. */
function newKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export const dkimHost = (row: Pick<SendingDomainRow, 'selector' | 'domain'>) => `${row.selector}._domainkey.${row.domain}`;
export const dkimValue = (row: Pick<SendingDomainRow, 'public_key'>) => `v=DKIM1; k=rsa; p=${row.public_key}`;
export const DMARC_SUGGESTION = 'v=DMARC1; p=none;';

export function getSendingDomain(db: DatabaseSync, accountId: string): SendingDomainRow | undefined {
  return get<SendingDomainRow>(db, 'SELECT * FROM sending_domains WHERE account_id = ?', accountId);
}

/** Replaces the account's sending domain with a new one (new key, pending verification). */
export function createSendingDomain(db: DatabaseSync, accountId: string, domain: string): SendingDomainRow {
  const { privateKey, publicKey } = newKeyPair();
  run(db, 'DELETE FROM sending_domains WHERE account_id = ?', accountId);
  run(db, 'UPDATE accounts SET from_email = NULL WHERE id = ?', accountId);
  run(
    db,
    `INSERT INTO sending_domains (id, account_id, domain, selector, private_key, public_key, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    newId(), accountId, domain, DKIM_SELECTOR, privateKey, publicKey, now(),
  );
  return getSendingDomain(db, accountId)!;
}

export function deleteSendingDomain(db: DatabaseSync, accountId: string): boolean {
  run(db, 'UPDATE accounts SET from_email = NULL WHERE id = ?', accountId);
  return run(db, 'DELETE FROM sending_domains WHERE account_id = ?', accountId) > 0;
}

type TxtLookup = (name: string) => Promise<string[][]>;

async function txtRecords(lookup: TxtLookup, name: string): Promise<string[]> {
  try {
    return (await lookup(name)).map((chunks) => chunks.join(''));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw err;
  }
}

const tag = (record: string, name: string) =>
  record.split(';').map((p) => p.trim()).find((p) => p.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1).replace(/\s+/g, '') ?? null;

/** Records whether the domain already publishes DMARC, so we don't ask for a second one. */
export async function refreshDmarc(db: DatabaseSync, row: SendingDomainRow, lookup: TxtLookup = resolveTxt): Promise<void> {
  try {
    const dmarc = (await txtRecords(lookup, `_dmarc.${row.domain}`)).find((r) => /^v=DMARC1/i.test(r.trim())) ?? null;
    run(db, 'UPDATE sending_domains SET dmarc = ? WHERE id = ?', dmarc, row.id);
  } catch {
    /* checked again on « Vérifier » */
  }
}

/** Looks the DKIM (required) and DMARC (recommended) records up and stores the result. */
export async function verifySendingDomain(db: DatabaseSync, row: SendingDomainRow, lookup: TxtLookup = resolveTxt): Promise<SendingDomainRow> {
  let error: string | null = null;
  let dmarc: string | null = null;
  try {
    const dkim = await txtRecords(lookup, dkimHost(row));
    const keys = dkim.map((r) => tag(r, 'p'));
    if (!dkim.length) error = 'dkim_missing';
    else if (!keys.includes(row.public_key)) error = 'dkim_mismatch';
    dmarc = (await txtRecords(lookup, `_dmarc.${row.domain}`)).find((r) => /^v=DMARC1/i.test(r.trim())) ?? null;
  } catch {
    error = 'dns_error';
  }
  const verified = !error;
  const timestamp = now();
  run(
    db,
    `UPDATE sending_domains SET status = ?, dmarc = ?, last_error = ?, last_checked_at = ?,
       verified_at = CASE WHEN ? THEN COALESCE(verified_at, ?) ELSE NULL END
     WHERE id = ?`,
    verified ? 'verified' : 'pending', dmarc, error, timestamp, verified ? 1 : 0, timestamp, row.id,
  );
  // On failure the chosen address is kept (it is only used once the domain is verified, see accountFromEmail).
  // First success with no address chosen: start sending from bonjour@<domain> right away (the merchant can change it).
  if (verified) run(db, 'UPDATE accounts SET from_email = ? WHERE id = ? AND from_email IS NULL', `bonjour@${row.domain}`, row.account_id);
  return getSendingDomain(db, row.account_id)!;
}

/** True when `email` is on this domain (or one of its subdomains), verified or not. */
export function onDomain(row: SendingDomainRow | undefined, email: string): boolean {
  if (!row) return false;
  const d = domainOf(email);
  return d === row.domain || d.endsWith(`.${row.domain}`);
}

/** True when `email` is on the account's verified domain (or one of its subdomains). */
export function onVerifiedDomain(row: SendingDomainRow | undefined, email: string): boolean {
  if (!row || row.status !== 'verified') return false;
  const d = domainOf(email);
  return d === row.domain || d.endsWith(`.${row.domain}`);
}

/** DKIM key to sign a message from `fromEmail` for this account, or null (we then use our own domain). */
export function dkimKeyFor(db: DatabaseSync, accountId: string, fromEmail: string): DkimKey | null {
  const row = getSendingDomain(db, accountId);
  if (!onVerifiedDomain(row, fromEmail)) return null;
  return { domainName: row!.domain, keySelector: row!.selector, privateKey: row!.private_key };
}

/** True when the account may send from `email`: our shared address, or an address on its verified domain. */
export function senderAllowed(db: DatabaseSync, config: AppConfig, accountId: string, email: string): boolean {
  const e = email.trim().toLowerCase();
  return e === config.defaultFromEmail.toLowerCase() || onVerifiedDomain(getSendingDomain(db, accountId), e);
}

/** The address a campaign really goes out from: its own if still allowed, else the account's default. */
export function effectiveFrom(db: DatabaseSync, config: AppConfig, accountId: string, email: string | null | undefined): string {
  return email && senderAllowed(db, config, accountId, email) ? email : accountFromEmail(db, config, accountId);
}

/** The account's default sender address: its own (verified) address, else ours. */
export function accountFromEmail(db: DatabaseSync, config: AppConfig, accountId: string): string {
  const own = get<{ from_email: string | null }>(db, 'SELECT from_email FROM accounts WHERE id = ?', accountId)?.from_email;
  return own && onVerifiedDomain(getSendingDomain(db, accountId), own) ? own : config.defaultFromEmail;
}

/** Public shape: never exposes the private key. */
export function serializeSendingDomain(row: SendingDomainRow, fromEmail: string | null) {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    from_email: fromEmail,
    last_error: row.last_error,
    last_checked_at: row.last_checked_at,
    verified_at: row.verified_at,
    created_at: row.created_at,
    records: [
      { type: 'TXT', host: dkimHost(row), value: dkimValue(row), required: true, ok: row.status === 'verified' },
      { type: 'TXT', host: `_dmarc.${row.domain}`, value: row.dmarc ?? DMARC_SUGGESTION, required: false, ok: !!row.dmarc },
    ],
  };
}

/** Where the merchant manages their DNS, guessed from the domain's name servers (to show the right guide). */
export type DnsProvider = 'ovh' | 'godaddy' | 'ionos' | 'gandi' | 'cloudflare' | 'wix' | 'squarespace' | 'aws' | 'google' | 'hostinger' | 'o2switch';

const NS_PROVIDERS: Array<[RegExp, DnsProvider]> = [
  [/\.(ovh\.net|anycast\.me|ovh\.ca)$/, 'ovh'],
  [/\.domaincontrol\.com$/, 'godaddy'],
  [/\.ui-dns\.(com|de|org|biz)$/, 'ionos'],
  [/\.gandi\.net$/, 'gandi'],
  [/\.cloudflare\.com$/, 'cloudflare'],
  [/\.wixdns\.net$/, 'wix'],
  [/\.(squarespacedns\.com|googledomains\.com)$/, 'squarespace'],
  [/\.awsdns-\d+\./, 'aws'],
  [/\.(dns-parking\.com|hostinger\.com)$/, 'hostinger'],
  [/\.o2switch\.net$/, 'o2switch'],
];

export async function detectDnsProvider(domain: string): Promise<DnsProvider | null> {
  // The zone may sit on the parent (shop.example.com → example.com).
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    try {
      const ns = await Promise.race([
        resolveNs(labels.slice(i).join('.')),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ]);
      for (const host of ns) {
        const hit = NS_PROVIDERS.find(([re]) => re.test(host.toLowerCase().replace(/\.$/, '')));
        if (hit) return hit[1];
      }
      if (ns.length) return null;
    } catch {
      /* try the parent zone */
    }
  }
  return null;
}

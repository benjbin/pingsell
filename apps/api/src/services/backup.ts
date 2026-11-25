// Sauvegardes chiffrées de la base : une copie cohérente (VACUUM INTO), compressée puis chiffrée en AES-256-GCM,
// gardée dans BACKUP_DIR (les N plus récentes) et, si un stockage S3 est configuré, envoyée hors du serveur.
// Sans BACKUP_ENCRYPTION_KEY, aucune sauvegarde n'est faite : on n'écrit jamais de copie en clair.
//
// Format d'un fichier .pgbk : « PGBK1 » (5 octets) + sel scrypt (16) + IV (12) + données chiffrées + tag GCM (16).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';

const MAGIC = Buffer.from('PGBK1');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;

export interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export interface BackupConfig {
  dir: string;
  key?: string;
  keep: number;
  intervalHours: number;
  s3?: S3Target;
}

const deriveKey = (secret: string, salt: Buffer) => scryptSync(secret, salt, 32);

/** Chiffre `src` vers `dest` (gzip puis AES-256-GCM, en flux). */
export async function encryptFile(src: string, dest: string, secret: string): Promise<void> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const out = createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(src), createGzip(), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

/** Déchiffre un fichier .pgbk vers `dest` (base SQLite en clair). Lève une erreur si la clé ou le fichier est mauvais. */
export async function decryptFile(src: string, dest: string, secret: string): Promise<void> {
  const size = statSync(src).size;
  if (size < HEADER_LEN + TAG_LEN) throw new Error('Fichier de sauvegarde trop court');
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  const fh = await open(src, 'r');
  try {
    await fh.read(header, 0, HEADER_LEN, 0);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Ce n'est pas une sauvegarde Pingsell (.pgbk)");
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 }), decipher, createGunzip(), createWriteStream(dest));
  } catch {
    rmSync(dest, { force: true });
    throw new Error('Déchiffrement impossible : mauvaise clé ou fichier abîmé');
  }
}

// --- S3 (signature AWS v4, compatible OVH Object Storage, Scaleway, AWS…) ---

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

export async function putS3Object(target: S3Target, key: string, body: Buffer): Promise<void> {
  const url = new URL(`${target.endpoint.replace(/\/+$/, '')}/${target.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'content-type': 'application/octet-stream',
  };
  const signed = Object.keys(headers).sort();
  const canonical = ['PUT', url.pathname, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${target.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${target.secretAccessKey}`, day), target.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const { host: _host, ...sent } = headers;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}` },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// --- Sauvegarde périodique ---

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^pingsell-\d{8}T\d{6}Z\.pgbk$/.test(f)).sort();
}

/** Fait une sauvegarde chiffrée maintenant. Renvoie le chemin du fichier créé. */
export async function runBackup(db: DatabaseSync, cfg: BackupConfig & { key: string }, date = new Date()): Promise<string> {
  mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
  const name = `pingsell-${stamp(date)}`;
  const plain = join(cfg.dir, `.${name}.db.tmp`);
  const dest = join(cfg.dir, `${name}.pgbk`);
  rmSync(plain, { force: true });
  try {
    db.prepare('VACUUM INTO ?').run(plain);
    await encryptFile(plain, `${dest}.tmp`, cfg.key);
  } finally {
    rmSync(plain, { force: true }); // la copie en clair ne reste jamais sur le disque
  }
  renameSync(`${dest}.tmp`, dest);
  if (cfg.s3) await putS3Object(cfg.s3, `${cfg.s3.prefix}${name}.pgbk`, readFileSync(dest));
  for (const old of listBackups(cfg.dir).slice(0, -cfg.keep)) rmSync(join(cfg.dir, old), { force: true });
  return dest;
}

/** Vrai si la dernière sauvegarde locale date de plus de `intervalHours`. */
export function backupDue(cfg: BackupConfig, at = Date.now()): boolean {
  const last = listBackups(cfg.dir).at(-1);
  if (!last) return true;
  return at - statSync(join(cfg.dir, last)).mtimeMs >= cfg.intervalHours * 3_600_000;
}

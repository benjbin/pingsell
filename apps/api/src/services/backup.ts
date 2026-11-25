// Sauvegardes chiffrées de la base : une copie cohérente (VACUUM INTO), compressée puis chiffrée en AES-256-GCM,
// gardée dans BACKUP_DIR (les N plus récentes) et, si un stockage S3 est configuré, envoyée hors du serveur.
// Sans BACKUP_ENCRYPTION_KEY, aucune sauvegarde n'est faite : on n'écrit jamais de copie en clair.
//
// La copie (VACUUM INTO, plusieurs minutes sur une grosse base) tourne dans un worker_thread avec sa propre
// connexion en lecture seule : le fil principal qui sert le HTTP n'est jamais bloqué. La compression, le
// chiffrement et l'envoi S3 sont des flux (rien n'est chargé en mémoire, pas de limite de taille de fichier).
//
// Format d'un fichier .pgbk : « PGBK1 » (5 octets) + sel scrypt (16) + IV (12) + données chiffrées + tag GCM (16).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { runInDbThread } from './dbThread.js';

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
// Le corps des fichiers n'est pas haché (x-amz-content-sha256: UNSIGNED-PAYLOAD) : il est envoyé en flux depuis
// le disque. Au-delà de S3_MULTIPART_THRESHOLD, envoi en plusieurs parties (un PUT unique est limité à 5 Go).

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
// Encodage URI strict d'AWS (RFC 3986) : encodeURIComponent laisse passer !'()*.
const awsEncode = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const S3_MULTIPART_THRESHOLD = 256 * 1024 * 1024;
const S3_MIN_PART = 64 * 1024 * 1024;
const S3_MAX_PARTS = 9_000; // S3 en accepte 10 000
const S3_PART_ATTEMPTS = 3;

type S3Body = Buffer | { length: number; open: () => Readable };

interface S3Response {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function s3Request(target: S3Target, method: string, key: string, query: Record<string, string>, body: S3Body | null): Promise<S3Response> {
  const base = new URL(target.endpoint.replace(/\/+$/, ''));
  const basePath = base.pathname.replace(/\/+$/, '');
  const path = `${basePath}/${awsEncode(target.bucket)}/${key.split('/').map(awsEncode).join('/')}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(query[k])}`)
    .join('&');
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = Buffer.isBuffer(body) ? sha256(body) : body ? 'UNSIGNED-PAYLOAD' : sha256('');
  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (body) headers['content-type'] = 'application/octet-stream';
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, canonicalQuery, ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${target.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${target.secretAccessKey}`, day), target.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const send = base.protocol === 'http:' ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      {
        hostname: base.hostname,
        port: base.port || undefined,
        method,
        path: canonicalQuery ? `${path}?${canonicalQuery}` : path,
        headers: {
          ...headers,
          'content-length': String(body ? body.length : 0),
          authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
        },
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size < 64 * 1024) chunks.push(c); // une réponse S3 tient en quelques Ko
          size += c.length;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('S3 : délai dépassé')));
    req.on('error', reject);
    if (!body) req.end();
    else if (Buffer.isBuffer(body)) req.end(body);
    else {
      const stream = body.open();
      stream.on('error', (err) => req.destroy(err));
      stream.pipe(req);
    }
  });
}

const s3Error = (what: string, res: S3Response) => new Error(`S3 ${what} ${res.status}: ${res.text.slice(0, 300)}`);
const s3Ok = (res: S3Response) => res.status >= 200 && res.status < 300;

/** Envoie un petit objet déjà en mémoire. */
export async function putS3Object(target: S3Target, key: string, body: Buffer): Promise<void> {
  const res = await s3Request(target, 'PUT', key, {}, body);
  if (!s3Ok(res)) throw s3Error('PUT', res);
}

/** Envoie un fichier en flux depuis le disque, en plusieurs parties s'il est gros. Jamais chargé en mémoire. */
export async function putS3File(target: S3Target, key: string, file: string, threshold = S3_MULTIPART_THRESHOLD, minPart = S3_MIN_PART): Promise<void> {
  const size = statSync(file).size;
  if (size <= threshold) {
    const res = await s3Request(target, 'PUT', key, {}, { length: size, open: () => createReadStream(file) });
    if (!s3Ok(res)) throw s3Error('PUT', res);
    return;
  }
  const init = await s3Request(target, 'POST', key, { uploads: '' }, null);
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(init.text)?.[1];
  if (!s3Ok(init) || !uploadId) throw s3Error('CreateMultipartUpload', init);
  const partSize = Math.max(minPart, Math.ceil(size / S3_MAX_PARTS));
  const parts: string[] = [];
  try {
    for (let n = 1, start = 0; start < size; n++, start += partSize) {
      const end = Math.min(start + partSize, size) - 1;
      let etag: string | undefined;
      for (let attempt = 1; !etag; attempt++) {
        try {
          const res = await s3Request(target, 'PUT', key, { partNumber: String(n), uploadId }, { length: end - start + 1, open: () => createReadStream(file, { start, end }) });
          if (!s3Ok(res) || typeof res.headers.etag !== 'string') throw s3Error(`UploadPart ${n}`, res);
          etag = res.headers.etag;
        } catch (err) {
          if (attempt >= S3_PART_ATTEMPTS) throw err;
        }
      }
      parts.push(etag);
    }
    const xml = `<CompleteMultipartUpload>${parts
      .map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`)
      .join('')}</CompleteMultipartUpload>`;
    const done = await s3Request(target, 'POST', key, { uploadId }, Buffer.from(xml));
    // S3 peut répondre 200 avec une erreur dans le corps.
    if (!s3Ok(done) || /<Error>/.test(done.text)) throw s3Error('CompleteMultipartUpload', done);
  } catch (err) {
    await s3Request(target, 'DELETE', key, { uploadId }, null).catch(() => undefined); // pas de parties orphelines facturées
    throw err;
  }
}

// --- Sauvegarde périodique ---

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
// Restes d'une sauvegarde interrompue (arrêt brutal, disque plein) : la copie en clair et le fichier chiffré partiel.
const LEFTOVER_RE = /^(\.pingsell-.+\.db\.tmp(-journal|-wal|-shm)?|pingsell-.+\.pgbk\.tmp)$/;
/** Espace libre exigé avant de commencer : copie en clair (≈ la base) + fichier chiffré + marge pour l'app. */
export const BACKUP_FREE_SPACE_FACTOR = 2.5;

function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^pingsell-\d{8}T\d{6}Z\.pgbk$/.test(f)).sort();
}

const fileSize = (path: string) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} Go`;

/**
 * Supprime les restes de sauvegardes interrompues (une copie en clair qui traîne est une fuite de données).
 * `olderThanMs` épargne une sauvegarde lancée au même moment par un autre processus (npm run backup).
 * Renvoie le nombre de fichiers supprimés.
 */
export function cleanBackupLeftovers(dir: string, olderThanMs = 0, at = Date.now()): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (!LEFTOVER_RE.test(f)) continue;
    const path = join(dir, f);
    try {
      if (olderThanMs > 0 && at - statSync(path).mtimeMs < olderThanMs) continue;
      rmSync(path, { force: true });
      removed++;
    } catch {
      // déjà supprimé
    }
  }
  return removed;
}

/** Garde les `keep` sauvegardes locales les plus récentes (au moins une). */
export function pruneBackups(dir: string, keep: number): number {
  const old = listBackups(dir).slice(0, -Math.max(1, keep));
  for (const f of old) rmSync(join(dir, f), { force: true });
  return old.length;
}

let running = false;
/** Vrai pendant une sauvegarde de ce processus. */
export const backupInProgress = (): boolean => running;

/**
 * Fait une sauvegarde chiffrée maintenant. Renvoie le chemin du fichier créé.
 * `source` : la connexion de l'API (seul son chemin sert : la copie se fait sur une connexion à elle, dans un
 * thread) ou directement le chemin de la base.
 * Lève une erreur, sans rien écrire, s'il n'y a pas assez de place sur le disque.
 */
export async function runBackup(source: DatabaseSync | string, cfg: BackupConfig & { key: string }, date = new Date()): Promise<string> {
  const dbPath = typeof source === 'string' ? source : source.location();
  if (!dbPath || dbPath === ':memory:') throw new Error('sauvegarde impossible : base en mémoire');
  if (running) throw new Error('une sauvegarde est déjà en cours');
  running = true;
  try {
    mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
    cleanBackupLeftovers(cfg.dir, 10 * 60_000);
    const dbBytes = fileSize(dbPath) + fileSize(`${dbPath}-wal`);
    const fs = statfsSync(cfg.dir);
    const free = Number(fs.bavail) * Number(fs.bsize);
    const needed = Math.ceil(dbBytes * BACKUP_FREE_SPACE_FACTOR);
    if (free < needed) {
      throw new Error(`espace disque insuffisant (${gb(free)} libres, ${gb(needed)} nécessaires = ${BACKUP_FREE_SPACE_FACTOR} × la base) : sauvegarde ignorée`);
    }
    // Espace vérifié : on libère la place de la plus ancienne avant d'écrire la nouvelle (keep - 1 anciennes + la nouvelle).
    // Si l'espace manque, rien n'est supprimé : les anciennes sauvegardes restent.
    pruneBackups(cfg.dir, cfg.keep - 1);

    const name = `pingsell-${stamp(date)}`;
    const plain = join(cfg.dir, `.${name}.db.tmp`);
    const dest = join(cfg.dir, `${name}.pgbk`);
    rmSync(plain, { force: true });
    try {
      await runInDbThread(dbPath, { op: 'vacuum-into', dest: plain });
      await encryptFile(plain, `${dest}.tmp`, cfg.key);
      renameSync(`${dest}.tmp`, dest);
    } finally {
      rmSync(plain, { force: true }); // la copie en clair ne reste jamais sur le disque
      rmSync(`${dest}.tmp`, { force: true });
    }
    // Rotation locale avant l'envoi : une panne S3 ne doit pas faire déborder le volume.
    pruneBackups(cfg.dir, cfg.keep);
    if (cfg.s3) await putS3File(cfg.s3, `${cfg.s3.prefix}${name}.pgbk`, dest);
    return dest;
  } finally {
    running = false;
  }
}

/** Vrai si la dernière sauvegarde locale date de plus de `intervalHours`. */
export function backupDue(cfg: BackupConfig, at = Date.now()): boolean {
  const last = listBackups(cfg.dir).at(-1);
  if (!last) return true;
  return at - statSync(join(cfg.dir, last)).mtimeMs >= cfg.intervalHours * 3_600_000;
}

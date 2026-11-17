import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { API_ROOT } from '../config.js';
import { all, get, newId, now, run } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, notFound, parse, zmsg } from '../lib/http.js';
import { t } from '../i18n.js';

/** Uploaded files live on disk; the DB only keeps metadata. */
export const UPLOAD_DIR = resolve(API_ROOT, process.env.UPLOAD_DIR?.trim() || './uploads');
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};
const STORED_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|woff2|woff|ttf|otf)$/;

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  data: z.string().min(1), // base64, optionally as a data: URL
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});

const brandKitSchema = z.object({
  brand_kit: z.string().max(200_000).nullable(),
});

const templateSchema = z.object({
  name: z.string().trim().min(1, zmsg('Donnez un nom au modèle', 'Give the template a name')).max(120),
  design: z.string().min(2).max(2_000_000),
});

interface AssetRow {
  id: string;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** Magic-number check: the declared type must match the bytes. */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 4).toString('ascii');
  if (head === 'wOF2') return 'font/woff2';
  if (head === 'wOFF') return 'font/woff';
  if (head === 'OTTO') return 'font/otf';
  if (head === 'true' || (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00)) return 'font/ttf';
  return null;
}

export function assetUrl(publicUrl: string, storedName: string): string {
  return `${publicUrl}/media/${storedName}`;
}

/** Public file serving — images in emails must be reachable without auth. */
export async function publicUploadRoutes(app: FastifyInstance) {
  app.get('/media/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!STORED_RE.test(file)) throw notFound(t('Fichier introuvable', 'File not found'));
    const path = resolve(UPLOAD_DIR, file);
    if (!existsSync(path)) throw notFound(t('Fichier introuvable', 'File not found'));
    const ext = file.split('.').pop()!;
    const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    return reply
      .type(mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      // Fonts are loaded cross-origin by mail clients and by the editor.
      .header('access-control-allow-origin', '*')
      .send(readFileSync(path));
  });
}

export async function libraryRoutes(app: FastifyInstance, { db, config }: Deps) {
  const serialize = (a: AssetRow) => ({
    id: a.id,
    filename: a.filename,
    url: assetUrl(config.publicUrl, a.stored_name),
    mime: a.mime,
    size: a.size,
    width: a.width,
    height: a.height,
    created_at: a.created_at,
  });

  // --- Media library ---------------------------------------------------------
  app.get('/assets', async (request) => {
    // The media library lists images; fonts are managed from the style panel.
    const kind = (request.query as { kind?: string }).kind === 'font' ? 'font/%' : 'image/%';
    const rows = all<AssetRow>(db, 'SELECT * FROM assets WHERE account_id = ? AND mime LIKE ? ORDER BY created_at DESC LIMIT 200', request.accountId, kind);
    return { data: rows.map(serialize) };
  });

  app.post('/assets', async (request, reply) => {
    const body = parse(uploadSchema, request.body);
    const b64 = body.data.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) throw badRequest(t('Fichier vide', 'Empty file'));
    if (buf.length > MAX_BYTES) throw badRequest(t('Fichier trop lourd (8 Mo maximum)', 'File too large (8 MB max)'));
    const mime = sniff(buf);
    if (!mime) throw badRequest(t('Format non pris en charge : images PNG, JPG, GIF, WebP ou polices WOFF2, WOFF, TTF, OTF', 'Unsupported format: PNG, JPG, GIF or WebP images, or WOFF2, WOFF, TTF or OTF fonts'));
    const id = newId();
    const stored = `${id}.${MIME_EXT[mime]}`;
    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(resolve(UPLOAD_DIR, stored), buf);
    const created = now();
    run(
      db,
      `INSERT INTO assets (id, account_id, filename, stored_name, mime, size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      request.accountId,
      body.filename,
      stored,
      mime,
      buf.length,
      body.width ?? null,
      body.height ?? null,
      created,
    );
    reply.code(201);
    return serialize(get<AssetRow>(db, 'SELECT * FROM assets WHERE id = ?', id)!);
  });

  app.delete('/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = get<AssetRow>(db, 'SELECT * FROM assets WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!row) throw notFound(t('Image introuvable', 'Image not found'));
    run(db, 'DELETE FROM assets WHERE id = ?', id);
    try {
      unlinkSync(resolve(UPLOAD_DIR, row.stored_name));
    } catch {
      /* already gone */
    }
    return reply.code(204).send();
  });

  // --- Brand kit (default email style) -------------------------------------------
  app.get('/brand-kit', async (request) => {
    const row = get<{ brand_kit: string | null }>(db, 'SELECT brand_kit FROM accounts WHERE id = ?', request.accountId);
    return { brand_kit: row?.brand_kit ?? null };
  });

  app.put('/brand-kit', async (request) => {
    const body = parse(brandKitSchema, request.body);
    if (body.brand_kit) {
      try {
        JSON.parse(body.brand_kit);
      } catch {
        throw badRequest(t('Style de marque invalide', 'Invalid brand style'));
      }
    }
    run(db, 'UPDATE accounts SET brand_kit = ? WHERE id = ?', body.brand_kit, request.accountId);
    return { brand_kit: body.brand_kit };
  });

  // --- Saved email templates ----------------------------------------------------
  app.get('/email-templates', async (request) => {
    const rows = all(
      db,
      'SELECT id, name, design, created_at, updated_at FROM email_templates WHERE account_id = ? ORDER BY updated_at DESC',
      request.accountId,
    );
    return { data: rows };
  });

  app.post('/email-templates', async (request, reply) => {
    const body = parse(templateSchema, request.body);
    const id = newId();
    const t = now();
    run(
      db,
      'INSERT INTO email_templates (id, account_id, name, design, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      request.accountId,
      body.name,
      body.design,
      t,
      t,
    );
    reply.code(201);
    return get(db, 'SELECT id, name, design, created_at, updated_at FROM email_templates WHERE id = ?', id);
  });

  app.delete('/email-templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const n = run(db, 'DELETE FROM email_templates WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!n) throw notFound(t('Modèle introuvable', 'Template not found'));
    return reply.code(204).send();
  });
}

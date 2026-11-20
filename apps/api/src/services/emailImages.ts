/**
 * Makes an email's pictures show everywhere: Gmail drops inline SVG and does not show SVG or WebP files.
 * Before sending, each inline <svg> and each SVG/WebP <img> is converted to PNG (or JPG for opaque photos),
 * stored in the account's media library and referenced by its public URL. The same picture is converted once:
 * later sends reuse the stored file. A picture that cannot be converted is left as it is.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import type { AppConfig } from '../config.js';
import { get, newId, now, run, type DatabaseSync } from '../db.js';
import { UPLOAD_DIR, assetUrl } from '../routes/library.js';

/** Pixel density of the converted pictures: sharp on high-resolution screens. */
const SCALE = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const SVG_RE = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
const IMG_RE = /<img\b[^>]*>/gi;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : null;
}

const num = (v: string | null) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Display size of an inline SVG: its width/height attributes, else its viewBox. */
function svgSize(open: string): { w: number; h: number } | null {
  let w = num(attr(open, 'width'));
  let h = num(attr(open, 'height'));
  const vb = attr(open, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const ratio = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : null;
  if (w && !h && ratio) h = w / ratio;
  if (h && !w && ratio) w = h * ratio;
  if (!w && !h && vb && ratio) [w, h] = [vb[2], vb[3]];
  return w && h ? { w: Math.round(w), h: Math.round(h) } : null;
}

interface Stored {
  url: string;
  width: number;
  height: number;
}

/** The converted picture already stored for this account, or null. */
function cached(db: DatabaseSync, config: AppConfig, accountId: string, key: string): Stored | null {
  const row = get<{ stored_name: string; width: number | null; height: number | null }>(
    db,
    'SELECT stored_name, width, height FROM assets WHERE account_id = ? AND filename = ?',
    accountId,
    `email-image-${key}`,
  );
  return row ? { url: assetUrl(config.publicUrl, row.stored_name), width: row.width ?? 0, height: row.height ?? 0 } : null;
}

async function store(db: DatabaseSync, config: AppConfig, accountId: string, key: string, image: Sharp): Promise<Stored> {
  const meta = await image.metadata();
  const opaque = !meta.hasAlpha;
  const { data, info } = await (opaque ? image.flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true }) : image.png({ compressionLevel: 9 })).toBuffer({
    resolveWithObject: true,
  });
  const id = newId();
  const ext = opaque ? 'jpg' : 'png';
  const stored = `${id}.${ext}`;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(resolve(UPLOAD_DIR, stored), data);
  run(
    db,
    `INSERT INTO assets (id, account_id, filename, stored_name, mime, size, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    accountId,
    `email-image-${key}`,
    stored,
    opaque ? 'image/jpeg' : 'image/png',
    data.length,
    info.width,
    info.height,
    now(),
  );
  return { url: assetUrl(config.publicUrl, stored), width: info.width, height: info.height };
}

async function download(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error('invalid data URL');
    return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('too large');
  return buf;
}

const isSvgOrWebp = (src: string) => /^data:image\/(svg\+xml|webp)[;,]/i.test(src) || /\.(svg|webp)(?:[?#].*)?$/i.test(src);

export interface ConvertResult {
  html: string;
  converted: number;
  failed: string[];
}

/** Converts the SVG and WebP pictures of an email; returns the new HTML (unchanged when there is nothing to do). */
export async function convertEmailImages(db: DatabaseSync, config: AppConfig, accountId: string, html: string): Promise<ConvertResult> {
  const failed: string[] = [];
  let converted = 0;
  const jobs: Array<{ from: string; to: Promise<string | null> }> = [];

  for (const svg of new Set(html.match(SVG_RE) ?? [])) {
    jobs.push({
      from: svg,
      to: (async () => {
        const open = /^<svg\b[^>]*>/i.exec(svg)![0];
        const size = svgSize(open);
        if (!size) throw new Error('SVG without a size');
        const key = createHash('sha256').update(svg).digest('hex').slice(0, 32);
        let out = cached(db, config, accountId, key);
        if (!out) {
          let source = /\sxmlns\s*=/.test(open) ? svg : svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
          // Render at the display size × SCALE, whatever the width/height attributes say.
          source = source.replace(/^<svg\b[^>]*>/i, (tag) =>
            tag
              .replace(/\s(width|height|style)\s*=\s*("[^"]*"|'[^']*')/gi, '') // a CSS size would win over the attributes
              .replace(/^<svg\b/i, `<svg width="${size.w * SCALE}" height="${size.h * SCALE}"`),
          );
          out = await store(db, config, accountId, key, sharp(Buffer.from(source)));
        }
        const alt = attr(open, 'aria-label') ?? '';
        const style = (attr(open, 'style') ?? '')
          .replace(/(^|;)\s*(width|height)\s*:[^;]*/gi, '$1')
          .replace(/;{2,}/g, ';')
          .replace(/^;|;?\s*$/g, '');
        return `<img src="${escapeAttr(out.url)}" width="${size.w}" height="${size.h}" alt="${escapeAttr(alt)}" style="${escapeAttr(`${style ? `${style};` : 'display:block;'}width:${size.w}px;height:${size.h}px;border:0;outline:none;`)}">`;
      })().catch((err) => {
        failed.push(`SVG (${err instanceof Error ? err.message : String(err)})`);
        return null;
      }),
    });
  }

  for (const img of new Set(html.match(IMG_RE) ?? [])) {
    const src = attr(img, 'src');
    if (!src || !isSvgOrWebp(src.trim())) continue;
    jobs.push({
      from: img,
      to: (async () => {
        const url = src.trim().replace(/&amp;/g, '&');
        const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
        let out = cached(db, config, accountId, key);
        if (!out) {
          const buf = await download(url);
          const isSvg = /^data:image\/svg/i.test(url) || /\.svg(?:[?#].*)?$/i.test(url) || /^\s*(<\?xml|<svg)/.test(buf.subarray(0, 200).toString());
          out = await store(db, config, accountId, key, isSvg ? sharp(buf, { density: 72 * SCALE }) : sharp(buf));
        }
        return img.replace(/(\ssrc\s*=\s*)("[^"]*"|'[^']*')/i, `$1"${escapeAttr(out.url)}"`);
      })().catch((err) => {
        failed.push(`${src.slice(0, 80)} (${err instanceof Error ? err.message : String(err)})`);
        return null;
      }),
    });
  }

  if (!jobs.length) return { html, converted, failed };
  let out = html;
  for (const job of jobs) {
    const to = await job.to;
    if (to == null) continue;
    out = out.split(job.from).join(to);
    converted++;
  }
  return { html: out, converted, failed };
}

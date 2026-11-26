/**
 * Traduction automatique des campagnes dans la langue de chaque contact (DeepL).
 *
 * Une campagne est traduite UNE fois par langue, avant sa mise en file (jamais par destinataire) : le modèle
 * commun à tous les destinataires (prepareTemplate : document, pied de désinscription, protection mode sombre)
 * est découpé en morceaux de texte, chaque morceau est traduit, puis remis à sa place. Les balises, les liens, les
 * styles et les balises de fusion ({{first_name}}…) ne passent jamais par la traduction : ils sont remplacés par
 * des repères, et un morceau dont les repères ne reviennent pas intacts garde son texte d'origine.
 * Une langue qui échoue (DeepL injoignable, quota épuisé) n'empêche rien : ses contacts reçoivent l'original.
 */
import { createHash } from 'node:crypto';
import { all, get, now, run, type DatabaseSync } from '../db.js';
import type { AppConfig } from '../config.js';
import { accountLang } from '../i18n.js';
import { escapeHtml } from './render.js';

/* ───────────── Langues ───────────── */

/** Langue du contact (code primaire) → langue cible DeepL. Absente : DeepL ne la traduit pas. */
const DEEPL_TARGETS: Record<string, string> = {
  ar: 'AR', bg: 'BG', cs: 'CS', da: 'DA', de: 'DE', el: 'EL', en: 'EN-GB', es: 'ES', et: 'ET', fi: 'FI', fr: 'FR',
  he: 'HE', hu: 'HU', id: 'ID', it: 'IT', ja: 'JA', ko: 'KO', lt: 'LT', lv: 'LV', nb: 'NB', no: 'NB', nn: 'NB',
  nl: 'NL', pl: 'PL', pt: 'PT-PT', ro: 'RO', ru: 'RU', sk: 'SK', sl: 'SL', sv: 'SV', th: 'TH', tr: 'TR', uk: 'UK',
  vi: 'VI', zh: 'ZH-HANS',
};

/** La langue cible DeepL d'un contact, null si elle n'est pas prise en charge. */
export function deeplTarget(lang: string | null | undefined): string | null {
  return (lang && DEEPL_TARGETS[lang]) || null;
}

/** Même langue (« no » et « nb » sont le même norvégien) : rien à traduire. */
export function sameLanguage(a: string, b: string): boolean {
  return a === b || (deeplTarget(a) !== null && deeplTarget(a) === deeplTarget(b));
}

/** Au plus autant de langues traduites par campagne (coût et durée bornés). */
export const MAX_LANGUAGES = 30;

/**
 * Les langues présentes parmi les contacts du compte, sans parcourir les contacts : un saut d'index par langue
 * (idx_contacts_account_language, partiel), quelques millisecondes même à 2 M de contacts.
 */
export function accountLanguages(db: DatabaseSync, accountId: string, limit = 200): string[] {
  return all<{ l: string }>(
    db,
    `WITH RECURSIVE l(x) AS (
       SELECT MIN(language) FROM contacts WHERE account_id = ? AND language IS NOT NULL
       UNION ALL
       SELECT (SELECT MIN(language) FROM contacts WHERE account_id = ? AND language > l.x) FROM l WHERE l.x IS NOT NULL
     )
     SELECT x AS l FROM l WHERE x IS NOT NULL LIMIT ?`,
    accountId,
    accountId,
    limit,
  ).map((r) => r.l);
}

/* ───────────── Découpage du HTML ───────────── */

/** Balises qui vivent à l'intérieur d'une phrase : traduites avec le texte qui les entoure. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'em', 'font', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small',
  'span', 'strike', 'strong', 'sub', 'sup', 'u', 'br', 'wbr', 'del', 'ins', 'time',
]);
const VOID = new Set(['br', 'wbr']);

const TOKEN_RE = /<!--[\s\S]*?-->|<[!?][^>]*>|<(script|style|head|title|textarea)\b[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^>]*>|<|[^<]+/gi;
const MERGE_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

type Token = { kind: 'text' | 'open' | 'close' | 'other'; raw: string; name?: string };

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  for (const m of html.matchAll(TOKEN_RE)) {
    const raw = m[0];
    if (raw[0] !== '<' || raw === '<') {
      out.push({ kind: 'text', raw });
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw);
    if (!tag || m[1]) {
      out.push({ kind: 'other', raw }); // commentaire, <style>, <head>…
      continue;
    }
    const name = tag[2].toLowerCase();
    if (!INLINE.has(name) || /\btranslate\s*=\s*["']?no\b/i.test(raw)) out.push({ kind: 'other', raw, name });
    else out.push({ kind: tag[1] ? 'close' : 'open', raw, name });
  }
  return out;
}

/** Du texte à traduire : au moins deux lettres hors balises de fusion, entités et adresses. */
function hasWords(text: string): boolean {
  const plain = text
    .replace(MERGE_RE, ' ')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+|\S+@\S+\.\S+/gi, ' ');
  return /\p{L}{2,}/u.test(plain);
}

interface Piece {
  /** Texte envoyé à la traduction (repères à la place des balises et des balises de fusion). */
  send: string;
  /** Repère → texte d'origine. */
  marks: Map<string, string>;
  /** Le morceau d'origine, gardé si la traduction revient abîmée. */
  original: string;
}

interface Segmented {
  /** Le HTML, morceaux à traduire compris : parts[i] pour i dans `slots` est remplacé par la traduction. */
  parts: string[];
  slots: number[];
  pieces: Piece[];
  /** Textes de repli des balises de fusion ({{first_name|cher client}}), traduits avec le reste. */
  fallbacks: string[];
}

/**
 * Le texte d'un morceau, prêt à traduire : chaque balise devient `<nom id="pN">` (sans ses attributs, qui ne
 * doivent jamais changer ni être facturés), une balise sans sa paire devient un repère vide, chaque balise de fusion
 * un `<span translate="no">` vide. `fallbacks` reçoit les textes de repli ({{first_name|cher client}}) à traduire.
 */
function prepare(tokens: Token[], fallbacks: string[]): Piece {
  const marks = new Map<string, string>();
  let n = 0;
  // Les paires ouvrante / fermante de ce morceau.
  const partner = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind === 'open' && !VOID.has(t.name!)) stack.push(i);
    else if (t.kind === 'close') {
      const j = stack.length && tokens[stack[stack.length - 1]].name === t.name ? stack.pop()! : -1;
      if (j >= 0) {
        partner.set(i, j);
        partner.set(j, i);
      }
    }
  });
  let send = '';
  tokens.forEach((t, i) => {
    if (t.kind === 'text') {
      send += t.raw.replace(MERGE_RE, (whole, name: string, fallback: string | undefined) => {
        const id = `m${n++}`;
        // Le texte de repli d'un prénom absent se traduit ; la date d'un compte à rebours, jamais.
        const translatable = fallback && !/^countdown_/i.test(name) && hasWords(fallback);
        marks.set(id, translatable ? `\u0000${fallbacks.length}\u0000${name}` : whole);
        if (translatable) fallbacks.push(fallback!);
        // Non vide (un élément vide peut être supprimé) ; translate="no" : son contenu ne bouge pas.
        return `<span translate="no" id="${id}">${name}</span>`;
      });
      return;
    }
    if (t.kind === 'close' && partner.has(i)) {
      send += `</${t.name}>`;
      return;
    }
    if (t.kind === 'open' && (VOID.has(t.name!) || partner.has(i))) {
      const id = `p${n++}`;
      marks.set(id, t.raw);
      send += `<${t.name} id="${id}">`;
      return;
    }
    // Une balise sans sa paire dans ce morceau : un repère qui ne se traduit pas.
    const id = `k${n++}`;
    marks.set(id, t.raw);
    send += `<span translate="no" id="${id}">#</span>`;
  });
  return { send, marks, original: tokens.map((t) => t.raw).join('') };
}

/** Découpe un document HTML en morceaux de phrases traduisibles (tout le reste reste tel quel). */
export function segmentHtml(html: string): Segmented {
  const tokens = tokenize(html);
  const parts: string[] = [];
  const slots: number[] = [];
  const pieces: Piece[] = [];
  const fallbacks: string[] = [];
  let run: Token[] = [];
  const flush = () => {
    // Le cœur : du premier au dernier texte du passage ; les balises autour restent en place.
    const first = run.findIndex((t) => t.kind === 'text' && t.raw.trim());
    if (first < 0 || !hasWords(run.filter((t) => t.kind === 'text').map((t) => t.raw).join(' '))) {
      parts.push(run.map((t) => t.raw).join(''));
      run = [];
      return;
    }
    let last = run.length - 1;
    while (!(run[last].kind === 'text' && run[last].raw.trim())) last--;
    const core = run.slice(first, last + 1);
    // Les espaces au bord ne passent pas par la traduction.
    const lead = /^\s*/.exec(core[0].raw)![0];
    const trail = /\s*$/.exec(core[core.length - 1].raw)![0];
    if (core.length === 1) core[0] = { kind: 'text', raw: core[0].raw.trim() };
    else {
      core[0] = { kind: 'text', raw: core[0].raw.slice(lead.length) };
      const e = core.length - 1;
      core[e] = { kind: 'text', raw: core[e].raw.slice(0, core[e].raw.length - trail.length) };
    }
    parts.push(run.slice(0, first).map((t) => t.raw).join('') + lead);
    slots.push(parts.length);
    pieces.push(prepare(core, fallbacks));
    parts.push(''); // la traduction
    parts.push(trail + run.slice(last + 1).map((t) => t.raw).join(''));
    run = [];
  };
  // Un élément marqué translate="no" (nom de marque…) reste tel quel, tout son contenu compris.
  let keep: { name: string; depth: number } | null = null;
  for (const t of tokens) {
    if (keep) {
      parts.push(t.raw);
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(t.raw);
      if (tag && tag[2].toLowerCase() === keep.name && !/\/>$/.test(t.raw)) keep.depth += tag[1] ? -1 : 1;
      if (keep.depth === 0) keep = null;
      continue;
    }
    if (t.kind === 'other') {
      flush();
      parts.push(t.raw);
      if (t.name && !VOID.has(t.name) && !/\/>$/.test(t.raw) && t.raw[1] !== '/' && /\btranslate\s*=\s*["']?no\b/i.test(t.raw)) {
        keep = { name: t.name, depth: 1 };
      }
    } else run.push(t);
  }
  flush();
  return { parts, slots, pieces, fallbacks };
}

/** Nettoie un texte de repli traduit pour qu'il reste dans sa balise ({{first_name|…}}). */
const cleanFallback = (v: string) => decodeHtml(v).replace(/[{}|]/g, '').trim();

function decodeHtml(v: string): string {
  return v
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Remet les repères à leur place dans un morceau traduit. null si un repère manque, est en double ou si la
 * traduction a inventé des balises : le morceau garde alors son texte d'origine.
 */
export function restorePiece(piece: Piece, translated: string, fallbacks: string[]): string | null {
  const seen = new Set<string>();
  let broken = false;
  let out = translated.replace(/<span\b[^>]*\bid="([mk]\d+)"[^>]*>[^<]*<\/span>|<([a-z]+)\b[^>]*\bid="(p\d+)"[^>]*>/gi, (_w, idA: string, name: string, idB: string) => {
    const id = idA ?? idB;
    const orig = piece.marks.get(id);
    if (orig === undefined || seen.has(id)) {
      broken = true;
      return '';
    }
    seen.add(id);
    if (idB && !new RegExp(`^<${name}\\b`, 'i').test(orig)) broken = true;
    if (orig.startsWith('\u0000')) {
      const [, index, tag] = orig.split('\u0000');
      const fb = cleanFallback(fallbacks[Number(index)] ?? '');
      return fb ? `{{${tag}|${fb}}}` : `{{${tag}}}`;
    }
    return orig;
  });
  if (broken || seen.size !== piece.marks.size) return null;
  // Plus aucune balise de traduction ne doit rester (une balise ajoutée ou un repère déformé).
  if (/\bid="[mpk]\d+"|translate="no"/i.test(out)) return null;
  // Autant de balises fermantes de chaque sorte qu'à l'origine.
  const closes = (s: string) => (s.match(/<\/[a-z]+/gi) ?? []).map((x) => x.toLowerCase()).sort().join();
  if (closes(out) !== closes(piece.original)) return null;
  return out;
}

/* ───────────── DeepL ───────────── */

export class TranslateError extends Error {}

/** Au plus 50 textes et ~100 Ko par requête (limites DeepL : 50 textes, 128 Kio). */
const BATCH_TEXTS = 50;
const BATCH_BYTES = 100_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type TranslateFn = (texts: string[], target: string) => Promise<string[]>;

/** Traduit une liste de textes HTML (balises gardées) vers `target`, par lots, avec reprises sur 429 / 5xx. */
export function deeplTranslator(config: AppConfig, fetchImpl: typeof fetch = fetch): TranslateFn {
  return async (texts, target) => {
    const key = config.translate.deeplKey;
    if (!key) throw new TranslateError('DEEPL_API_KEY absente');
    const out: string[] = [];
    let i = 0;
    while (i < texts.length) {
      const batch: string[] = [];
      let bytes = 0;
      while (i < texts.length && batch.length < BATCH_TEXTS && (batch.length === 0 || bytes + texts[i].length < BATCH_BYTES)) {
        bytes += texts[i].length;
        batch.push(texts[i++]);
      }
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(`${config.translate.deeplUrl}/v2/translate`, {
            method: 'POST',
            headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: batch, target_lang: target, tag_handling: 'html' }),
            signal: AbortSignal.timeout(60_000),
          });
        } catch (err) {
          if (attempt < 3) {
            await sleep(2000 * 2 ** attempt);
            continue;
          }
          throw new TranslateError(`DeepL injoignable : ${err instanceof Error ? err.message : String(err)}`);
        }
        if (res.ok) {
          const data = (await res.json()) as { translations?: Array<{ text?: unknown }> };
          const got = data.translations ?? [];
          if (got.length !== batch.length) throw new TranslateError(`DeepL a renvoyé ${got.length} textes pour ${batch.length}`);
          out.push(...got.map((t) => String(t.text ?? '')));
          break;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        const reason =
          res.status === 403 ? 'clé DeepL refusée' : res.status === 456 ? 'quota DeepL épuisé' : `DeepL a répondu ${res.status}`;
        throw new TranslateError(reason);
      }
    }
    return out;
  };
}

/* ───────────── Traduction d'une campagne ───────────── */

export interface TranslationSource {
  /** Le modèle commun (prepareTemplate), avant la personnalisation de chaque destinataire. */
  prepared: string;
  subject: string;
  preheader: string | null;
  hash: string;
}

export function sourceHash(prepared: string, subject: string, preheader: string | null): string {
  return createHash('sha256').update(prepared).update('\u0000').update(subject).update('\u0000').update(preheader ?? '').digest('hex');
}

export interface Translation {
  subject: string;
  preheader: string | null;
  html: string;
  /** Morceaux gardés en langue d'origine (traduction abîmée). */
  kept: number;
  total: number;
}

/** Texte simple (objet, pré-en-tête) → HTML à traduire, balises de fusion protégées. */
function plainPiece(text: string, fallbacks: string[]): Piece {
  return prepare([{ kind: 'text', raw: escapeHtml(text) }], fallbacks);
}

/** Traduit le modèle d'une campagne vers une langue. */
export async function translateSource(src: TranslationSource, contactLang: string, translate: TranslateFn): Promise<Translation> {
  const target = deeplTarget(contactLang);
  if (!target) throw new TranslateError(`langue non prise en charge : ${contactLang}`);
  const seg = segmentHtml(src.prepared);
  const fallbacks = seg.fallbacks;
  const subject = plainPiece(src.subject, fallbacks);
  const preheader = src.preheader ? plainPiece(src.preheader, fallbacks) : null;
  const pieces = [...seg.pieces, subject, ...(preheader ? [preheader] : [])];
  // Les morceaux puis les textes de repli, en une seule série de requêtes.
  const done = await translate([...pieces.map((p) => p.send), ...fallbacks], target);
  const fb = done.slice(pieces.length);
  let kept = 0;
  const result = pieces.map((p, i) => {
    const r = restorePiece(p, done[i], fb);
    if (r === null) kept++;
    return r ?? p.original;
  });
  const parts = [...seg.parts];
  seg.slots.forEach((slot, i) => (parts[slot] = result[i]));
  const lang = contactLang;
  const html = parts.join('').replace(/(<html\b[^>]*?\blang=)(["'])[^"']*\2/i, `$1$2${lang}$2`);
  const plain = (s: string) => decodeHtml(s).replace(/\s+/g, ' ').trim();
  return {
    html,
    subject: plain(result[seg.pieces.length]) || src.subject,
    preheader: preheader ? plain(result[seg.pieces.length + 1]) || src.preheader : null,
    kept,
    total: pieces.length,
  };
}

/** Langue d'écriture d'une campagne : la sienne, sinon celle du compte. */
export function campaignLanguage(db: DatabaseSync, c: { account_id: string; language?: string | null }): string {
  return c.language || accountLang(db, c.account_id);
}

/** Enregistre (ou remplace) la traduction d'une langue. */
export function saveTranslation(db: DatabaseSync, campaignId: string, lang: string, hash: string, tr: Translation): void {
  run(
    db,
    `INSERT INTO campaign_translations (campaign_id, lang, source_hash, subject, preheader, html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (campaign_id, lang) DO UPDATE SET source_hash = excluded.source_hash, subject = excluded.subject,
       preheader = excluded.preheader, html = excluded.html, created_at = excluded.created_at`,
    campaignId,
    lang,
    hash,
    tr.subject,
    tr.preheader,
    tr.html,
    now(),
  );
}

export function translationHash(db: DatabaseSync, campaignId: string, lang: string): string | undefined {
  return get<{ h: string }>(db, 'SELECT source_hash AS h FROM campaign_translations WHERE campaign_id = ? AND lang = ?', campaignId, lang)?.h;
}

export interface CampaignTranslationReport {
  languages: string[];
  translated: string[];
  failed: Array<{ lang: string; error: string }>;
}

/**
 * Traduit une campagne dans chaque langue de contact du compte qui n'est pas la sienne (déjà traduite pour
 * ce modèle : gardée). Ne lève jamais pour une langue : ses contacts recevront l'original.
 */
export async function translateCampaignLanguages(
  db: DatabaseSync,
  campaign: { id: string; account_id: string; language?: string | null },
  src: TranslationSource,
  translate: TranslateFn,
): Promise<CampaignTranslationReport> {
  const source = campaignLanguage(db, campaign);
  const languages = accountLanguages(db, campaign.account_id)
    .filter((l) => deeplTarget(l) && !sameLanguage(l, source))
    .slice(0, MAX_LANGUAGES);
  const report: CampaignTranslationReport = { languages, translated: [], failed: [] };
  // « no » et « nb » : une seule traduction, enregistrée pour les deux.
  const byTarget = new Map<string, Translation>();
  for (const lang of languages) {
    if (translationHash(db, campaign.id, lang) === src.hash) continue;
    try {
      const target = deeplTarget(lang)!;
      let tr = byTarget.get(target);
      if (!tr) {
        tr = await translateSource(src, lang, translate);
        byTarget.set(target, tr);
      }
      saveTranslation(db, campaign.id, lang, src.hash, { ...tr, html: tr.html.replace(/(<html\b[^>]*?\blang=)(["'])[^"']*\2/i, `$1$2${lang}$2`) });
      report.translated.push(lang);
    } catch (err) {
      report.failed.push({ lang, error: err instanceof Error ? err.message : String(err) });
      // Clé refusée ou quota épuisé : les autres langues échoueraient pareil.
      if (err instanceof TranslateError && /clé|quota|absente/.test(err.message)) {
        for (const rest of languages.slice(languages.indexOf(lang) + 1)) report.failed.push({ lang: rest, error: err.message });
        break;
      }
    }
  }
  return report;
}

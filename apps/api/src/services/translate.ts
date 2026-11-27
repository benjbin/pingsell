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
/** Ce qui ne passe jamais par la traduction : balises de fusion, emojis, nombres / prix / pourcentages (« -20 % », « 49,90 € »). */
const SP = '(?:\\s|&nbsp;|&#160;|\\u00a0|\\u202f)';
const EMOJI = '(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D(?:\\p{Extended_Pictographic}))*';
const NUMBER = `(?:[€$£]${SP}?)?[-−+]?\\d+(?:(?:[.,:/]|${SP})\\d+)*(?:${SP}?(?:%|€|\\$|£|EUR|USD|CHF)(?![\\p{L}]))?`;
/** Codes promo et références (« AUTOMNE20 », « SUMMER-15 », « X12B ») : lettres et chiffres mêlés. */
const CODE = '(?<![\\p{L}\\d])(?=[\\p{L}\\d_-]*\\p{L})(?=[\\p{L}\\d_-]*\\d)[\\p{L}\\d][\\p{L}\\d_-]*(?![\\p{L}\\d])';
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Entités HTML (« &#39; », « &amp; ») : laissées telles quelles, leurs chiffres ne sont pas des nombres.
 * `keep` : noms qui ne se traduisent pas (le nom de la boutique, de l'expéditeur).
 */
function protectRe(keep: string[]): RegExp {
  const names = keep
    .map((k) => k.trim())
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((k) => escapeRe(escapeHtml(k)));
  const brand = names.length ? `(?<![\\p{L}\\d])(?:${names.join('|')})(?![\\p{L}\\d])` : '(?!)';
  return new RegExp(`${MERGE_RE.source}|(&#?[a-z0-9]+;)|(${brand}|${EMOJI}|${CODE}|${NUMBER})`, 'giu');
}

/** Ce que voit le traducteur à la place d'une balise de fusion : un vrai mot, pour que la phrase reste naturelle. */
const MERGE_SAMPLE: Record<string, string> = { first_name: 'Camille', last_name: 'Martin', email: 'camille@example.com' };

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
function prepare(tokens: Token[], fallbacks: string[], protect: RegExp): Piece {
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
      send += t.raw.replace(protect, (whole: string, name: string | undefined, fallback: string | undefined, entity: string | undefined) => {
        if (entity) return whole;
        const id = `m${n++}`;
        if (!name) {
          // Emoji ou nombre : remis tel quel (le contenu du repère donne le contexte au traducteur).
          marks.set(id, whole);
          return `<span translate="no" id="${id}">${whole}</span>`;
        }
        // Le texte de repli d'un prénom absent se traduit ; la date d'un compte à rebours, jamais.
        const translatable = fallback && !/^countdown_/i.test(name) && hasWords(fallback);
        marks.set(id, translatable ? `\u0000${fallbacks.length}\u0000${name}` : whole);
        if (translatable) fallbacks.push(fallback!);
        // Non vide (un élément vide peut être supprimé) ; translate="no" : son contenu ne bouge pas.
        return `<span translate="no" id="${id}">${MERGE_SAMPLE[name.toLowerCase()] ?? '#'}</span>`;
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
export function segmentHtml(html: string, names: string[] = []): Segmented {
  const protect = protectRe(names);
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
    pieces.push(prepare(core, fallbacks, protect));
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

/** Traduit des textes HTML (balises gardées) de la langue `source` vers `target` (codes du traducteur). */
export type TranslateFn = (texts: string[], target: string, source: string, format?: 'html' | 'text') => Promise<string[]>;

/** Un service de traduction : ses langues et sa fonction. */
export interface Translator {
  name: 'deepl' | 'libre';
  /** Code de langue du service pour une langue de contact, null si elle n'est pas prise en charge. */
  target(lang: string): string | null;
  translate: TranslateFn;
}

/**
 * Le traducteur configuré : DeepL si une clé est donnée, sinon le traducteur interne (LibreTranslate, service
 * « translate » du déploiement). null : traduction indisponible.
 */
export function makeTranslator(config: AppConfig, fetchImpl: typeof fetch = fetch): Translator | null {
  if (config.translate.deeplKey) return { name: 'deepl', target: deeplTarget, translate: deeplTranslator(config, fetchImpl) };
  if (config.translate.libreUrl) {
    const langs = new Set(config.translate.libreLangs);
    return { name: 'libre', target: (l) => (langs.has(l) ? l : null), translate: libreTranslator(config, fetchImpl) };
  }
  return null;
}

/**
 * Traducteur interne (LibreTranslate, logiciel libre hébergé à côté de Pingsell) : aucun compte, aucun coût.
 * Plus lent que DeepL (il tourne sur le processeur du serveur) : petits lots, délai long.
 */
export function libreTranslator(config: AppConfig, fetchImpl: typeof fetch = fetch): TranslateFn {
  return async (texts, target, source, format = 'html') => {
    const url = config.translate.libreUrl;
    if (!url) throw new TranslateError('traducteur interne absent');
    const out: string[] = [];
    let i = 0;
    while (i < texts.length) {
      const batch: string[] = [];
      let bytes = 0;
      while (i < texts.length && batch.length < 20 && (batch.length === 0 || bytes + texts[i].length < 20_000)) {
        bytes += texts[i].length;
        batch.push(texts[i++]);
      }
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(`${url}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: batch, source, target, format, ...(config.translate.libreKey ? { api_key: config.translate.libreKey } : {}) }),
            signal: AbortSignal.timeout(180_000),
          });
        } catch (err) {
          if (attempt < 3) {
            await sleep(5000 * 2 ** attempt);
            continue;
          }
          throw new TranslateError(`traducteur interne injoignable : ${err instanceof Error ? err.message : String(err)}`);
        }
        if (res.ok) {
          const data = (await res.json()) as { translatedText?: unknown };
          const got = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
          if (got.length !== batch.length) throw new TranslateError(`le traducteur a renvoyé ${got.length} textes pour ${batch.length}`);
          out.push(...got.map((t) => String(t ?? '')));
          break;
        }
        // 503 : modèles encore en cours de chargement au démarrage du service.
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(5000 * 2 ** attempt);
          continue;
        }
        let detail = '';
        try {
          detail = String(((await res.json()) as { error?: unknown }).error ?? '');
        } catch {
          /* corps illisible */
        }
        throw new TranslateError(`le traducteur interne a répondu ${res.status}${detail ? ` (${detail.slice(0, 200)})` : ''}`);
      }
    }
    return out;
  };
}

/** Traduit une liste de textes HTML (balises gardées) vers `target`, par lots, avec reprises sur 429 / 5xx. */
export function deeplTranslator(config: AppConfig, fetchImpl: typeof fetch = fetch): TranslateFn {
  return async (texts, target, _source, format = 'html') => {
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
            body: JSON.stringify({ text: batch, target_lang: target, ...(format === 'html' ? { tag_handling: 'html' } : {}) }),
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
  /** Noms jamais traduits (boutique, expéditeur). */
  keep?: string[];
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
function plainPiece(text: string, fallbacks: string[], keep: string[]): Piece {
  return prepare([{ kind: 'text', raw: escapeHtml(text) }], fallbacks, protectRe(keep));
}

/**
 * Le français tel qu'un traducteur automatique le lit le mieux : sans l'espace avant « ! ? ; : » (sinon « Bonjour
 * Camille ! » devient « Hello. Camille Hey! »), guillemets droits, et « soldes » (pris pour un solde bancaire)
 * remplacé par son sens commercial.
 */
function frenchForMachine(text: string): string {
  return text
    .replace(/(?:\s|&nbsp;|&#160;|\u00a0|\u202f)+(?=[!?;:»]|<\/[a-z]+>[!?;:»])/gi, (sp, offset: number, all: string) => {
      // Un « : » d'heure ou d'URL n'a pas d'espace devant : rien à enlever ; une balise juste avant reste intacte.
      return all[offset - 1] === '>' && all[offset + sp.length] === '<' ? sp : '';
    })
    .replace(/«(?:\s|&nbsp;|&#160;|\u00a0|\u202f)*/g, '"')
    .replace(/(?:\s|&nbsp;|&#160;|\u00a0|\u202f)*»/g, '"')
    .replace(/\bsoldes\b/g, 'promotions')
    .replace(/\bSoldes\b/g, 'Promotions')
    .replace(/\bSOLDES\b/g, 'PROMOTIONS');
}

interface PlainPiece {
  text: string;
  /** Les repères dans l'ordre : leur texte visible (à retrouver dans la traduction) et leur id. */
  items: Array<{ id: string; shown: string }>;
}

/**
 * Un morceau sans mise en forme interne, en texte simple : les repères deviennent leur texte (« Camille », « -20 % »,
 * « AUTOMNE20 »), que le traducteur garde tel quel. null s'il contient des balises (gras, lien…).
 */
function plainOf(p: Piece): PlainPiece | null {
  if (/\bid="[pk]\d+"/.test(p.send)) return null;
  const items: PlainPiece['items'] = [];
  const text = decodeHtml(
    p.send.replace(/<span translate="no" id="(m\d+)">([^<]*)<\/span>/g, (_w, id: string, content: string) => {
      items.push({ id, shown: decodeHtml(content) });
      return `\u0001${items.length - 1}\u0001`;
    }),
  ).replace(/\u0001(\d+)\u0001/g, (_w, i: string) => items[Number(i)].shown);
  if (/[<>]/.test(text.replace(/[^<>]/g, '')) && /<[a-z/]/i.test(text)) return null;
  return { text, items };
}

/** Remet les repères d'un morceau traduit en texte simple ; null si l'un d'eux n'est pas retrouvé tel quel. */
function restorePlain(p: Piece, plain: PlainPiece, translated: string, fallbacks: string[]): string | null {
  let out = translated;
  for (let i = 0; i < plain.items.length; i++) {
    const at = out.indexOf(plain.items[i].shown);
    if (at < 0 || !plain.items[i].shown) return null;
    out = `${out.slice(0, at)}\u0001${i}\u0001${out.slice(at + plain.items[i].shown.length)}`;
  }
  const html = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html.replace(/\u0001(\d+)\u0001/g, (_w, i: string) => {
    const orig = p.marks.get(plain.items[Number(i)].id)!;
    if (orig.startsWith('\u0000')) {
      const [, index, tag] = orig.split('\u0000');
      const fb = cleanFallback(fallbacks[Number(index)] ?? '');
      return fb ? `{{${tag}|${fb}}}` : `{{${tag}}}`;
    }
    return orig;
  });
}

/** Traduit le modèle d'une campagne vers une langue. */
export async function translateSource(src: TranslationSource, contactLang: string, translator: Translator, sourceLang: string): Promise<Translation> {
  const target = translator.target(contactLang);
  if (!target) throw new TranslateError(`langue non prise en charge : ${contactLang}`);
  const source = translator.name === 'deepl' ? (deeplTarget(sourceLang)?.slice(0, 2) ?? sourceLang).toUpperCase() : sourceLang;
  const keep = src.keep ?? [];
  const seg = segmentHtml(src.prepared, keep);
  const fallbacks = seg.fallbacks;
  const subject = plainPiece(src.subject, fallbacks, keep);
  const preheader = src.preheader ? plainPiece(src.preheader, fallbacks, keep) : null;
  const pieces = [...seg.pieces, subject, ...(preheader ? [preheader] : [])];
  const forMachine = (t: string) => (sourceLang === 'fr' ? frenchForMachine(t) : t);
  const result: Array<string | null> = pieces.map(() => null);
  // Traducteur interne : les phrases sans mise en forme interne partent en texte simple (il coupe les phrases
  // aux balises), avec les textes de repli. DeepL lit très bien le HTML : tout part en HTML.
  const plains = pieces.map((p) => (translator.name === 'libre' ? plainOf(p) : null));
  const plainIdx = plains.map((pl, i) => (pl ? i : -1)).filter((i) => i >= 0);
  let fb: string[];
  if (translator.name === 'libre') {
    const out = await translator.translate([...plainIdx.map((i) => forMachine(plains[i]!.text)), ...fallbacks.map((f) => forMachine(decodeHtml(f)))], target, source, 'text');
    fb = out.slice(plainIdx.length);
    plainIdx.forEach((i, k) => (result[i] = restorePlain(pieces[i], plains[i]!, out[k], fb)));
  } else {
    fb = [];
  }
  // Le reste en HTML (et, avec DeepL, les textes de repli).
  const htmlIdx = pieces.map((_, i) => i).filter((i) => result[i] === null);
  const withFallbacks = translator.name !== 'libre';
  if (htmlIdx.length || (withFallbacks && fallbacks.length)) {
    const out = await translator.translate([...htmlIdx.map((i) => forMachine(pieces[i].send)), ...(withFallbacks ? fallbacks : []).map(forMachine)], target, source, 'html');
    if (withFallbacks) fb = out.slice(htmlIdx.length);
    htmlIdx.forEach((i, k) => (result[i] = restorePiece(pieces[i], out[k], fb)));
  }
  let kept = 0;
  const final = pieces.map((p, i) => {
    if (result[i] === null) kept++;
    return result[i] ?? p.original;
  });
  const parts = [...seg.parts];
  seg.slots.forEach((slot, i) => (parts[slot] = final[i]));
  const lang = contactLang;
  const html = parts.join('').replace(/(<html\b[^>]*?\blang=)(["'])[^"']*\2/i, `$1$2${lang}$2`);
  const plain = (s: string) => decodeHtml(s).replace(/\s+/g, ' ').trim();
  return {
    html,
    subject: plain(final[seg.pieces.length]) || src.subject,
    preheader: preheader ? plain(final[seg.pieces.length + 1]) || src.preheader : null,
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
  translator: Translator,
): Promise<CampaignTranslationReport> {
  const source = campaignLanguage(db, campaign);
  const languages = accountLanguages(db, campaign.account_id)
    .filter((l) => translator.target(l) && !sameLanguage(l, source))
    .slice(0, MAX_LANGUAGES);
  const report: CampaignTranslationReport = { languages, translated: [], failed: [] };
  // « no » et « nb » : une seule traduction, enregistrée pour les deux.
  const byTarget = new Map<string, Translation>();
  for (const lang of languages) {
    if (translationHash(db, campaign.id, lang) === src.hash) continue;
    try {
      const target = translator.target(lang)!;
      let tr = byTarget.get(target);
      if (!tr) {
        tr = await translateSource(src, lang, translator, source);
        byTarget.set(target, tr);
      }
      saveTranslation(db, campaign.id, lang, src.hash, { ...tr, html: tr.html.replace(/(<html\b[^>]*?\blang=)(["'])[^"']*\2/i, `$1$2${lang}$2`) });
      report.translated.push(lang);
    } catch (err) {
      report.failed.push({ lang, error: err instanceof Error ? err.message : String(err) });
      // Clé refusée ou quota épuisé : les autres langues échoueraient pareil.
      if (err instanceof TranslateError && /clé|quota|absente?|injoignable/.test(err.message)) {
        for (const rest of languages.slice(languages.indexOf(lang) + 1)) report.failed.push({ lang: rest, error: err.message });
        break;
      }
    }
  }
  return report;
}

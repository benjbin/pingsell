// Langue d'un contact quand personne ne l'a donnée (comme les grands outils d'emailing) :
// - « browser » : la langue du navigateur du client, lue quand il clique un lien d'email ou visite le site
//   (en-tête Accept-Language) ; c'est la langue qu'il a choisie, la plus fiable après une langue donnée.
// - « guess »   : estimée de son pays (colonne « Pays » d'un import), de l'indicatif de son téléphone ou du
//   domaine de son email (gmx.de, libero.it…). Les pays à plusieurs langues (Belgique, Suisse, Canada…) ne
//   donnent rien : ces clients gardent la version d'origine.
// Une langue donnée (import, Shopify, API, réglée à la main) a language_source NULL et n'est jamais remplacée
// par une langue détectée ; une langue du navigateur remplace une estimation.
import { get, now, run, transaction, type DatabaseSync } from '../db.js';
import { normalizeContactLanguage } from './contacts.js';
import { AdaptiveBatch } from './timeSlice.js';

export type LanguageSource = 'browser' | 'guess';

/** Pays (ISO 3166-1 alpha-2) → langue, seulement là où une langue domine nettement. */
const COUNTRY_LANG: Record<string, string> = {
  FR: 'fr', MC: 'fr', RE: 'fr', GP: 'fr', MQ: 'fr', GF: 'fr', YT: 'fr', NC: 'fr', PF: 'fr', PM: 'fr', BL: 'fr', MF: 'fr', WF: 'fr',
  SN: 'fr', CI: 'fr', ML: 'fr', BF: 'fr', NE: 'fr', TG: 'fr', BJ: 'fr', GA: 'fr', CG: 'fr', CD: 'fr', GN: 'fr', MG: 'fr',
  GB: 'en', IE: 'en', US: 'en', AU: 'en', NZ: 'en', GG: 'en', JE: 'en', IM: 'en', JM: 'en', GH: 'en', NG: 'en', KE: 'en',
  DE: 'de', AT: 'de', LI: 'de',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es',
  HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es',
  IT: 'it', SM: 'it', VA: 'it',
  NL: 'nl', SR: 'nl',
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt',
  PL: 'pl', SE: 'sv', DK: 'da', NO: 'nb', FI: 'fi', IS: 'is', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', MD: 'ro', BG: 'bg',
  GR: 'el', CY: 'el', HR: 'hr', SI: 'sl', RS: 'sr', EE: 'et', LV: 'lv', LT: 'lt', UA: 'uk', RU: 'ru', BY: 'ru', TR: 'tr',
  JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh', TH: 'th', VN: 'vi', ID: 'id', IL: 'he',
  SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', QA: 'ar', KW: 'ar', JO: 'ar', OM: 'ar', BH: 'ar', IQ: 'ar',
};

/** Indicatif téléphonique → pays (les plus longs d'abord ; +1 et +7 couvrent plusieurs pays d'une même langue). */
const DIAL: Array<[string, string]> = [
  ['33', 'FR'], ['377', 'MC'], ['262', 'RE'], ['590', 'GP'], ['596', 'MQ'], ['594', 'GF'], ['44', 'GB'], ['353', 'IE'],
  ['61', 'AU'], ['64', 'NZ'], ['49', 'DE'], ['43', 'AT'], ['34', 'ES'], ['52', 'MX'], ['54', 'AR'], ['57', 'CO'], ['56', 'CL'],
  ['51', 'PE'], ['39', 'IT'], ['31', 'NL'], ['351', 'PT'], ['55', 'BR'], ['48', 'PL'], ['46', 'SE'], ['45', 'DK'], ['47', 'NO'],
  ['358', 'FI'], ['420', 'CZ'], ['421', 'SK'], ['36', 'HU'], ['40', 'RO'], ['359', 'BG'], ['30', 'GR'], ['385', 'HR'],
  ['386', 'SI'], ['381', 'RS'], ['372', 'EE'], ['371', 'LV'], ['370', 'LT'], ['380', 'UA'], ['90', 'TR'], ['81', 'JP'],
  ['82', 'KR'], ['86', 'CN'], ['886', 'TW'], ['852', 'HK'], ['66', 'TH'], ['84', 'VN'], ['62', 'ID'], ['972', 'IL'],
  ['966', 'SA'], ['971', 'AE'], ['20', 'EG'], ['212', 'MA'], ['213', 'DZ'], ['216', 'TN'], ['221', 'SN'], ['225', 'CI'],
  ['7', 'RU'],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

/** Domaines d'email sans extension de pays mais d'un seul pays. */
const DOMAIN_LANG: Record<string, string> = {
  'laposte.net': 'fr', 'gmx.net': 'de', 'web.de': 'de', 't-online.de': 'de', 'freenet.de': 'de', 'libero.it': 'it',
  'virgilio.it': 'it', 'tiscali.it': 'it', 'seznam.cz': 'cs', 'wp.pl': 'pl', 'o2.pl': 'pl', 'onet.pl': 'pl',
  'interia.pl': 'pl', 'yandex.ru': 'ru', 'mail.ru': 'ru', 'btinternet.com': 'en', 'sky.com': 'en', 'bigpond.com': 'en',
  'naver.com': 'ko', 'qq.com': 'zh', '163.com': 'zh', '126.com': 'zh', 'uol.com.br': 'pt', 'bol.com.br': 'pt',
  'terra.com.br': 'pt', 'sapo.pt': 'pt',
};

/** Extensions génériques ou de pays à plusieurs langues : ne disent rien. */
const TLD_COUNTRY: Record<string, string> = { uk: 'GB', at: 'AT', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', pt: 'PT', br: 'BR', pl: 'PL', se: 'SE', dk: 'DK', no: 'NO', fi: 'FI', cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', gr: 'GR', hr: 'HR', si: 'SI', ee: 'EE', lv: 'LV', lt: 'LT', ua: 'UA', ru: 'RU', tr: 'TR', jp: 'JP', kr: 'KR', cn: 'CN', tw: 'TW', mx: 'MX', ar: 'AR', cl: 'CL', co: 'CO', ie: 'IE', au: 'AU', nz: 'NZ', mc: 'MC', re: 'RE', il: 'IL', th: 'TH', vn: 'VN' };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** Nom de pays (en français, anglais, allemand, espagnol, italien, néerlandais, portugais) ou code → ISO alpha-2. */
let countryNames: Map<string, string> | null = null;
const RETIRED = new Set(['DD', 'YU', 'CS', 'SU', 'ZR', 'TP', 'BU', 'NT', 'AN', 'QO', 'ZZ', 'EU', 'EZ', 'UN']);
function countryIndex(): Map<string, string> {
  if (countryNames) return countryNames;
  const map = new Map<string, string>();
  const locales = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pt', 'pl'];
  const namers = locales.map((l) => {
    try {
      return new Intl.DisplayNames([l], { type: 'region' });
    } catch {
      return null;
    }
  });
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) {
    for (const b of A) {
      const code = a + b;
      // Codes retirés ou non géographiques, que l'ICU nomme comme leur successeur (DD → « Allemagne »).
      if (RETIRED.has(code)) continue;
      for (const namer of namers) {
        const name = namer?.of(code);
        if (name && name !== code) {
          const key = fold(name);
          if (key && !map.has(key)) map.set(key, code);
        }
      }
    }
  }
  for (const [alias, code] of Object.entries({ uk: 'GB', angleterre: 'GB', england: 'GB', ecosse: 'GB', scotland: 'GB', wales: 'GB', usa: 'US', etatsunis: 'US', unitedstatesofamerica: 'US', holland: 'NL', hollande: 'NL' })) {
    map.set(alias, code);
  }
  countryNames = map;
  return map;
}

export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 60) return null;
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase() === 'UK' ? 'GB' : v.toUpperCase();
  return countryIndex().get(fold(v)) ?? null;
}

/** Colonnes d'un import qui donnent le pays (« Pays », « Country », « Country Code », « Default Address Country Code »…). */
const COUNTRY_KEY = /^(pays|country|countrycode|cc|land|pais|paese|kraj|nation|nationalite|nationality)$|country|pays/;

function countryFromAttributes(attributes: Record<string, unknown> | null | undefined): string | null {
  if (!attributes) return null;
  for (const [key, value] of Object.entries(attributes)) {
    if (COUNTRY_KEY.test(fold(key))) {
      const code = countryCode(value);
      if (code) return code;
    }
  }
  return null;
}

/** Pays d'un numéro au format international (+33…, 0033…, ou 33… sans le zéro national). */
export function phoneCountry(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const raw = phone.trim();
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  // Sans « + » ni « 00 » : seulement un numéro long qui ne commence pas par le zéro national (33612345678).
  else if (digits.startsWith('0') || digits.length < 11) return null;
  digits = digits.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  for (const [prefix, country] of DIAL) if (digits.startsWith(prefix)) return country;
  if (digits.startsWith('1')) return 'US';
  return null;
}

export function domainLanguage(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return null;
  if (DOMAIN_LANG[domain]) return DOMAIN_LANG[domain];
  const tld = domain.split('.').pop() ?? '';
  const country = TLD_COUNTRY[tld];
  return country ? (COUNTRY_LANG[country] ?? null) : null;
}

/** Langue estimée d'un contact : pays donné, sinon indicatif du téléphone, sinon domaine de l'email. */
export function guessContactLanguage(c: { email: string; phone?: string | null; attributes?: Record<string, unknown> | null }): string | null {
  const country = countryFromAttributes(c.attributes);
  if (country) return COUNTRY_LANG[country] ?? null; // un pays connu à plusieurs langues : on n'estime pas plus loin
  const byPhone = phoneCountry(c.phone);
  if (byPhone) return COUNTRY_LANG[byPhone] ?? null;
  return domainLanguage(c.email);
}

/** Première langue d'un en-tête Accept-Language (« fr-FR,fr;q=0.9,en;q=0.8 » → « fr »). */
export function acceptLanguage(header: unknown): string | null {
  if (typeof header !== 'string' || !header) return null;
  let best: string | null = null;
  let bestQ = -1;
  for (const part of header.split(',').slice(0, 10)) {
    const [tag, ...params] = part.trim().split(';');
    if (!tag || tag === '*') continue;
    const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
    if (Number.isFinite(q) && q > bestQ) {
      const lang = normalizeContactLanguage(tag);
      if (lang) {
        best = lang;
        bestQ = q;
      }
    }
  }
  return best;
}

/** Robots et scanners de liens (filtres d'entreprise, antivirus) : leur langue n'est pas celle du client. */
const NOT_A_PERSON = /bot|crawl|spider|slurp|headless|lighthouse|preview|scan|proxy|monitor|curl|wget|python|java\/|go-http|okhttp|libwww|safelinks|barracuda|mimecast|proofpoint|symantec|forcepoint|trendmicro/i;

/** Langue du navigateur d'une vraie personne (clic d'email, visite du site), null sinon. */
export function browserLanguage(headers: Record<string, unknown>): string | null {
  const ua = typeof headers['user-agent'] === 'string' ? headers['user-agent'] : '';
  if (!ua || NOT_A_PERSON.test(ua)) return null;
  return acceptLanguage(headers['accept-language']);
}

/**
 * Enregistre une langue détectée, sans jamais écraser une langue donnée : la langue du navigateur remplace
 * une estimation ou un ancien navigateur ; une estimation ne remplit qu'une langue inconnue.
 */
export function learnContactLanguage(db: DatabaseSync, contactId: string | null, lang: string | null, source: LanguageSource): boolean {
  if (!contactId || !lang) return false;
  const replaceable = source === 'browser' ? "language IS NULL OR language_source IN ('guess', 'browser')" : 'language IS NULL';
  return (
    run(
      db,
      `UPDATE contacts SET language = ?, language_source = ?, updated_at = ? WHERE id = ? AND (${replaceable}) AND (language IS NULL OR language != ? OR language_source != ?)`,
      lang,
      source,
      now(),
      contactId,
      lang,
      source,
    ) > 0
  );
}

/* ───────────── Contacts déjà là : estimés une fois, en arrière-plan, par tranches ───────────── */

const STATE_KEY = 'contact_language_guess';
const batch = new AdaptiveBatch(500, 50, 5000);
let guessDone = false;

/** Avance l'estimation des contacts sans langue (rowid croissant) ; renvoie true une fois tout parcouru. */
export function guessMissingLanguages(db: DatabaseSync, budgetMs = 30): boolean {
  if (guessDone) return true;
  const state = get<{ value: string }>(db, 'SELECT value FROM app_state WHERE key = ?', STATE_KEY)?.value ?? '0';
  if (state === 'done') return (guessDone = true);
  let cursor = Number(state) || 0;
  const deadline = Date.now() + budgetMs;
  const select = db.prepare('SELECT rowid AS rid, id, email, phone, attributes, language FROM contacts WHERE rowid > ? ORDER BY rowid LIMIT ?');
  const update = db.prepare("UPDATE contacts SET language = ?, language_source = 'guess' WHERE id = ? AND language IS NULL");
  batch.start();
  let finished = false;
  while (!finished && batch.fits(deadline)) {
    const size = batch.size;
    batch.measure(() =>
      transaction(db, () => {
        const rows = select.all(cursor, size) as Array<{ rid: number; id: string; email: string; phone: string | null; attributes: string | null; language: string | null }>;
        for (const row of rows) {
          cursor = row.rid;
          if (row.language) continue;
          let attributes: Record<string, unknown> | null = null;
          try {
            attributes = row.attributes ? (JSON.parse(row.attributes) as Record<string, unknown>) : null;
          } catch {
            attributes = null;
          }
          const lang = guessContactLanguage({ email: row.email, phone: row.phone, attributes });
          if (lang) update.run(lang, row.id);
        }
        if (rows.length < size) finished = true;
        run(db, 'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', STATE_KEY, finished ? 'done' : String(cursor));
      }),
    );
  }
  if (finished) guessDone = true;
  return finished;
}

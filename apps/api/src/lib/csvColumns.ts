/**
 * Recognises what each column of a contacts CSV holds, whatever the export calls it
 * ("user_email", "Adresse e-mail", "E-mail Address", "customerEmail", "Téléphone portable", "Display name"…).
 * Kept identical in apps/api/src/lib/csvColumns.ts and apps/web/src/lib/csvColumns.ts (the web uses it for the preview).
 */

export type ContactField = 'email' | 'first_name' | 'last_name' | 'full_name' | 'phone' | 'tags' | 'status';

/** Cells that mean "no value" in database and spreadsheet exports. */
const EMPTY_VALUES = new Set(['null', 'nil', 'none', 'n/a', 'na', '#n/a', 'undefined', '-', '—', '–', '(vide)', '(empty)']);
export const isEmptyCell = (v: string) => {
  const s = v.trim();
  return s === '' || EMPTY_VALUES.has(s.toLowerCase());
};

/** Words that say whose field it is or what kind, not what it holds ("user", "customer", "number"…). */
const FILLER = new Set([
  'user', 'users', 'contact', 'contacts', 'customer', 'customers', 'client', 'clients', 'subscriber', 'subscribers',
  'member', 'members', 'membre', 'abonne', 'abonnes', 'utilisateur', 'utilisateurs', 'person', 'personne', 'lead',
  'prospect', 'buyer', 'acheteur', 'account', 'compte', 'profile', 'profil', 'billing', 'facturation',
  'primary', 'principal', 'principale', 'main', 'default', 'your', 'votre', 'du', 'de', 'des', 'la', 'le', 'les',
  'd', 'l', 'the', 'of', 'address', 'adresse', 'number', 'numero', 'num', 'no', 'nr', 'n', 'field', 'champ', 'value', 'valeur',
]);

/** A column about the email or phone but not the address itself ("email_verified", "accepts_sms_marketing"…). */
const NOT_THE_VALUE = new Set([
  'opt', 'optin', 'optout', 'consent', 'consentement', 'marketing', 'verified', 'verifie', 'confirmed', 'confirme',
  'subscribed', 'subscription', 'abonnement', 'accepts', 'accepte', 'status', 'statut', 'date', 'at', 'type', 'count',
  'valid', 'bounce', 'bounced', 'sent', 'open', 'opens', 'click', 'clicks', 'domain', 'domaine', 'format', 'id', 'hash',
  'country', 'code', 'prefix', 'indicatif', 'extension', 'ext',
]);

const EXACT: Array<[ContactField, string[]]> = [
  ['email', ['email', 'e mail', 'mail', 'emails', 'courriel', 'mel', 'electronique', 'mail electronique', 'courrier electronique']],
  ['first_name', ['first name', 'firstname', 'first', 'fname', 'given name', 'givenname', 'forename', 'prenom', 'prenoms']],
  ['last_name', ['last name', 'lastname', 'last', 'lname', 'surname', 'family name', 'familyname', 'nom', 'nom famille', 'patronyme']],
  ['full_name', ['name', 'full name', 'fullname', 'display name', 'displayname', 'nom complet', 'complete name', 'nom prenom', 'prenom nom', 'identite']],
  ['phone', ['phone', 'telephone', 'tel', 'tele', 'mobile', 'portable', 'cell', 'cellphone', 'cell phone', 'gsm', 'mobile phone', 'phone mobile', 'telephone portable', 'telephone mobile', 'whatsapp', 'sms', 'msisdn', 'contact phone']],
  ['tags', ['tags', 'tag', 'labels', 'label', 'etiquettes', 'etiquette', 'groups', 'groupes', 'groupe', 'lists', 'listes']],
  ['status', ['status', 'statut', 'etat', 'state']],
];

/** Tokens that, on their own inside a longer header, give the field away ("work email", "phone 1"). */
const CONTAINS: Array<[ContactField, string[]]> = [
  ['email', ['email', 'mail', 'courriel']],
  ['phone', ['phone', 'telephone', 'mobile', 'portable', 'gsm', 'cellphone', 'tel']],
  ['first_name', ['prenom', 'firstname']],
  ['last_name', ['lastname', 'surname']],
];

function tokens(header: string): string[] {
  return header
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/e-mail/g, 'email')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** What one header names, or null when it is something else (kept as a custom attribute). */
export function fieldOfHeader(header: string): ContactField | null {
  const all = tokens(header).filter((w) => !/^\d+$/.test(w));
  if (all.length === 0) return null;
  const core = all.filter((w) => !FILLER.has(w));
  const joined = (core.length ? core : all).join(' ');
  for (const [field, names] of EXACT) if (names.includes(joined)) return field;
  if (all.some((w) => NOT_THE_VALUE.has(w))) return null;
  for (const [field, words] of CONTAINS) if (all.some((w) => words.includes(w))) return field;
  return null;
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The field of each column (null = custom attribute). Only the first column of each field is used.
 * When no header says "email", the column whose values are mostly email addresses is taken.
 */
export function detectColumns(headers: string[], sample: string[][] = []): Array<ContactField | null> {
  const seen = new Set<ContactField>();
  const out = headers.map((h) => {
    const f = fieldOfHeader(h);
    if (!f || seen.has(f)) return null;
    seen.add(f);
    return f;
  });
  if (!seen.has('email') && sample.length) {
    let best = -1;
    let bestShare = 0.5;
    headers.forEach((_, col) => {
      const values = sample.map((r) => r[col] ?? '').filter((v) => !isEmptyCell(v));
      if (!values.length) return;
      const share = values.filter((v) => EMAIL_LIKE.test(v.trim())).length / values.length;
      if (share > bestShare) {
        best = col;
        bestShare = share;
      }
    });
    if (best >= 0) out[best] = 'email';
  }
  return out;
}

/** "Margaux Lemoine" → first "Margaux", last "Lemoine"; one word → first name only. */
export function splitFullName(full: string): { first_name: string; last_name?: string } {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? { first_name: parts[0], last_name: parts.slice(1).join(' ') } : { first_name: parts[0] };
}

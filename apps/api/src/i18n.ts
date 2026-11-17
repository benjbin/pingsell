import { AsyncLocalStorage } from 'node:async_hooks';

/** Languages supported by the API's human-facing texts (French is the source language). */
export type Lang = 'fr' | 'en';

/** Per-request (or per-job) language context. */
export const als = new AsyncLocalStorage<{ lang: Lang }>();

/** Language of the current request / job; French when outside any context. */
export function currentLang(): Lang {
  return als.getStore()?.lang ?? 'fr';
}

/** Picks the French or English variant according to the current language. */
export function t<T>(fr: T, en: T): T {
  return currentLang() === 'en' ? en : fr;
}

/** Runs `fn` with the given language (worker jobs, emails generated outside a request). */
export function withLang<T>(lang: Lang | string | null | undefined, fn: () => T): T {
  return als.run({ lang: normalizeLang(lang) }, fn);
}

/** Coerces any stored / received value into a supported language (French by default). */
export function normalizeLang(lang: unknown): Lang {
  return lang === 'en' ? 'en' : 'fr';
}

/** `Accept-Language` → language: French if it starts with "fr" or is absent, English otherwise. */
export function langFromHeader(acceptLanguage: string | string[] | undefined): Lang {
  const value = (Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage)?.trim().toLowerCase();
  if (!value) return 'fr';
  return value.startsWith('fr') ? 'fr' : 'en';
}

/** Intl locale matching the current language (numbers, dates). */
export function locale(): 'fr-FR' | 'en-US' {
  return currentLang() === 'en' ? 'en-US' : 'fr-FR';
}

/** Minimal database surface needed to look up an account's language (avoids importing db.ts here). */
interface LangDb {
  prepare(sql: string): { get(...params: string[]): unknown };
}

/** Stored language of an account (`accounts.language`), French when unknown. */
export function accountLang(db: LangDb, accountId: string): Lang {
  const row = db.prepare('SELECT language FROM accounts WHERE id = ?').get(accountId) as { language?: unknown } | undefined;
  return normalizeLang(row?.language);
}

/**
 * Runs `fn` in the account's language when outside a request (worker, background jobs);
 * inside a request the visitor's language is kept.
 */
export function withAccountLang<T>(db: LangDb, accountId: string, fn: () => T): T {
  if (als.getStore()) return fn();
  return withLang(accountLang(db, accountId), fn);
}

/** Runs `fn` outside any language context (e.g. the worker woken up from a request). */
export function outsideLang<T>(fn: () => T): T {
  return als.exit(fn);
}

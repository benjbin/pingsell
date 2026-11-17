// Pingsell i18n: French (source) and English.
// Usage: t("Texte français", "English text"). Works for strings and JSX (t(<>…</>, <>…</>)).
// The language is fixed for the page's lifetime; switching reloads the page, so t() is safe
// in module-level constants as well as in components.

export type Lang = "fr" | "en";
export const LANGS: Lang[] = ["fr", "en"];
const KEY = "pingsell_lang";

function detect(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "fr" || q === "en") {
      localStorage.setItem(KEY, q);
      return q;
    }
    const stored = localStorage.getItem(KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return nav.startsWith("fr") ? "fr" : "en";
}

export const LANG: Lang = detect();
/** BCP 47 locale for Intl formatting. */
export const LOCALE = LANG === "fr" ? "fr-FR" : "en-US";

if (typeof document !== "undefined") document.documentElement.lang = LANG;

export function t<T>(fr: T, en: T): T {
  return LANG === "en" ? en : fr;
}

export function setLang(lang: Lang) {
  if (lang === LANG) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  window.location.replace(url.toString());
}

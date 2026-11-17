// Pingsell mobile i18n: French (source) and English, from the device language.
// Usage: t("Texte français", "English text"). Works for strings and JSX.

export type Lang = "fr" | "en";

function detect(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return locale.startsWith("fr") ? "fr" : "en";
  } catch {
    return "fr";
  }
}

export const LANG: Lang = detect();
/** BCP 47 locale for Intl formatting. */
export const LOCALE = LANG === "fr" ? "fr-FR" : "en-US";

export function t<T>(fr: T, en: T): T {
  return LANG === "en" ? en : fr;
}

// Internal SDK translations: French (source) and English.
// The language comes from Pingsell.init({ locale }) or, by default, from the device.

export type PingsellLocale = "fr" | "en";

function detect(): PingsellLocale {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return locale.startsWith("fr") ? "fr" : "en";
  } catch {
    return "fr";
  }
}

let current: PingsellLocale = detect();

/** Sets the SDK language (called by Pingsell.init when `locale` is passed). */
export function setLocale(locale: PingsellLocale | undefined): void {
  if (locale === "fr" || locale === "en") current = locale;
}

/** SDK language in use: the `locale` passed to Pingsell.init, otherwise the device language. */
export function getLocale(): PingsellLocale {
  return current;
}

/** BCP 47 locale for Intl formatting. */
export function intlLocale(locale: PingsellLocale = current): string {
  return locale === "fr" ? "fr-FR" : "en-US";
}

/** t("Texte français", "English text"), optionally for a given locale (component `locale` prop). */
export function t<T>(fr: T, en: T, locale: PingsellLocale = current): T {
  return locale === "en" ? en : fr;
}

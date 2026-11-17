import { LANG, LANGS, setLang } from "../../lib/i18n";
import { cx } from "../../lib/format";

/** FR / EN switch. `tone="dark"` for navy surfaces. */
export function LanguageToggle({ className, tone = "auto" }: { className?: string; tone?: "auto" | "dark" }) {
  return (
    <div
      role="group"
      aria-label={LANG === "fr" ? "Langue" : "Language"}
      className={cx(
        "flex h-10 items-center rounded-full p-1 font-display text-[11px] font-semibold tracking-wider ring-1 ring-inset",
        tone === "dark" ? "ring-white/15" : "ring-slate-900/15 dark:ring-white/15",
        className,
      )}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={l === LANG}
          lang={l}
          title={l === "fr" ? "Français" : "English"}
          className={cx(
            "h-8 rounded-full px-2.5 uppercase transition-colors",
            l === LANG
              ? tone === "dark"
                ? "bg-white text-slate-900"
                : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : tone === "dark"
                ? "text-white/60 hover:text-white"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

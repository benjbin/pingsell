import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { LANG, LANGS, setLang, t } from "../../lib/i18n";
import { cx } from "../../lib/format";

/** Language picker: globe + current code, opens a small Français / English menu (same as the marketing site). */
export function LanguageToggle({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Langue : français", "Language: English")}
        className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
      >
        <Globe className="size-4" strokeWidth={1.75} />
        <span className="uppercase">{LANG}</span>
        <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-44 animate-pop-in rounded-2xl bg-white p-1.5 shadow-[0_18px_50px_-18px_rgba(11,33,74,0.45)] ring-1 ring-slate-900/[0.08] dark:bg-slate-900 dark:ring-white/10"
        >
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={LANG === l}
              lang={l}
              onClick={() => setLang(l)}
              className={cx(
                "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5",
                LANG === l ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400",
              )}
            >
              {l === "fr" ? "Français" : "English"}
              {LANG === l && <Check className="size-4 text-brand-500" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Contact } from "../../lib/types";
import { Input } from "../../components/ui/primitives";
import { cx } from "../../lib/format";
import { t } from "../../lib/i18n";

const nameOf = (c: Contact) => [c.first_name, c.last_name].filter(Boolean).join(" ");

/** Pick one or more contacts by name or email for a campaign. Unsubscribed ones are shown but will not receive it. */
export function ContactPicker({ ids, onChange, disabled }: { ids: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [known, setKnown] = useState<Record<string, Contact>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Names of the contacts already chosen (a saved campaign only stores their ids).
  const requested = useRef(new Set<string>());
  useEffect(() => {
    // Each id is looked up once (a deleted contact would otherwise be fetched again and again).
    const missing = ids.filter((id) => !known[id] && !requested.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requested.current.add(id));
    let alive = true;
    (async () => {
      const found: Record<string, Contact> = {};
      for (let i = 0; i < missing.length; i += 200) {
        const chunk = missing.slice(i, i + 200);
        const res = await api.contacts.list({ ids: chunk.join(","), limit: 200 }).catch(() => null);
        res?.data.forEach((c) => (found[c.id] = c));
      }
      if (alive) setKnown((k) => ({ ...k, ...found }));
    })();
    return () => {
      alive = false;
    };
  }, [ids, known]);

  // Search as you type.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api.contacts
        .list({ search: q, limit: 8 })
        .then((r) => alive && setResults(r.data))
        .catch(() => alive && setResults([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const add = (c: Contact) => {
    setKnown((k) => ({ ...k, [c.id]: c }));
    if (!ids.includes(c.id)) onChange([...ids, c.id]);
    setQuery("");
    setOpen(false);
  };
  const remove = (id: string) => onChange(ids.filter((x) => x !== id));

  const chosen = ids.map((id) => known[id]).filter(Boolean);
  const unsubscribed = chosen.filter((c) => c.status !== "subscribed").length;

  return (
    <div className="space-y-2">
      {!disabled && (
        <div ref={boxRef} className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const first = results.find((c) => !ids.includes(c.id));
                if (first) add(first);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={t("Chercher un contact par nom ou email…", "Search a contact by name or email…")}
            className="pl-9"
            aria-label={t("Ajouter un contact", "Add a contact")}
          />
          {open && query.trim() && (
            <div className="absolute top-full right-0 left-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">{t("Aucun contact trouvé", "No contact found")}</p>
              ) : (
                results.map((c) => {
                  const picked = ids.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={picked}
                      onClick={() => add(c)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/10"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{nameOf(c) || c.email}</span>
                        {nameOf(c) && <span className="block truncate text-xs text-slate-500">{c.email}</span>}
                      </span>
                      {c.status !== "subscribed" && <span className="shrink-0 text-[11px] text-amber-600">{t("désabonné", "unsubscribed")}</span>}
                      {picked ? <span className="shrink-0 text-[11px] text-slate-400">{t("ajouté", "added")}</span> : <Plus className="size-4 shrink-0 text-brand-500" />}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {ids.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const c = known[id];
            const off = c && c.status !== "subscribed";
            return (
              <span
                key={id}
                className={cx(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-xs ring-1",
                  off ? "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-900/20 dark:text-amber-200" : "bg-slate-100 text-slate-800 ring-slate-900/5 dark:bg-white/10 dark:text-slate-100",
                )}
                title={c ? c.email : undefined}
              >
                <span className="truncate">{c ? nameOf(c) || c.email : "…"}</span>
                {!disabled && (
                  <button type="button" onClick={() => remove(id)} className="rounded-full p-0.5 hover:bg-slate-900/10 dark:hover:bg-white/10" aria-label={t("Retirer", "Remove")}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Aucun contact choisi pour l'instant.", "No contact chosen yet.")}</p>
      )}

      {ids.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t(`${ids.length} contact${ids.length > 1 ? "s" : ""} choisi${ids.length > 1 ? "s" : ""}`, `${ids.length} contact${ids.length > 1 ? "s" : ""} chosen`)}
          {unsubscribed > 0 &&
            t(
              ` · ${unsubscribed} désabonné${unsubscribed > 1 ? "s" : ""} ne ${unsubscribed > 1 ? "recevront" : "recevra"} pas l'email`,
              ` · ${unsubscribed} unsubscribed won't receive the email`,
            )}
          {!disabled && (
            <>
              {" · "}
              <button type="button" onClick={() => onChange([])} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                {t("Tout retirer", "Remove all")}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

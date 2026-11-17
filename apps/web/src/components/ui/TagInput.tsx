import { useState, type KeyboardEvent } from "react";
import { TagChip } from "./primitives";
import { t } from "../../lib/i18n";

/** Free-text tag editor: Enter or comma adds, Backspace on empty removes last. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = t("Ajouter un tag…", "Add a tag…"),
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = id ? `${id}-suggestions` : undefined;

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/^#/, "");
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 shadow-xs ring-1 ring-slate-200 ring-inset focus-within:ring-2 focus-within:ring-brand-600 dark:bg-slate-950 dark:ring-slate-700">
      {value.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => onChange(value.filter((x) => x !== tag))} />
      ))}
      <input
        id={id}
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
      />
      {listId && (
        <datalist id={listId}>
          {suggestions.filter((s) => !value.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

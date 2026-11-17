import { useRef, useState } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { useToast } from "../ui/Toast";
import { Input, Select } from "../ui/primitives";
import { customFontDef, customFontKey, type CustomFont } from "./model";
import { t } from "../../lib/i18n";

const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;

/** Finds the Google Fonts spec that loads for `name`, trying the full weight range first. */
async function resolveGoogleFont(name: string): Promise<string | null> {
  const family = name.trim().replace(/\s+/g, "+");
  for (const spec of [`${family}:wght@400;500;600;700;800`, `${family}:wght@400;700`, family]) {
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`);
      if (res.ok) return spec;
    } catch {
      return null;
    }
  }
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t("Lecture du fichier impossible", "Couldn't read the file")));
    r.readAsDataURL(file);
  });
}

/** "Vos polices": add any Google font by name or upload the brand's own font files. */
export function FontsManager({ fonts, onChange }: { fonts: CustomFont[]; onChange: (fonts: CustomFont[]) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [fallback, setFallback] = useState<CustomFont["fallback"]>("sans");
  const [busy, setBusy] = useState<null | "google" | "upload">(null);

  async function addGoogle() {
    const label = name.trim();
    if (!label) return;
    if (fonts.some((f) => f.label.toLowerCase() === label.toLowerCase())) return toast.error(new Error(t("Cette police est déjà dans votre liste", "This font is already in your list")));
    setBusy("google");
    const spec = await resolveGoogleFont(label);
    setBusy(null);
    if (!spec) return toast.error(new Error(t(`« ${label} » est introuvable sur Google Fonts. Vérifiez l'orthographe (ex. « Roboto Slab »).`, `“${label}” wasn't found on Google Fonts. Check the spelling (e.g. “Roboto Slab”).`)));
    onChange([...fonts, { key: customFontKey(label), label, family: label, source: "google", google: spec, fallback }]);
    setName("");
    toast.success(t(`Police « ${label} » ajoutée`, `Font “${label}” added`));
  }

  async function upload(files: FileList) {
    setBusy("upload");
    const added: CustomFont[] = [];
    for (const file of Array.from(files)) {
      try {
        if (!FONT_EXT.test(file.name)) throw new Error(t(`${file.name} : formats acceptés WOFF2, WOFF, TTF, OTF`, `${file.name}: accepted formats are WOFF2, WOFF, TTF, OTF`));
        const asset = await api.assets.upload({ filename: file.name, data: await readAsDataUrl(file) });
        const label = file.name.replace(FONT_EXT, "").replace(/[-_]+/g, " ").trim();
        added.push({ key: customFontKey(label), label, family: `${label} ${asset.id.slice(0, 6)}`, source: "upload", url: asset.url, fallback });
      } catch (err) {
        toast.error(err);
      }
    }
    setBusy(null);
    if (added.length) {
      onChange([...fonts, ...added]);
      toast.success(added.length > 1 ? t(`${added.length} polices importées`, `${added.length} fonts uploaded`) : t(`Police « ${added[0].label} » importée`, `Font “${added[0].label}” uploaded`));
    }
  }

  const rename = (key: string, label: string) => onChange(fonts.map((f) => (f.key === key ? { ...f, label } : f)));

  return (
    <div className="space-y-3">
      {fonts.length > 0 && (
        <ul className="space-y-1.5">
          {fonts.map((f) => (
            <li key={f.key} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-900/[0.06] dark:bg-white/[0.03] dark:ring-white/10">
              <span className="w-9 shrink-0 text-xl leading-none text-slate-900 dark:text-white" style={{ fontFamily: customFontDef(f).stack }}>
                Aa
              </span>
              <span className="min-w-0 flex-1">
                <input
                  value={f.label}
                  onChange={(e) => rename(f.key, e.target.value)}
                  className="w-full truncate bg-transparent text-sm font-medium text-slate-900 outline-none dark:text-white"
                  aria-label={t("Nom de la police", "Font name")}
                />
                <span className="block text-[11px] text-slate-500">{f.source === "google" ? "Google Fonts" : t("Fichier importé", "Uploaded file")}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(fonts.filter((x) => x.key !== f.key))}
                className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-red-600 dark:hover:bg-white/10"
                aria-label={t(`Retirer ${f.label}`, `Remove ${f.label}`)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{t("Ajouter une police Google", "Add a Google font")}</p>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void addGoogle())}
            placeholder={t("ex. Roboto Slab, Syne, Fraunces…", "e.g. Roboto Slab, Syne, Fraunces…")}
            className="h-9 text-sm"
          />
          <button
            type="button"
            onClick={() => void addGoogle()}
            disabled={!name.trim() || busy !== null}
            className="flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-3.5 font-display text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-40 dark:bg-white dark:text-slate-900"
          >
            {busy === "google" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} {t("Ajouter", "Add")}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {t("Plus de 1 500 polices sur", "Over 1,500 fonts at")}{" "}
          <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="underline hover:text-brand-500">
            fonts.google.com
          </a>
          .
        </p>
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy !== null}
        className={cx("flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-900/15 px-3 py-3 font-display text-xs font-semibold text-slate-900 transition hover:border-brand-500 disabled:opacity-50 dark:border-white/15 dark:text-white")}
      >
        {busy === "upload" ? <Loader2 className="size-4 animate-spin text-brand-500" /> : <Upload className="size-4 text-brand-500" />}
        {t("Importer votre police (WOFF2, WOFF, TTF, OTF)", "Upload your font (WOFF2, WOFF, TTF, OTF)")}
      </button>
      <input ref={input} type="file" accept=".woff2,.woff,.ttf,.otf" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{t("Police de secours", "Fallback font")}</p>
        <Select value={fallback} onChange={(e) => setFallback(e.target.value as CustomFont["fallback"])} className="h-9 text-sm">
          <option value="sans">{t("Sans empattement (Helvetica)", "Sans-serif (Helvetica)")}</option>
          <option value="serif">{t("Avec empattement (Georgia)", "Serif (Georgia)")}</option>
          <option value="mono">{t("Machine à écrire (Courier)", "Typewriter (Courier)")}</option>
        </Select>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("Gmail et Outlook n'affichent pas les polices personnalisées : ils utilisent cette police de secours. Apple Mail, iPhone et la plupart des applis mobiles affichent la vôtre.", "Gmail and Outlook don't display custom fonts, so they use this fallback font instead. Apple Mail, iPhone and most mobile apps show yours.")}</p>
      </div>
    </div>
  );
}

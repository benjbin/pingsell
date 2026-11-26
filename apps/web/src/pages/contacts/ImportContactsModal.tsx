import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";
import { api } from "../../lib/api";
import type { ImportErrorDetail, ImportResult } from "../../lib/types";
import { Button, Textarea } from "../../components/ui/primitives";
import { Modal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";
import { detectColumns, isEmptyCell, type ContactField } from "../../lib/csvColumns";

const EXAMPLE = t(
  `email,first_name,last_name,tags
marie.dupont@exemple.fr,Marie,Dupont,vip;newsletter
paul.martin@exemple.fr,Paul,Martin,newsletter`,
  `email,first_name,last_name,tags
jane.doe@example.com,Jane,Doe,vip;newsletter
john.smith@example.com,John,Smith,newsletter`,
);

/** Minimal CSV preview parser (quotes aware) — the API does the real parsing. */
function previewRows(csv: string, max = 5): string[][] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim()).slice(0, max + 1);
  // A comma header means ";" separates tags inside a cell; otherwise the file is ";"-delimited.
  const sep = (lines[0] ?? "").includes(",") ? "," : (lines[0] ?? "").includes("\t") ? "\t" : ";";
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === sep && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  });
}

const FIELD_LABEL: Record<ContactField, string> = {
  email: "Email",
  first_name: t("Prénom", "First name"),
  last_name: t("Nom", "Last name"),
  full_name: t("Prénom et nom", "Full name"),
  phone: t("Téléphone", "Phone"),
  tags: "Tags",
  status: t("Statut", "Status"),
  language: t("Langue", "Language"),
};

/** Emails present more than once in the file (case and spaces ignored), with how many times. */
function duplicateEmails(rows: string[][], col: number): Array<{ email: string; count: number }> {
  if (col < 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const cell = r[col] ?? "";
    if (isEmptyCell(cell)) continue;
    const email = cell.trim().toLowerCase();
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([email, count]) => ({ email, count }));
}

function errorCount(errors: ImportResult["errors"]): number {
  return Array.isArray(errors) ? errors.length : errors;
}

function errorList(result: ImportResult): Array<string | ImportErrorDetail> {
  return result.error_details ?? (Array.isArray(result.errors) ? result.errors : []);
}

export function ImportContactsModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (result: ImportResult) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const rows = useMemo(() => (csv ? previewRows(csv) : []), [csv]);
  const analysis = useMemo(() => {
    if (!csv) return null;
    const all = previewRows(csv, Infinity);
    const columns = detectColumns(all[0] ?? [], all.slice(1, 201));
    const emailCol = columns.indexOf("email");
    const noEmail = emailCol < 0 ? 0 : all.slice(1).filter((r) => isEmptyCell(r[emailCol] ?? "")).length;
    return { columns, emailCol, noEmail, dupes: duplicateEmails(all, emailCol) };
  }, [csv]);
  const dupes = analysis?.dupes ?? [];
  const missingEmailColumn = !!analysis && rows.length > 1 && analysis.emailCol < 0;
  const extraRows = dupes.reduce((n, d) => n + d.count - 1, 0);
  const totalLines = useMemo(() => Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim()).length - 1), [csv]);

  function close() {
    setCsv("");
    setFileName(null);
    setResult(null);
    onClose();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function submit() {
    setLoading(true);
    try {
      const res = await api.contacts.importContacts({ csv });
      setResult(res);
      onImported(res);
      const dup = res.duplicates ?? 0;
      const noMail = res.skipped_no_email ?? 0;
      toast.success(
        t("Import terminé", "Import complete"),
        t(
          `${res.created} créés, ${res.updated} mis à jour${dup ? `, ${dup} doublon${dup > 1 ? "s" : ""} ignoré${dup > 1 ? "s" : ""}` : ""}${noMail ? `, ${noMail} sans email écartée${noMail > 1 ? "s" : ""}` : ""}`,
          `${res.created} created, ${res.updated} updated${dup ? `, ${dup} duplicate${dup > 1 ? "s" : ""} skipped` : ""}${noMail ? `, ${noMail} without email set aside` : ""}`,
        ),
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t("Importer des contacts", "Import contacts")}
      description={t("Fichier CSV avec une colonne d'adresses email, quel que soit son nom. Prénom, nom, téléphone, tags et statut sont reconnus automatiquement ; les autres colonnes sont gardées comme champs personnalisés. Les lignes sans email sont écartées.", "A CSV file with an email address column, whatever it's called. First name, last name, phone, tags and status are recognised automatically; other columns are kept as custom fields. Rows without an email are set aside.")}
      footer={
        result ? (
          <Button onClick={close}>{t("Fermer", "Close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button onClick={submit} loading={loading} disabled={!csv.trim() || missingEmailColumn}>
              {t("Importer", "Import")} {totalLines > 0 ? t(`${totalLines} ligne${totalLines > 1 ? "s" : ""}`, `${totalLines} row${totalLines === 1 ? "" : "s"}`) : ""}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{t("Import terminé", "Import complete")}</p>
          <div className={`mt-4 grid w-full grid-cols-2 gap-3 ${result.skipped_no_email ? "max-w-xl sm:grid-cols-5" : "max-w-md sm:grid-cols-4"}`}>
            {[
              { label: t("Créés", "Created"), value: result.created },
              { label: t("Mis à jour", "Updated"), value: result.updated },
              { label: t("Doublons ignorés", "Duplicates skipped"), value: result.duplicates ?? 0 },
              ...(result.skipped_no_email ? [{ label: t("Sans email, écartés", "No email, set aside"), value: result.skipped_no_email }] : []),
              { label: t("Erreurs", "Errors"), value: errorCount(result.errors) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{s.value}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
          {(result.duplicate_details?.length ?? 0) > 0 && (
            <div className="mt-4 w-full rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-semibold">
                {t(
                  "Ces adresses étaient en double dans le fichier : seule la première ligne a été importée.",
                  "These addresses appeared more than once in the file: only the first row was imported.",
                )}
              </p>
              <ul className="mt-1.5 max-h-40 overflow-y-auto">
                {result.duplicate_details!.slice(0, 50).map((d) => (
                  <li key={d.row}>
                    {t(`Ligne ${d.row} — ${d.email} : déjà à la ligne ${d.first_row}`, `Row ${d.row} — ${d.email}: already on row ${d.first_row}`)}
                  </li>
                ))}
              </ul>
              {(result.duplicates ?? 0) > 50 && <p className="mt-1">{t(`… et ${(result.duplicates ?? 0) - 50} autres.`, `… and ${(result.duplicates ?? 0) - 50} more.`)}</p>}
            </div>
          )}
          {errorList(result).length > 0 && (
            <ul className="mt-4 max-h-40 w-full overflow-y-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorList(result).slice(0, 50).map((e, i) => (
                <li key={i}>{typeof e === "string" ? e : `${e.row != null ? t(`Ligne ${e.row} — `, `Row ${e.row} — `) : ""}${e.email ? t(`${e.email} : `, `${e.email}: `) : ""}${e.error}`}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:hover:border-brand-500 dark:hover:bg-brand-900/10"
          >
            <FileUp className="size-8 text-brand-500" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{fileName ?? t("Déposez un fichier CSV ou cliquez pour parcourir", "Drop a CSV file or click to browse")}</span>
            <span className="text-xs text-slate-500">{t("ou collez le contenu ci-dessous", "or paste its contents below")}</span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Textarea
            rows={5}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setFileName(null);
            }}
            placeholder={EXAMPLE}
            className="font-mono text-xs"
          />
          {missingEmailColumn && (
            <div className="flex gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                {t(
                  "Aucune colonne de ce fichier ne contient d'adresses email. Un contact a besoin d'un email : ajoutez cette colonne puis réessayez.",
                  "No column in this file holds email addresses. A contact needs an email: add that column and try again.",
                )}
              </p>
            </div>
          )}
          {!!analysis?.noEmail && (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t(
                `${analysis.noEmail} ligne${analysis.noEmail > 1 ? "s" : ""} sans email ${analysis.noEmail > 1 ? "seront écartées" : "sera écartée"}.`,
                `${analysis.noEmail} row${analysis.noEmail > 1 ? "s" : ""} without an email will be set aside.`,
              )}
            </p>
          )}
          {dupes.length > 0 && (
            <div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {t(
                    `${dupes.length} adresse${dupes.length > 1 ? "s" : ""} en double dans ce fichier (${extraRows} ligne${extraRows > 1 ? "s" : ""} en trop)`,
                    `${dupes.length} duplicate address${dupes.length > 1 ? "es" : ""} in this file (${extraRows} extra row${extraRows > 1 ? "s" : ""})`,
                  )}
                </p>
                <p className="mt-0.5">
                  {t(
                    "Pas d'inquiétude : chaque personne ne sera importée qu'une fois, avec sa première ligne. Les suivantes seront ignorées.",
                    "No worries: each person is imported only once, from their first row. The following ones are skipped.",
                  )}
                </p>
                <p className="mt-1 truncate text-xs opacity-80">
                  {dupes
                    .slice(0, 5)
                    .map((d) => `${d.email} (×${d.count})`)
                    .join(", ")}
                  {dupes.length > 5 ? t(` et ${dupes.length - 5} autres`, ` and ${dupes.length - 5} more`) : ""}
                </p>
              </div>
            </div>
          )}
          {rows.length > 1 && (
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    {rows[0].map((h, i) => {
                      const field = analysis?.columns[i];
                      return (
                        <th key={i} className="px-3 py-2 align-bottom font-medium">
                          <span className="block">{h}</span>
                          <span className={`block text-[10.5px] font-semibold ${field ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                            {field ? `→ ${FIELD_LABEL[field]}` : t("→ champ personnalisé", "→ custom field")}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.slice(1).map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className="px-3 py-1.5 text-slate-700 dark:text-slate-300">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">{t("Aperçu des premières lignes", "Preview of the first rows")}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

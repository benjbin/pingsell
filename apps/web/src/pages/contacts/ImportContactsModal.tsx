import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { api } from "../../lib/api";
import type { ImportErrorDetail, ImportResult } from "../../lib/types";
import { Button, Textarea } from "../../components/ui/primitives";
import { Modal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";

const EXAMPLE = `email,first_name,last_name,tags
marie.dupont@exemple.fr,Marie,Dupont,vip;newsletter
paul.martin@exemple.fr,Paul,Martin,newsletter`;

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
      toast.success("Import terminé", `${res.created} créés, ${res.updated} mis à jour`);
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
      title="Importer des contacts"
      description="Fichier CSV avec une colonne email (obligatoire) et, au choix : first_name, last_name, phone, tags (séparés par ;), status."
      footer={
        result ? (
          <Button onClick={close}>Fermer</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Annuler
            </Button>
            <Button onClick={submit} loading={loading} disabled={!csv.trim()}>
              Importer {totalLines > 0 ? `${totalLines} ligne${totalLines > 1 ? "s" : ""}` : ""}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">Import terminé</p>
          <div className="mt-4 grid w-full max-w-sm grid-cols-3 gap-3">
            {[
              { label: "Créés", value: result.created },
              { label: "Mis à jour", value: result.updated },
              { label: "Erreurs", value: errorCount(result.errors) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{s.value}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
          {errorList(result).length > 0 && (
            <ul className="mt-4 max-h-40 w-full overflow-y-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorList(result).slice(0, 50).map((e, i) => (
                <li key={i}>{typeof e === "string" ? e : `${e.row != null ? `Ligne ${e.row} — ` : ""}${e.email ? `${e.email} : ` : ""}${e.error}`}</li>
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
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{fileName ?? "Déposez un fichier CSV ou cliquez pour parcourir"}</span>
            <span className="text-xs text-slate-500">ou collez le contenu ci-dessous</span>
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
          {rows.length > 1 && (
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    {rows[0].map((h, i) => (
                      <th key={i} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
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
              <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">Aperçu des premières lignes</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

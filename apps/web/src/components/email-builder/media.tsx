import { useRef, useState } from "react";
import { ImagePlus, Images, Loader2, Trash2, Upload, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Asset } from "../../lib/types";
import { cx } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useToast } from "../ui/Toast";
import { Modal } from "../ui/Overlay";
import { Input } from "../ui/primitives";

export const DND_ASSET = "application/x-missive-asset";
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Lecture du fichier impossible"));
    r.readAsDataURL(file);
  });
}

async function dimensions(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const d = { width: bmp.width, height: bmp.height };
    bmp.close();
    return d;
  } catch {
    return {};
  }
}

export async function uploadImage(file: File): Promise<Asset> {
  if (!ACCEPT.split(",").includes(file.type)) throw new Error("Format non pris en charge : PNG, JPG, GIF ou WebP");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image trop lourde (8 Mo maximum)");
  const [data, dims] = await Promise.all([readAsDataUrl(file), dimensions(file)]);
  return api.assets.upload({ filename: file.name, data, ...dims });
}

/** Hook shared by every upload entry point (button, drop, paste). */
export function useUploader(onUploaded: (asset: Asset) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy((n) => n + list.length);
    for (const file of list) {
      try {
        onUploaded(await uploadImage(file));
      } catch (err) {
        toast.error(err);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }
  return { upload, busy: busy > 0 };
}

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/** Grid of uploaded images, with upload dropzone. Used in the side panel and the picker modal. */
export function MediaLibrary({ onPick, compact }: { onPick: (asset: Asset) => void; compact?: boolean }) {
  const assets = useAsync(() => api.assets.list(), []);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { upload, busy } = useUploader(() => void assets.reload());

  async function remove(a: Asset) {
    try {
      await api.assets.remove(a.id);
      await assets.reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
        className={cx(
          "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition",
          over ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-slate-900/15 hover:border-brand-500 dark:border-white/15",
        )}
      >
        {busy ? <Loader2 className="size-5 animate-spin text-brand-500" /> : <Upload className="size-5 text-brand-500" strokeWidth={1.75} />}
        <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">{busy ? "Import en cours…" : "Importer des images"}</span>
        <span className="text-xs text-slate-500">Glissez-déposez ou cliquez · PNG, JPG, GIF, WebP · 8 Mo max</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />

      {assets.loading && !assets.data ? (
        <div className={cx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4")}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100 dark:bg-white/5" />
          ))}
        </div>
      ) : (assets.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Aucune image pour l'instant.</p>
      ) : (
        <div className={cx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4")}>
          {(assets.data ?? []).map((a) => (
            <div key={a.id} className="group relative">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_ASSET, a.url);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPick(a)}
                title={`${a.filename} · ${formatSize(a.size)}${a.width ? ` · ${a.width}×${a.height}` : ""}`}
                className="block aspect-square w-full overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/10 transition hover:ring-2 hover:ring-brand-500 dark:bg-white/5 dark:ring-white/10"
              >
                <img src={a.url} alt={a.filename} className="size-full object-cover" loading="lazy" />
              </button>
              <button
                type="button"
                onClick={() => void remove(a)}
                className="absolute top-1.5 right-1.5 hidden rounded-full bg-slate-900/80 p-1 text-white group-hover:block hover:bg-red-600"
                aria-label={`Supprimer ${a.filename}`}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Image slot in the inspector: preview, upload, library, URL. */
export function ImageField({ value, onChange, label = "Image" }: { value: string; onChange: (url: string) => void; label?: string }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy } = useUploader((a) => onChange(a.url));

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      <div
        className="relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-900/10 dark:bg-white/5 dark:ring-white/10"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const url = e.dataTransfer.getData(DND_ASSET);
          if (url) onChange(url);
          else void upload(e.dataTransfer.files);
        }}
      >
        {value ? (
          <>
            <img src={value} alt="" className="max-h-40 w-full object-contain" />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute top-2 right-2 rounded-full bg-slate-900/80 p-1 text-white hover:bg-red-600"
              aria-label="Retirer l'image"
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <div className="flex h-24 flex-col items-center justify-center gap-1 text-xs text-slate-500">
            {busy ? <Loader2 className="size-5 animate-spin text-brand-500" /> : <ImagePlus className="size-5" strokeWidth={1.5} />}
            {busy ? "Import…" : "Déposez une image ici"}
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center justify-center gap-1.5 rounded-full py-2 font-display text-xs font-semibold text-slate-900 ring-1 ring-slate-900/15 hover:ring-slate-900/40 dark:text-white dark:ring-white/15"
        >
          <Upload className="size-3.5" /> Importer
        </button>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-full py-2 font-display text-xs font-semibold text-slate-900 ring-1 ring-slate-900/15 hover:ring-slate-900/40 dark:text-white dark:ring-white/15"
        >
          <Images className="size-3.5" /> Médiathèque
        </button>
      </div>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="ou collez une URL https://…" className="mt-2 h-9 text-xs" />
      <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} size="lg" title="Médiathèque" description="Cliquez sur une image pour l'utiliser.">
        <MediaLibrary
          onPick={(a) => {
            onChange(a.url);
            setLibraryOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChartNoAxesColumn,
  CircleHelp,
  LayoutGrid,
  LayoutPanelLeft,
  ListChecks,
  Menu,
  PanelTop,
  Signature,
  Smartphone,
  Smile,
  SquareMousePointer,
  Star,
  Timer,
  Code2,
  Columns3,
  GripVertical,
  Heading,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  PanelBottom,
  Play,
  Quote,
  Save,
  Share2,
  ShoppingBag,
  Stamp,
  Ticket,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { cx, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import type { Asset, SavedTemplate } from "../../lib/types";
import { useToast } from "../ui/Toast";
import { Button, Input } from "../ui/primitives";
import { ConfirmModal } from "../ui/Overlay";
import { MediaLibrary } from "./media";
import { BLOCK_LIBRARY, PRESETS, blockSummary, parseDesign, serializeDesign, type Block, type BlockCategory, type BlockType, type Design, type Preset } from "./model";

export const ICONS: Record<BlockType, LucideIcon> = {
  logo: Stamp,
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  product: ShoppingBag,
  columns: Columns3,
  promo: Ticket,
  quote: Quote,
  video: Play,
  social: Share2,
  divider: Minus,
  spacer: MoveVertical,
  html: Code2,
  footer: PanelBottom,
  hero: PanelTop,
  imageText: LayoutPanelLeft,
  list: ListChecks,
  gallery: LayoutGrid,
  buttons: SquareMousePointer,
  stats: ChartNoAxesColumn,
  review: Star,
  faq: CircleHelp,
  features: BadgeCheck,
  countdown: Timer,
  event: CalendarDays,
  survey: Smile,
  apps: Smartphone,
  menu: Menu,
  signature: Signature,
};

export const LABELS = Object.fromEntries(BLOCK_LIBRARY.map((b) => [b.type, b.label])) as Record<BlockType, string>;
export const DND_NEW = "application/x-pingsell-new";
export const DND_MOVE = "application/x-pingsell-move";

function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 pt-5 pb-4">
      <h2 className="font-display text-lg leading-none font-extrabold tracking-[-0.02em] text-slate-900 uppercase dark:text-white">
        {title}
        <span className="text-brand-500">.</span>
      </h2>
      {subtitle && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}

// --- Blocks ---------------------------------------------------------------------------

export function BlocksPanel({ onInsert, disabled }: { onInsert: (type: BlockType) => void; disabled?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<BlockCategory, typeof BLOCK_LIBRARY>();
    for (const b of BLOCK_LIBRARY) map.set(b.category, [...(map.get(b.category) ?? []), b]);
    return [...map.entries()];
  }, []);
  return (
    <>
      <PanelTitle title="Blocs" subtitle="Glissez un bloc dans l'email, ou cliquez pour l'ajouter sous la sélection." />
      <div className="space-y-6 px-5 pb-6">
        {groups.map(([cat, items]) => (
          <div key={cat}>
            <p className="eyebrow mb-2.5">{cat}</p>
            <div className="grid grid-cols-3 gap-2">
              {items.map((b) => {
                const Icon = ICONS[b.type];
                return (
                  <button
                    key={b.type}
                    type="button"
                    disabled={disabled}
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_NEW, b.type);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onInsert(b.type)}
                    title={b.hint}
                    className="group flex aspect-square cursor-grab flex-col items-center justify-center gap-2 rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-brand-500 hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-slate-200"
                  >
                    <Icon className="size-5" strokeWidth={1.5} />
                    <span className="font-display text-[11.5px] font-semibold">{b.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// --- Layers -----------------------------------------------------------------------------

export function LayersPanel({
  blocks,
  selectedId,
  onSelect,
  onMove,
  onRemove,
  disabled,
}: {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <>
      <PanelTitle title="Calques" subtitle={`${blocks.length} blocs · glissez pour réordonner`} />
      <ol className="space-y-1 px-3 pb-6">
        {blocks.map((b, i) => {
          const Icon = ICONS[b.type];
          return (
            <li
              key={b.id}
              draggable={!disabled}
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null && dragFrom !== i) onMove(dragFrom, i > dragFrom ? i + 1 : i);
                setDragFrom(null);
                setOver(null);
              }}
              onClick={() => onSelect(b.id)}
              className={cx(
                "group flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition",
                b.id === selectedId ? "bg-brand-500 text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5",
                over === i && dragFrom !== i && "ring-2 ring-brand-500",
                dragFrom === i && "opacity-40",
              )}
            >
              <GripVertical className={cx("size-3.5 shrink-0 cursor-grab", b.id === selectedId ? "text-white/60" : "text-slate-300")} />
              <Icon className="size-4 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[13px] font-semibold">{LABELS[b.type]}</span>
                <span className={cx("block truncate text-[11px]", b.id === selectedId ? "text-white/70" : "text-slate-500")}>{blockSummary(b) || "—"}</span>
              </span>
              {(b.style?.hideMobile || b.style?.hideDesktop) && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">{b.style.hideMobile ? "Ordi" : "Mobile"}</span>}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(b.id);
                  }}
                  className="hidden rounded-full p-1 group-hover:block hover:bg-red-500 hover:text-white"
                  aria-label={`Supprimer ${LABELS[b.type]}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// --- Media ------------------------------------------------------------------------------

export function MediaPanel({ onPick }: { onPick: (asset: Asset) => void }) {
  return (
    <>
      <PanelTitle title="Médias" subtitle="Cliquez pour placer l'image dans le bloc sélectionné, ou glissez-la dans l'email." />
      <div className="px-5 pb-6">
        <MediaLibrary onPick={onPick} compact />
      </div>
    </>
  );
}

// --- Templates ----------------------------------------------------------------------------

function MiniPreview({ design }: { design: Design }) {
  const t = design.theme;
  return (
    <span className="flex h-20 flex-col justify-end gap-1 p-2.5" style={{ background: t.background }}>
      <span className="flex flex-col gap-1 rounded-md p-2" style={{ background: t.surface }}>
        <span className="h-1.5 w-10 rounded-full" style={{ background: t.text, opacity: 0.85 }} />
        <span className="h-1 w-14 rounded-full" style={{ background: t.text, opacity: 0.3 }} />
        <span className="mt-0.5 h-2.5 w-9 rounded-full" style={{ background: t.accent }} />
      </span>
    </span>
  );
}

export function TemplatesPanel({
  brand,
  design,
  onPreset,
  onLoad,
  disabled,
}: {
  brand: string;
  design: Design;
  onPreset: (p: Preset) => void;
  onLoad: (d: Design) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const saved = useAsync(() => api.emailTemplates.list(), []);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ kind: "preset"; p: Preset } | { kind: "saved"; t: SavedTemplate } | null>(null);
  const previews = useMemo(() => PRESETS.map((p) => ({ p, d: p.build(brand) })), [brand]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.emailTemplates.create({ name: name.trim(), design: serializeDesign(design) });
      toast.success("Modèle enregistré", name.trim());
      setName("");
      await saved.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: SavedTemplate) {
    try {
      await api.emailTemplates.remove(t.id);
      await saved.reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PanelTitle title="Modèles" subtitle="Repartez d'une base, ou réutilisez vos propres designs." />
      <div className="space-y-6 px-5 pb-6">
        <div className="rounded-2xl bg-slate-900 p-4 text-white dark:bg-white/[0.06]">
          <p className="font-display text-sm font-bold uppercase">Enregistrer ce design</p>
          <p className="mt-1 text-xs text-white/60">Pour le réutiliser dans vos prochaines campagnes.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du modèle" className="h-9 text-xs" />
            <Button type="submit" variant="accent" size="sm" icon={Save} loading={saving} disabled={!name.trim()} aria-label="Enregistrer le modèle" />
          </form>
        </div>

        <div>
          <p className="eyebrow mb-2.5">Mes modèles</p>
          {saved.loading && !saved.data ? (
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/5" />
          ) : (saved.data ?? []).length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-white/[0.03]">Aucun modèle enregistré.</p>
          ) : (
            <div className="space-y-2">
              {(saved.data ?? []).map((t) => {
                const d = parseDesign(t.design);
                return (
                  <div key={t.id} className="group flex items-center gap-3 rounded-2xl p-1.5 ring-1 ring-slate-900/10 dark:ring-white/10">
                    <button type="button" disabled={disabled || !d} onClick={() => setPending({ kind: "saved", t })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="w-16 shrink-0 overflow-hidden rounded-xl">{d && <MiniPreview design={d} />}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-sm font-semibold text-slate-900 group-hover:text-brand-500 dark:text-white">{t.name}</span>
                        <span className="block text-[11px] text-slate-500">{formatDate(t.updated_at)}</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => void remove(t)} className="mr-1 rounded-full p-1.5 text-slate-400 hover:bg-red-500 hover:text-white" aria-label={`Supprimer ${t.name}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="eyebrow mb-2.5">Modèles Pingsell</p>
          <div className="grid grid-cols-2 gap-2">
            {previews.map(({ p, d }) => (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                onClick={() => setPending({ kind: "preset", p })}
                className="group overflow-hidden rounded-2xl text-left ring-1 ring-slate-900/10 transition hover:-translate-y-0.5 hover:ring-2 hover:ring-brand-500 dark:ring-white/10"
              >
                <MiniPreview design={d} />
                <span className="block px-2.5 py-2">
                  <span className="block font-display text-[13px] font-semibold text-slate-900 group-hover:text-brand-500 dark:text-white">{p.name}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{p.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind === "preset") onPreset(pending.p);
          if (pending?.kind === "saved") {
            const d = parseDesign(pending.t.design);
            if (d) onLoad(d);
          }
          setPending(null);
        }}
        title="Remplacer le contenu actuel ?"
        confirmLabel="Remplacer"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          L'email sera remplacé par « {pending?.kind === "preset" ? pending.p.name : pending?.t.name} ». Vous pourrez revenir en arrière avec ⌘Z.
        </p>
      </ConfirmModal>
    </>
  );
}

import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Heading,
  Image as ImageIcon,
  LayoutTemplate,
  Minus,
  Monitor,
  MousePointerClick,
  MoveVertical,
  Palette,
  PanelBottom,
  ShoppingBag,
  Smartphone,
  Stamp,
  Ticket,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../../lib/format";
import { renderMergeTags } from "../EmailPreview";
import { Button, Field, Input, Segmented, Select, Textarea } from "../ui/primitives";
import { Modal } from "../ui/Overlay";
import {
  BLOCK_LIBRARY,
  FONTS,
  PRESETS,
  THEME_SWATCHES,
  cloneBlock,
  createBlock,
  renderBlock,
  type Align,
  type Block,
  type BlockType,
  type Design,
  type Preset,
  type Theme,
} from "./model";

const ICONS: Record<BlockType, LucideIcon> = {
  logo: Stamp,
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  product: ShoppingBag,
  promo: Ticket,
  divider: Minus,
  spacer: MoveVertical,
  footer: PanelBottom,
};

const LABELS = Object.fromEntries(BLOCK_LIBRARY.map((b) => [b.type, b.label])) as Record<BlockType, string>;
const DND_NEW = "application/x-missive-new";
const DND_MOVE = "application/x-missive-move";

export function EmailBuilder({
  design,
  onChange,
  onApplyPreset,
  brand,
  disabled,
}: {
  design: Design;
  onChange: (design: Design) => void;
  onApplyPreset: (preset: Preset) => void;
  brand: string;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const selected = design.blocks.find((b) => b.id === selectedId) ?? null;
  const setBlocks = (blocks: Block[]) => onChange({ ...design, blocks });
  const setTheme = (patch: Partial<Theme>) => onChange({ ...design, theme: { ...design.theme, ...patch } });

  function insert(type: BlockType, at?: number) {
    const block = createBlock(type, brand);
    const blocks = [...design.blocks];
    const selIndex = selectedId ? blocks.findIndex((b) => b.id === selectedId) : -1;
    const index = at ?? (selIndex >= 0 ? selIndex + 1 : footerIndex(blocks));
    blocks.splice(index, 0, block);
    setBlocks(blocks);
    setSelectedId(block.id);
  }

  function move(index: number, to: number) {
    if (to < 0 || to > design.blocks.length) return;
    const blocks = [...design.blocks];
    const [b] = blocks.splice(index, 1);
    blocks.splice(to > index ? to - 1 : to, 0, b);
    setBlocks(blocks);
  }

  function update(id: string, patch: Partial<Block>) {
    setBlocks(design.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  }

  function remove(id: string) {
    setBlocks(design.blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicate(index: number) {
    const blocks = [...design.blocks];
    const copy = cloneBlock(blocks[index]);
    blocks.splice(index + 1, 0, copy);
    setBlocks(blocks);
    setSelectedId(copy.id);
  }

  // --- Drag & drop --------------------------------------------------------
  function onDragOverBlock(e: DragEvent, index: number) {
    if (disabled) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const target = dropIndex ?? design.blocks.length;
    const newType = e.dataTransfer.getData(DND_NEW) as BlockType;
    if (newType) insert(newType, target);
    else if (dragFrom.current != null) move(dragFrom.current, target);
    dragFrom.current = null;
    setDropIndex(null);
  }

  const canvasWidth = device === "desktop" ? 600 : 375;

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white/70 xl:grid-cols-[200px_minmax(0,1fr)_300px] dark:border-slate-800 dark:bg-slate-900/60">
      {/* Palette */}
      <aside className="border-b border-slate-200/80 p-4 xl:border-r xl:border-b-0 dark:border-slate-800">
        <p className="eyebrow mb-3">Blocs</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5 xl:grid-cols-1">
          {BLOCK_LIBRARY.map((b) => {
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
                onDragEnd={() => setDropIndex(null)}
                onClick={() => insert(b.type)}
                title={b.hint}
                className="group flex cursor-grab items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-slate-700 ring-1 ring-transparent transition hover:bg-slate-950 hover:text-paper active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-paper dark:hover:text-slate-950"
              >
                <Icon className="size-4 shrink-0 text-slate-400 group-hover:text-brand-500" strokeWidth={1.5} />
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="mt-5 border-t border-slate-200/80 pt-4 dark:border-slate-800">
          <Button variant="secondary" size="sm" icon={LayoutTemplate} className="w-full" disabled={disabled} onClick={() => setPresetsOpen(true)}>
            Modèles
          </Button>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={cx(
              "mt-2 flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition",
              !selected ? "text-brand-600 dark:text-brand-400" : "text-slate-500 hover:text-slate-950 dark:hover:text-white",
            )}
          >
            <Palette className="size-3.5" /> Style global
          </button>
        </div>
      </aside>

      {/* Canvas */}
      <section className="min-w-0 bg-slate-950/[0.03] dark:bg-black/20">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-2.5 dark:border-slate-800">
          <p className="eyebrow">Canevas · {design.blocks.length} blocs</p>
          <Segmented
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Ordi", icon: Monitor },
              { value: "mobile", label: "Mobile", icon: Smartphone },
            ]}
          />
        </div>
        <div
          className="max-h-[78vh] overflow-auto p-4 sm:p-8"
          style={{ background: design.theme.background }}
          onClick={() => setSelectedId(null)}
          onDragOver={(e) => {
            if (disabled) return;
            e.preventDefault();
            if (design.blocks.length === 0) setDropIndex(0);
          }}
          onDrop={onDrop}
        >
          <div
            className="mx-auto overflow-hidden shadow-[0_30px_80px_-30px_rgba(14,14,12,0.35)] transition-[width] duration-300"
            style={{ width: canvasWidth, maxWidth: "100%", background: design.theme.surface, borderRadius: 20 }}
          >
            {design.blocks.length === 0 && (
              <div className="px-8 py-20 text-center font-mono text-xs text-slate-400">Glissez un bloc ici, ou choisissez un modèle.</div>
            )}
            {design.blocks.map((block, index) => (
              <CanvasBlock
                key={block.id}
                block={block}
                theme={design.theme}
                selected={block.id === selectedId}
                disabled={disabled}
                dropBefore={dropIndex === index}
                dropAfter={dropIndex === index + 1 && index === design.blocks.length - 1}
                onSelect={() => setSelectedId(block.id)}
                onDragStart={() => {
                  dragFrom.current = index;
                }}
                onDragOver={(e) => onDragOverBlock(e, index)}
                onDragEnd={() => {
                  dragFrom.current = null;
                  setDropIndex(null);
                }}
                onUp={() => move(index, index - 1)}
                onDown={() => move(index, index + 2)}
                onDuplicate={() => duplicate(index)}
                onRemove={() => remove(block.id)}
                isFirst={index === 0}
                isLast={index === design.blocks.length - 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Inspector */}
      <aside className="border-t border-slate-200/80 xl:border-t-0 xl:border-l dark:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3 dark:border-slate-800">
          <p className="display text-[22px] leading-none text-slate-950 dark:text-white">{selected ? LABELS[selected.type] : "Style global"}</p>
          {selected && (
            <button type="button" onClick={() => setSelectedId(null)} className="rounded-full p-1 text-slate-400 hover:text-slate-950 dark:hover:text-white" aria-label="Désélectionner">
              <X className="size-4" />
            </button>
          )}
        </div>
        <fieldset disabled={disabled} className="max-h-[78vh] space-y-4 overflow-y-auto p-5">
          {selected ? <BlockInspector block={selected} onChange={(patch) => update(selected.id, patch)} /> : <ThemeInspector theme={design.theme} onChange={setTheme} />}
        </fieldset>
      </aside>

      <PresetsModal
        open={presetsOpen}
        brand={brand}
        onClose={() => setPresetsOpen(false)}
        onPick={(p) => {
          onApplyPreset(p);
          setSelectedId(null);
          setPresetsOpen(false);
        }}
      />
    </div>
  );
}

function footerIndex(blocks: Block[]): number {
  const i = blocks.findIndex((b) => b.type === "footer");
  return i === -1 ? blocks.length : i;
}

// --- Canvas block ---------------------------------------------------------------

function CanvasBlock(props: {
  block: Block;
  theme: Theme;
  selected: boolean;
  disabled?: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnd: () => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { block, theme, selected, disabled } = props;
  const html = useMemo(() => renderMergeTags(renderBlock(block, theme, true)), [block, theme]);

  return (
    <div
      className="group/block relative"
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MOVE, block.id);
        e.dataTransfer.effectAllowed = "move";
        props.onDragStart();
      }}
      onDragOver={props.onDragOver}
      onDragEnd={props.onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      {props.dropBefore && <DropLine position="top" />}
      <div
        className={cx(
          "pointer-events-none absolute inset-0 z-10 transition",
          selected ? "ring-2 ring-brand-500 ring-inset" : "ring-0 group-hover/block:ring-1 group-hover/block:ring-brand-500/50 group-hover/block:ring-inset",
        )}
      />
      {/* Block content (exact email markup) */}
      <div className="cursor-pointer [&_a]:pointer-events-none" dangerouslySetInnerHTML={{ __html: html }} />

      {!disabled && (
        <>
          <span
            className={cx(
              "absolute top-1/2 -left-0 z-20 -translate-y-1/2 cursor-grab rounded-r-md bg-brand-500 px-0.5 py-1.5 text-white transition-opacity active:cursor-grabbing",
              selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100",
            )}
            title="Glisser pour déplacer"
          >
            <GripVertical className="size-3.5" />
          </span>
          <div
            className={cx(
              "absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-full bg-ink p-1 text-paper shadow-lg transition-opacity",
              selected ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <span className="px-2 font-mono text-[10px] tracking-wider text-white/60 uppercase">{LABELS[block.type]}</span>
            <ToolBtn label="Monter" disabled={props.isFirst} onClick={props.onUp} icon={ArrowUp} />
            <ToolBtn label="Descendre" disabled={props.isLast} onClick={props.onDown} icon={ArrowDown} />
            <ToolBtn label="Dupliquer" onClick={props.onDuplicate} icon={Copy} />
            <ToolBtn label="Supprimer" onClick={props.onRemove} icon={Trash2} danger />
          </div>
        </>
      )}
      {props.dropAfter && <DropLine position="bottom" />}
    </div>
  );
}

function DropLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div className={cx("pointer-events-none absolute inset-x-3 z-30 flex items-center", position === "top" ? "-top-[3px]" : "-bottom-[3px]")}>
      <span className="size-2 rounded-full bg-brand-500" />
      <span className="h-[2px] flex-1 bg-brand-500" />
      <span className="size-2 rounded-full bg-brand-500" />
    </div>
  );
}

function ToolBtn({ label, icon: Icon, onClick, disabled, danger }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx("rounded-full p-1.5 transition disabled:opacity-30", danger ? "hover:bg-red-500" : "hover:bg-white/15")}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

// --- Inspectors ------------------------------------------------------------------

function AlignPicker({ value, onChange }: { value: Align; onChange: (v: Align) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: "left", label: "", icon: AlignLeft },
        { value: "center", label: "", icon: AlignCenter },
        { value: "right", label: "", icon: AlignRight },
      ]}
    />
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10.5px] leading-relaxed text-slate-400">{children}</p>;
}

function BlockInspector({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
  switch (block.type) {
    case "logo":
      return (
        <>
          <Field label="Nom de la marque">
            <Input value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <Field label="Image du logo (URL)" hint="Optionnel. PNG transparent conseillé, 40 px de haut.">
            <Input value={block.imageUrl} onChange={(e) => onChange({ imageUrl: e.target.value })} placeholder="https://…/logo.png" />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
          </Field>
        </>
      );
    case "heading":
      return (
        <>
          <Field label="Texte">
            <Textarea rows={3} value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <Field label="Taille">
            <Segmented
              value={block.size}
              onChange={(size) => onChange({ size })}
              options={[
                { value: "md", label: "M" },
                { value: "lg", label: "L" },
                { value: "xl", label: "XL" },
              ]}
            />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
          </Field>
        </>
      );
    case "text":
      return (
        <>
          <Field label="Texte">
            <Textarea rows={8} value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <Hint>
            **gras** · {"{{first_name|}}"} pour le prénom · retour à la ligne = nouvelle ligne
          </Hint>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
          </Field>
        </>
      );
    case "image":
      return (
        <>
          <Field label="URL de l'image">
            <Input value={block.src} onChange={(e) => onChange({ src: e.target.value })} placeholder="https://…/visuel.jpg" />
          </Field>
          <Field label="Texte alternatif">
            <Input value={block.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Décrivez l'image" />
          </Field>
          <Field label="Lien au clic (optionnel)">
            <Input value={block.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Hint>Largeur conseillée : 1040 px (affichée en 520 px pour les écrans Retina).</Hint>
        </>
      );
    case "button":
      return (
        <>
          <Field label="Libellé">
            <Input value={block.label} onChange={(e) => onChange({ label: e.target.value })} />
          </Field>
          <Field label="Lien">
            <Input value={block.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => onChange({ align })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={block.full} onChange={(e) => onChange({ full: e.target.checked })} className="size-4 accent-brand-500" />
            Pleine largeur
          </label>
        </>
      );
    case "product":
      return (
        <>
          <Field label="Nom du produit">
            <Input value={block.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix">
              <Input value={block.price} onChange={(e) => onChange({ price: e.target.value })} />
            </Field>
            <Field label="Prix barré">
              <Input value={block.oldPrice} onChange={(e) => onChange({ oldPrice: e.target.value })} placeholder="—" />
            </Field>
          </div>
          <Field label="Image (URL)">
            <Input value={block.imageUrl} onChange={(e) => onChange({ imageUrl: e.target.value })} placeholder="https://…/produit.jpg" />
          </Field>
          <Field label="Lien du produit">
            <Input value={block.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Texte du bouton">
            <Input value={block.cta} onChange={(e) => onChange({ cta: e.target.value })} />
          </Field>
        </>
      );
    case "promo":
      return (
        <>
          <Field label="Code">
            <Input value={block.code} onChange={(e) => onChange({ code: e.target.value.toUpperCase() })} className="font-mono tracking-widest" />
          </Field>
          <Field label="Description">
            <Input value={block.caption} onChange={(e) => onChange({ caption: e.target.value })} />
          </Field>
        </>
      );
    case "divider":
      return <Hint>Une ligne fine pour séparer deux sections.</Hint>;
    case "spacer":
      return (
        <Field label={`Hauteur — ${block.height} px`}>
          <input
            type="range"
            min={8}
            max={120}
            step={4}
            value={block.height}
            onChange={(e) => onChange({ height: Number(e.target.value) })}
            className="w-full accent-brand-500"
          />
        </Field>
      );
    case "footer":
      return (
        <>
          <Field label="Mentions">
            <Textarea rows={4} value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <Hint>Le lien « Se désinscrire » est ajouté automatiquement (obligatoire).</Hint>
        </>
      );
  }
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-slate-300 dark:ring-slate-700" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs uppercase" />
      </div>
    </Field>
  );
}

function ThemeInspector({ theme, onChange }: { theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  return (
    <>
      <div>
        <p className="eyebrow mb-2">Ambiances</p>
        <div className="grid grid-cols-5 gap-2">
          {THEME_SWATCHES.map((s) => (
            <button
              key={s.name}
              type="button"
              title={s.name}
              onClick={() => onChange(s.theme)}
              className="group flex flex-col items-center gap-1.5"
            >
              <span
                className={cx(
                  "relative size-10 overflow-hidden rounded-full ring-1 transition group-hover:scale-110",
                  theme.accent === s.theme.accent && theme.background === s.theme.background ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-paper dark:ring-offset-slate-900" : "ring-slate-300 dark:ring-slate-700",
                )}
                style={{ background: s.theme.background }}
              >
                <span className="absolute right-0 bottom-0 size-5 rounded-tl-full" style={{ background: s.theme.accent }} />
              </span>
              <span className="font-mono text-[9.5px] text-slate-500">{s.name}</span>
            </button>
          ))}
        </div>
      </div>
      <ColorField label="Fond" value={theme.background} onChange={(background) => onChange({ background })} />
      <ColorField label="Carte" value={theme.surface} onChange={(surface) => onChange({ surface })} />
      <ColorField label="Texte" value={theme.text} onChange={(text) => onChange({ text })} />
      <ColorField label="Accent (boutons)" value={theme.accent} onChange={(accent) => onChange({ accent })} />
      <ColorField label="Texte des boutons" value={theme.accentText} onChange={(accentText) => onChange({ accentText })} />
      <Field label="Typographie des titres">
        <Select value={theme.font} onChange={(e) => onChange({ font: e.target.value as Theme["font"] })}>
          {Object.entries(FONTS).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Forme des boutons">
        <Segmented
          value={String(theme.radius >= 999 ? 999 : theme.radius >= 10 ? 12 : 2)}
          onChange={(v) => onChange({ radius: Number(v) })}
          options={[
            { value: "2", label: "Carré" },
            { value: "12", label: "Arrondi" },
            { value: "999", label: "Pilule" },
          ]}
        />
      </Field>
    </>
  );
}

// --- Presets modal -------------------------------------------------------------

function PresetsModal({ open, onClose, onPick, brand }: { open: boolean; onClose: () => void; onPick: (p: Preset) => void; brand: string }) {
  const previews = useMemo(() => (open ? PRESETS.map((p) => ({ p, d: p.build(brand) })) : []), [open, brand]);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Choisir un modèle" description="Le contenu actuel sera remplacé.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {previews.map(({ p, d }) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(p)}
            className="group overflow-hidden rounded-2xl text-left ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-2 hover:ring-brand-500 dark:ring-slate-800"
          >
            <div className="flex h-28 flex-col justify-end gap-1.5 p-3" style={{ background: d.theme.background }}>
              <span className="h-1.5 w-10 rounded-full" style={{ background: d.theme.text, opacity: 0.8 }} />
              <span className="h-1 w-16 rounded-full" style={{ background: d.theme.text, opacity: 0.3 }} />
              <span className="h-1 w-12 rounded-full" style={{ background: d.theme.text, opacity: 0.3 }} />
              <span className="mt-1 h-3.5 w-14 rounded-full" style={{ background: d.theme.accent }} />
            </div>
            <div className="p-3">
              <p className="display text-xl leading-none text-slate-950 group-hover:text-brand-500 dark:text-white">{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">{p.description}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

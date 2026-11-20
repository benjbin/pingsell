import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  Check,
  Code2,
  Copy,
  Eye,
  FlaskConical,
  GripVertical,
  Images,
  Italic,
  Keyboard,
  LayoutTemplate,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  Monitor,
  Palette,
  Baseline,
  Highlighter,
  BadgeCheck,
  Sparkles,
  Plus,
  Redo2,
  RemoveFormatting,
  Save,
  Smartphone,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../../lib/format";
import type { Asset } from "../../lib/types";
import { Button, Segmented } from "../ui/primitives";
import { Modal } from "../ui/Overlay";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useToast } from "../ui/Toast";
import { BlockInspector, ThemeInspector } from "./inspector";
import { DND_ASSET, useUploader } from "./media";
import {
  BLOCK_LIBRARY,
  MERGE_TAGS,
  applyBrandKit,
  brandBlock,
  googleFontsHref,
  fontFaceCss,
  parseBrandKit,
  usedWebFonts,
  type BrandKit,
  cloneBlock,
  createBlock,
  extractPlain,
  isRichPath,
  renderBlock,
  sanitizeRich,
  setPath,
  type Block,
  type BlockType,
  type Design,
  type Preset,
  type Theme,
} from "./model";
import { BlocksPanel, DND_MOVE, DND_NEW, ICONS, LABELS, LayersPanel, MediaPanel, TemplatesPanel } from "./panels";

type Tab = "blocks" | "layers" | "media" | "templates";
type Device = "desktop" | "mobile";

const TABS: Array<{ key: Tab; label: string; icon: LucideIcon }> = [
  { key: "blocks", label: t("Blocs", "Blocks"), icon: Plus },
  { key: "layers", label: t("Calques", "Layers"), icon: Layers },
  { key: "media", label: t("Médias", "Media"), icon: Images },
  { key: "templates", label: t("Modèles", "Templates"), icon: LayoutTemplate },
];

export interface EmailBuilderProps {
  design: Design;
  onChange: (design: Design) => void;
  onApplyPreset: (preset: Preset) => void;
  brand: string;
  disabled?: boolean;
  /** Envelope (inbox) fields, edited above the canvas. */
  subject: string;
  preheader: string;
  fromName: string;
  onSubjectChange: (v: string) => void;
  onPreheaderChange: (v: string) => void;
  /** Workspace chrome. */
  title: string;
  saving?: boolean;
  dirty?: boolean;
  onClose: () => void;
  onSave: () => void;
  /** Absent : pas de bouton « Tester ». */
  onTest?: () => void;
  onPreview: () => void;
  /** Absent : pas de bouton « Code HTML » (passer tout l'email en code). */
  onCodeMode?: () => void;
  /** Libellé du bouton d'enregistrement (ex. « Terminé » quand l'email fait partie d'une automatisation). */
  saveLabel?: string;
}

/** Image slot of a block, if it has one (used when picking from the media library). */
function imageKey(block: Block): string | null {
  switch (block.type) {
    case "image":
      return "src";
    case "logo":
    case "product":
    case "hero":
    case "imageText":
      return "imageUrl";
    case "review":
    case "signature":
      return "avatarUrl";
    case "video":
      return "thumbnail";
    default:
      return null;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

// --- History -----------------------------------------------------------------------------

function useHistory(design: Design, onChange: (d: Design) => void) {
  const past = useRef<Design[]>([]);
  const future = useRef<Design[]>([]);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const [, bump] = useState(0);
  const current = useRef(design);
  current.current = design;

  const commit = useCallback(
    (next: Design, key?: string) => {
      const now = Date.now();
      // Coalesce rapid edits of the same control (typing, sliders) into one undo step.
      if (!(key && last.current.key === key && now - last.current.at < 900)) {
        past.current.push(current.current);
        if (past.current.length > 100) past.current.shift();
      }
      last.current = { key, at: now };
      future.current = [];
      onChange(next);
      bump((n) => n + 1);
    },
    [onChange],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    last.current = { at: 0 };
    onChange(prev);
    bump((n) => n + 1);
  }, [onChange]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    last.current = { at: 0 };
    onChange(next);
    bump((n) => n + 1);
  }, [onChange]);

  return { commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

// --- Workspace ---------------------------------------------------------------------------

export function EmailBuilder(props: EmailBuilderProps) {
  const { design, brand, disabled } = props;
  const { commit, undo, redo, canUndo, canRedo } = useHistory(design, props.onChange);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>("blocks");
  const [device, setDevice] = useState<Device>("desktop");
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [kitSaving, setKitSaving] = useState(false);
  const toast = useToast();
  const dragFrom = useRef<number | null>(null);
  const designRef = useRef(design);
  designRef.current = design;

  const selected = design.blocks.find((b) => b.id === selectedId) ?? null;
  const setBlocks = (blocks: Block[], key?: string) => commit({ ...designRef.current, blocks }, key);
  const setTheme = (patch: Partial<Theme>) => commit({ ...designRef.current, theme: { ...designRef.current.theme, ...patch } }, `theme:${Object.keys(patch).join(",")}`);

  useEffect(() => {
    api.brandKit
      .get()
      .then((raw) => setKit(parseBrandKit(raw)))
      .catch(() => undefined);
  }, []);

  // Load the web fonts used by the design so the canvas matches the email.
  // Every merchant font is loaded too, so the font pickers can preview them.
  const fontsHref = googleFontsHref([...new Set([...usedWebFonts(design), ...(design.theme.customFonts ?? []).map((f) => f.google).filter((g): g is string => !!g)])]);
  const faces = fontFaceCss(design.theme);
  useEffect(() => {
    let el = document.getElementById("email-font-faces") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "email-font-faces";
      document.head.appendChild(el);
    }
    el.textContent = faces;
  }, [faces]);
  useEffect(() => {
    if (!fontsHref) return;
    let link = document.querySelector<HTMLLinkElement>(`link[data-email-fonts="${CSS.escape(fontsHref)}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontsHref;
      link.dataset.emailFonts = fontsHref;
      document.head.appendChild(link);
    }
  }, [fontsHref]);

  async function saveBrandKit() {
    const d = designRef.current;
    const logo = d.blocks.find((b) => b.type === "logo");
    const footer = d.blocks.find((b) => b.type === "footer");
    const social = d.blocks.find((b) => b.type === "social");
    const next: BrandKit = {
      theme: d.theme,
      logoUrl: logo?.type === "logo" && logo.imageUrl ? logo.imageUrl : kit?.logoUrl,
      logoHeight: logo?.type === "logo" ? logo.height : kit?.logoHeight,
      footerText: footer?.type === "footer" ? footer.text : kit?.footerText,
      socials: social?.type === "social" ? social.links : kit?.socials,
    };
    setKitSaving(true);
    try {
      await api.brandKit.save(JSON.stringify(next));
      setKit(next);
      toast.success(t("Style de marque enregistré", "Brand style saved"), t("Il s'appliquera à vos prochains emails.", "It will apply to your next emails."));
    } catch (err) {
      toast.error(err);
    } finally {
      setKitSaving(false);
    }
  }

  // Lock page scroll behind the full-screen workspace.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function insert(type: BlockType, at?: number, patch?: Partial<Block>) {
    const block = { ...createBlock(type, brand, kit), ...patch } as Block;
    const blocks = [...designRef.current.blocks];
    const selIndex = selectedId ? blocks.findIndex((b) => b.id === selectedId) : -1;
    const footer = blocks.findIndex((b) => b.type === "footer");
    const index = at ?? (selIndex >= 0 ? selIndex + 1 : footer === -1 ? blocks.length : footer);
    blocks.splice(index, 0, block);
    setBlocks(blocks);
    setSelectedId(block.id);
    requestAnimationFrame(() => document.querySelector(`[data-block="${block.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function move(index: number, to: number) {
    const blocks = [...designRef.current.blocks];
    if (to < 0 || to > blocks.length) return;
    const [b] = blocks.splice(index, 1);
    blocks.splice(to > index ? to - 1 : to, 0, b);
    setBlocks(blocks);
  }

  function update(id: string, patch: Partial<Block>, key?: string) {
    setBlocks(
      designRef.current.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
      key,
    );
  }

  function replaceBlock(id: string, next: Block) {
    setBlocks(designRef.current.blocks.map((b) => (b.id === id ? next : b)));
  }

  function remove(id: string) {
    const blocks = designRef.current.blocks;
    const i = blocks.findIndex((b) => b.id === id);
    setBlocks(blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null);
  }

  function duplicate(id: string) {
    const blocks = [...designRef.current.blocks];
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    const copy = cloneBlock(blocks[i]);
    blocks.splice(i + 1, 0, copy);
    setBlocks(blocks);
    setSelectedId(copy.id);
  }

  function pickAsset(asset: Asset) {
    const key = selected ? imageKey(selected) : null;
    if (selected && key) update(selected.id, { [key]: asset.url } as Partial<Block>);
    else insert("image", undefined, { src: asset.url, alt: asset.filename.replace(/\.[a-z]+$/i, "") } as Partial<Block>);
  }

  // --- Inline editing: commit an edited field back into the design ---------------------
  const commitField = (blockId: string, el: HTMLElement) => {
      const path = el.dataset.edit;
      const block = designRef.current.blocks.find((b) => b.id === blockId);
      if (!path || !block) return;
      const value = isRichPath(block, path) ? sanitizeRich(el.innerHTML) : extractPlain(el);
      const current = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], block);
      if (value === current) return;
      replaceBlock(blockId, setPath(block, path, value));
  };

  // --- Keyboard shortcuts ---------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(e.target);
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        setTimeout(() => props.onSave(), 0);
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "?" ) {
        setShortcutsOpen(true);
        return;
      }
      if (disabled || !selectedId) {
        if (e.key === "Escape") setSelectedId(null);
        return;
      }
      const blocks = designRef.current.blocks;
      const i = blocks.findIndex((b) => b.id === selectedId);
      if (e.key === "Escape") setSelectedId(null);
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(selectedId);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate(selectedId);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (e.altKey) move(i, dir < 0 ? i - 1 : i + 2);
        else setSelectedId(blocks[Math.max(0, Math.min(blocks.length - 1, i + dir))]?.id ?? selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Drag & drop onto the canvas ------------------------------------------------------
  const { upload, busy: uploading } = useUploader((a) => {
    insert("image", dropRef.current ?? undefined, { src: a.url, alt: a.filename.replace(/\.[a-z]+$/i, "") } as Partial<Block>);
  });
  const dropRef = useRef<number | null>(null);

  function onDragOverBlock(e: DragEvent, index: number) {
    if (disabled) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (disabled) return;
    const target = dropIndex ?? designRef.current.blocks.length;
    const newType = e.dataTransfer.getData(DND_NEW) as BlockType;
    const asset = e.dataTransfer.getData(DND_ASSET);
    if (newType) insert(newType, target);
    else if (asset) insert("image", target, { src: asset } as Partial<Block>);
    else if (dragFrom.current != null) move(dragFrom.current, target);
    else if (e.dataTransfer.files.length) {
      dropRef.current = target;
      void upload(e.dataTransfer.files);
    }
    dragFrom.current = null;
    setDropIndex(null);
  }

  const canvasWidth = device === "desktop" ? design.theme.width : 375;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-900/10 bg-white px-3 sm:px-4 dark:border-white/10 dark:bg-slate-900">
        <button
          type="button"
          onClick={props.onClose}
          className="flex size-10 items-center justify-center rounded-full ring-1 ring-slate-900/15 transition hover:bg-slate-900 hover:text-white dark:ring-white/15 dark:hover:bg-white dark:hover:text-slate-900"
          aria-label={t("Fermer l'éditeur", "Close editor")}
          title={t("Fermer l'éditeur", "Close editor")}
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] leading-tight font-extrabold tracking-[-0.01em] text-slate-900 uppercase dark:text-white">{props.title}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            {props.saving ? (
              <>
                <Loader2 className="size-3 animate-spin" /> {t("Enregistrement…", "Saving…")}
              </>
            ) : props.dirty ? (
              <>
                <span className="size-1.5 rounded-full bg-amber-500" /> {t("Modifications non enregistrées", "Unsaved changes")}
              </>
            ) : (
              <>
                <Check className="size-3 text-emerald-500" /> {t("Tout est enregistré", "All changes saved")}
              </>
            )}
          </p>
        </div>

        <div className="mx-auto hidden items-center gap-2 md:flex">
          <div className="flex items-center rounded-full bg-slate-100 p-1 dark:bg-white/5">
            <IconBtn icon={Undo2} label={t("Annuler (⌘Z)", "Undo (⌘Z)")} onClick={undo} disabled={!canUndo || disabled} />
            <IconBtn icon={Redo2} label={t("Rétablir (⇧⌘Z)", "Redo (⇧⌘Z)")} onClick={redo} disabled={!canRedo || disabled} />
          </div>
          <Segmented
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: t("Ordinateur", "Desktop"), icon: Monitor },
              { value: "mobile", label: "Mobile", icon: Smartphone },
            ]}
          />
          <IconBtn icon={Keyboard} label={t("Raccourcis clavier (?)", "Keyboard shortcuts (?)")} onClick={() => setShortcutsOpen(true)} />
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {props.onCodeMode && !disabled && (
            <Button variant="ghost" size="sm" icon={Code2} onClick={props.onCodeMode} className="hidden sm:inline-flex" title={t("Écrire ou coller tout l'email en code HTML", "Write or paste the whole email as HTML code")}>
              {t("Code HTML", "HTML code")}
            </Button>
          )}
          <Button variant="secondary" size="sm" icon={Eye} onClick={props.onPreview} className="hidden sm:inline-flex">
            {t("Aperçu", "Preview")}
          </Button>
          {!disabled && (
            <>
              {props.onTest && (
                <Button variant="secondary" size="sm" icon={FlaskConical} onClick={props.onTest} className="hidden sm:inline-flex">
                  {t("Tester", "Test")}
                </Button>
              )}
              <Button size="sm" icon={Save} onClick={props.onSave} loading={props.saving}>
                {props.saveLabel ?? t("Enregistrer", "Save")}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Rail */}
        <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 bg-slate-900 py-3">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab((cur) => (cur === tb.key ? null : tb.key))}
              className={cx(
                "flex w-[62px] flex-col items-center gap-1 rounded-2xl py-2.5 font-display text-[10.5px] font-semibold transition",
                tab === tb.key ? "bg-brand-500 text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <tb.icon className="size-[18px]" strokeWidth={1.75} />
              {tb.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={cx(
              "flex w-[62px] flex-col items-center gap-1 rounded-2xl py-2.5 font-display text-[10.5px] font-semibold transition",
              !selected ? "text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
            )}
            title={t("Style global de l'email", "Global email style")}
          >
            <Palette className="size-[18px]" strokeWidth={1.75} />
            Style
          </button>
        </nav>

        {/* Side panel */}
        {tab && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-slate-900/10 bg-white max-lg:absolute max-lg:inset-y-16 max-lg:left-[76px] max-lg:z-30 max-lg:shadow-2xl dark:border-white/10 dark:bg-slate-900">
            {tab === "blocks" && <BlocksPanel onInsert={(type) => insert(type)} disabled={disabled} />}
            {tab === "layers" && (
              <LayersPanel blocks={design.blocks} selectedId={selectedId} onSelect={setSelectedId} onMove={move} onRemove={remove} disabled={disabled} />
            )}
            {tab === "media" && <MediaPanel onPick={pickAsset} />}
            {tab === "templates" && (
              <TemplatesPanel
                brand={brand}
                design={design}
                disabled={disabled}
                onPreset={(p) => {
                  // Push current state so the preset can be undone.
                  const built = p.build(brand);
                  commit({ ...built, blocks: built.blocks.map((b) => brandBlock(b, kit)) });
                  props.onApplyPreset(p);
                  setSelectedId(null);
                }}
                onLoad={(d) => {
                  commit(d);
                  setSelectedId(null);
                }}
              />
            )}
          </aside>
        )}

        {/* Canvas */}
        <main
          className="relative min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle,rgba(11,33,74,0.09)_1px,transparent_1px)] [background-size:18px_18px] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)]"
          onClick={() => {
            setSelectedId(null);
            setInsertAt(null);
          }}
          onDragOver={(e) => {
            if (disabled) return;
            e.preventDefault();
            if (designRef.current.blocks.length === 0) setDropIndex(0);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropIndex(null);
          }}
          onDrop={onDrop}
        >
          <div className="mx-auto px-4 py-8 sm:px-10" style={{ width: canvasWidth + 80, maxWidth: "100%" }}>
            <Envelope {...props} width={canvasWidth} />

            <div
              className="rounded-[28px] px-3 shadow-[0_30px_80px_-40px_rgba(11,33,74,0.45)] transition-[width] duration-300"
              style={{ background: design.theme.background, paddingTop: Math.max(12, design.theme.outerPad), paddingBottom: Math.max(12, design.theme.outerPad) }}
            >
              <div
                className={cx("relative mx-auto overflow-hidden transition-[width] duration-300", device === "mobile" && "canvas-mobile")}
                style={{
                  width: canvasWidth,
                  maxWidth: "100%",
                  background: design.theme.surface,
                  borderRadius: device === "mobile" ? 0 : design.theme.cardRadius,
                  border: design.theme.borderWidth ? `${design.theme.borderWidth}px solid ${design.theme.borderColor}` : undefined,
                }}
              >
                {design.blocks.length === 0 && (
                  <div className={cx("px-8 py-24 text-center text-sm", dropIndex === 0 ? "text-brand-500" : "text-slate-400")}>
                    {t("Glissez un bloc ou une image ici, ou choisissez un modèle.", "Drag a block or image here, or pick a template.")}
                  </div>
                )}
                {design.blocks.map((block, index) => (
                  <CanvasBlock
                    key={block.id}
                    block={block}
                    theme={design.theme}
                    device={device}
                    selected={block.id === selectedId}
                    disabled={disabled}
                    dropBefore={dropIndex === index}
                    dropAfter={dropIndex === index + 1 && index === design.blocks.length - 1}
                    onSelect={() => {
                      setSelectedId(block.id);
                      setInsertAt(null);
                    }}
                    onCommit={(el) => commitField(block.id, el)}
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
                    onDuplicate={() => duplicate(block.id)}
                    onRemove={() => remove(block.id)}
                    onInsertBelow={() => setInsertAt(insertAt === index + 1 ? null : index + 1)}
                    insertMenu={
                      insertAt === index + 1 ? (
                        <QuickInsert
                          onPick={(type) => {
                            insert(type, index + 1);
                            setInsertAt(null);
                          }}
                        />
                      ) : null
                    }
                    isFirst={index === 0}
                    isLast={index === design.blocks.length - 1}
                  />
                ))}
              </div>
            </div>
            {uploading && (
              <p className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> {t("Import de l'image…", "Uploading image…")}
              </p>
            )}
          </div>
        </main>

        {/* Inspector */}
        <aside className="hidden w-[330px] shrink-0 flex-col border-l border-slate-900/10 bg-white lg:flex dark:border-white/10 dark:bg-slate-900">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-900/[0.07] px-5 dark:border-white/[0.07]">
            {selected ? (
              <>
                <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-white">
                  {(() => {
                    const Icon = ICONS[selected.type];
                    return <Icon className="size-4" strokeWidth={1.75} />;
                  })()}
                </span>
                <p className="flex-1 font-display text-sm font-extrabold tracking-tight text-slate-900 uppercase dark:text-white">{LABELS[selected.type]}</p>
                {!disabled && (
                  <>
                    <IconBtn icon={Copy} label={t("Dupliquer (⌘D)", "Duplicate (⌘D)")} onClick={() => duplicate(selected.id)} />
                    <IconBtn icon={Trash2} label={t("Supprimer (Suppr)", "Delete (Del)")} onClick={() => remove(selected.id)} danger />
                  </>
                )}
                <IconBtn icon={X} label={t("Désélectionner (Échap)", "Deselect (Esc)")} onClick={() => setSelectedId(null)} />
              </>
            ) : (
              <>
                <span className="flex size-8 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                  <Palette className="size-4" strokeWidth={1.75} />
                </span>
                <p className="font-display text-sm font-extrabold tracking-tight text-slate-900 uppercase dark:text-white">{t("Style global", "Global style")}</p>
              </>
            )}
          </div>
          <fieldset disabled={disabled} className="min-h-0 flex-1 overflow-y-auto">
            {selected ? (
              <BlockInspector key={selected.id} block={selected} theme={design.theme} onChange={(patch) => update(selected.id, patch, `${selected.id}:${Object.keys(patch).join(",")}`)} />
            ) : (
              <ThemeInspector
                theme={design.theme}
                onChange={setTheme}
                brandActions={
                  <div className="space-y-2 border-b border-slate-900/[0.07] px-5 py-4 dark:border-white/[0.07]">
                    <div className="flex items-start gap-2.5">
                      <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-500" />
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-900 dark:text-white">{t("Style de marque.", "Brand style.")}</span>{" "}
                        {kit
                          ? t(
                              "Vos couleurs, polices, logo et pied de page sont appliqués aux nouveaux emails.",
                              "Your colors, fonts, logo and footer are applied to new emails.",
                            )
                          : t(
                              "Enregistrez ce style (couleurs, polices, logo, réseaux, pied de page) pour le retrouver dans chaque nouvel email.",
                              "Save this style (colors, fonts, logo, socials, footer) to reuse it in every new email.",
                            )}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" icon={BadgeCheck} loading={kitSaving} onClick={() => void saveBrandKit()} className="flex-1">
                        {kit ? t("Mettre à jour", "Update") : t("Enregistrer", "Save")}
                      </Button>
                      {kit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Sparkles}
                          onClick={() => {
                            commit(applyBrandKit(designRef.current, kit));
                            toast.success(t("Style de marque appliqué", "Brand style applied"));
                          }}
                          className="flex-1"
                        >
                          {t("Appliquer", "Apply")}
                        </Button>
                      )}
                    </div>
                  </div>
                }
              />
            )}
          </fieldset>
        </aside>
      </div>

      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} size="sm" title={t("Raccourcis clavier", "Keyboard shortcuts")}>
        <dl className="divide-y divide-slate-900/[0.07] text-sm dark:divide-white/10">
          {[
            ["⌘ S", t("Enregistrer", "Save")],
            ["⌘ Z  /  ⇧ ⌘ Z", t("Annuler / rétablir", "Undo / redo")],
            ["↑  ↓", t("Bloc précédent / suivant", "Previous / next block")],
            ["⌥ ↑  /  ⌥ ↓", t("Monter / descendre le bloc", "Move block up / down")],
            ["⌘ D", t("Dupliquer le bloc", "Duplicate block")],
            [t("Suppr", "Del"), t("Supprimer le bloc", "Delete block")],
            [t("Échap", "Esc"), t("Désélectionner", "Deselect")],
            ["⌘ B  /  ⌘ I  /  ⌘ U", t("Gras / italique / souligné (dans un texte)", "Bold / italic / underline (in text)")],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2.5">
              <dt className="text-slate-600 dark:text-slate-300">{v}</dt>
              <dd>
                <kbd className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-900 dark:bg-white/10 dark:text-white">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}

// --- Envelope (from / subject / preheader) ------------------------------------------------

function Envelope(props: EmailBuilderProps & { width: number }) {
  const len = props.subject.length;
  return (
    <div className="mb-5 rounded-[20px] bg-white ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">
      <div className="flex items-center gap-3 border-b border-slate-900/[0.07] px-4 py-3 dark:border-white/[0.07]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 font-display text-sm font-extrabold text-white dark:bg-white dark:text-slate-900">
          {(props.fromName || props.brand || "M").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{props.fromName || props.brand}</p>
          <p className="text-[11px] text-slate-500">{t("Aperçu dans la boîte de réception", "Inbox preview")}</p>
        </div>
      </div>
      <label className="flex items-center gap-3 border-b border-slate-900/[0.07] px-4 py-2.5 dark:border-white/[0.07]">
        <span className="w-24 shrink-0 font-display text-[11px] font-bold tracking-wider text-slate-500 uppercase">{t("Objet", "Subject")}</span>
        <input
          value={props.subject}
          onChange={(e) => props.onSubjectChange(e.target.value)}
          disabled={props.disabled}
          placeholder={t("L'objet de votre email *", "Your email subject *")}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-white"
        />
        <span className={cx("shrink-0 font-mono text-[11px] tabular-nums", len > 60 ? "text-amber-600" : "text-slate-400")} title={t("Moins de 50 caractères pour un objet lisible sur mobile", "Under 50 characters keeps the subject readable on mobile")}>
          {len}
        </span>
        <MergeTagMenu onPick={(tag) => props.onSubjectChange(`${props.subject}${props.subject && !props.subject.endsWith(" ") ? " " : ""}${tag}`)} disabled={props.disabled} />
      </label>
      <label className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-24 shrink-0 font-display text-[11px] font-bold tracking-wider text-slate-500 uppercase">{t("Pré-en-tête", "Preheader")}</span>
        <input
          value={props.preheader}
          onChange={(e) => props.onPreheaderChange(e.target.value)}
          disabled={props.disabled}
          placeholder={t("Texte affiché après l'objet", "Text shown after the subject")}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400 dark:text-slate-300"
        />
      </label>
    </div>
  );
}

function MergeTagMenu({ onPick, disabled }: { onPick: (tag: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close when clicking anywhere else or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1 rounded-full px-2 py-1 font-display text-[11px] font-semibold text-brand-500 ring-1 ring-brand-500/30 hover:bg-brand-50 dark:hover:bg-brand-900/30"
        title={t("Insérer une variable de personnalisation", "Insert a personalization variable")}
      >
        <UserRound className="size-3" /> {t("Variable", "Variable")}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-1 w-44 rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
          {MERGE_TAGS.map((m) => (
            <button
              key={m.tag}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                onPick(m.tag);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
            >
              {m.label}
              <code className="text-[10px] text-slate-400">{m.tag.replace("|}}", "}}")}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Canvas block ------------------------------------------------------------------------

function CanvasBlock(props: {
  block: Block;
  theme: Theme;
  device: Device;
  selected: boolean;
  disabled?: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  isFirst: boolean;
  isLast: boolean;
  insertMenu: ReactNode;
  onSelect: () => void;
  onCommit: (el: HTMLElement) => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnd: () => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onInsertBelow: () => void;
}) {
  const { block, theme, selected, disabled, device } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [richFocus, setRichFocus] = useState(false);
  const html = useMemo(() => renderBlock(block, theme, { canvas: true, editable: !disabled }), [block, theme, disabled]);
  const hidden = (device === "mobile" && block.style?.hideMobile) || (device === "desktop" && block.style?.hideDesktop);

  // Delegated listeners for the editable fields rendered inside the block HTML.
  useEffect(() => {
    const root = ref.current;
    if (!root || disabled) return;
    const fieldOf = (target: EventTarget | null) => (target instanceof HTMLElement ? target.closest<HTMLElement>("[data-edit]") : null);
    const onFocusIn = (e: FocusEvent) => {
      const el = fieldOf(e.target);
      if (el) setRichFocus(el.dataset.rich === "1");
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = fieldOf(e.target);
      if (!el) return;
      // Keep the DOM (and the selection) intact while the user works in the toolbar.
      if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest("[data-rt-toolbar]")) return;
      setRichFocus(false);
      props.onCommit(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = fieldOf(e.target);
      if (!el) return;
      if (e.key === "Escape") {
        el.blur();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (el.dataset.rich === "1") document.execCommand("insertLineBreak");
        else el.blur();
      }
      if ((e.metaKey || e.ctrlKey) && el.dataset.rich !== "1" && ["b", "i", "u"].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!fieldOf(e.target)) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, text);
    };
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("paste", onPaste);
    };
  }, [disabled, props.onCommit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-block={block.id}
      className={cx("group/block relative", hidden && "opacity-35")}
      onDragOver={props.onDragOver}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
      onClickCapture={(e) => {
        // Never follow links inside the canvas.
        if ((e.target as HTMLElement).closest("a")) e.preventDefault();
      }}
    >
      {props.dropBefore && <DropLine position="top" />}
      <div
        className={cx(
          "pointer-events-none absolute inset-0 z-10 transition",
          selected ? "ring-2 ring-brand-500 ring-inset" : "ring-0 group-hover/block:ring-1 group-hover/block:ring-brand-500/60 group-hover/block:ring-inset",
        )}
      />
      {hidden && (
        <span className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
          {device === "mobile" ? t("Masqué sur mobile", "Hidden on mobile") : t("Masqué sur ordinateur", "Hidden on desktop")}
        </span>
      )}

      {/* Exact email markup, with editable fields */}
      <div ref={ref} className="cursor-default [&_[data-edit]]:cursor-text [&_[data-edit]:focus]:bg-brand-500/[0.06]" dangerouslySetInnerHTML={{ __html: html }} />

      {selected && richFocus && !disabled && <RichToolbar root={ref} theme={theme} onCommitted={(el) => props.onCommit(el)} />}

      {!disabled && (
        <>
          {/* Type label + drag handle */}
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MOVE, block.id);
              e.dataTransfer.effectAllowed = "move";
              const host = (e.currentTarget as HTMLElement).parentElement;
              if (host) e.dataTransfer.setDragImage(host, 20, 20);
              props.onDragStart();
            }}
            onDragEnd={props.onDragEnd}
            className={cx(
              "absolute top-0 left-0 z-20 flex cursor-grab items-center gap-1 rounded-br-xl bg-brand-500 py-1 pr-2.5 pl-1.5 font-display text-[10.5px] font-semibold text-white transition-opacity active:cursor-grabbing",
              selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100",
              richFocus && "hidden",
            )}
            title={t("Glisser pour déplacer", "Drag to move")}
          >
            <GripVertical className="size-3" /> {LABELS[block.type]}
          </span>
          <div
            className={cx(
              "absolute top-1.5 right-1.5 z-20 flex items-center gap-0.5 rounded-full bg-slate-900 p-1 text-white shadow-lg transition-opacity",
              selected && !richFocus ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <ToolBtn label={t("Monter (⌥↑)", "Move up (⌥↑)")} disabled={props.isFirst} onClick={props.onUp} icon={ArrowUp} />
            <ToolBtn label={t("Descendre (⌥↓)", "Move down (⌥↓)")} disabled={props.isLast} onClick={props.onDown} icon={ArrowDown} />
            <ToolBtn label={t("Dupliquer (⌘D)", "Duplicate (⌘D)")} onClick={props.onDuplicate} icon={Copy} />
            <ToolBtn label={t("Supprimer", "Delete")} onClick={props.onRemove} icon={Trash2} danger />
          </div>
          {/* Insert between blocks */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onInsertBelow();
            }}
            className={cx(
              "absolute -bottom-3.5 left-1/2 z-30 flex size-7 -translate-x-1/2 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg ring-4 ring-white transition hover:scale-110",
              props.insertMenu ? "opacity-100" : "opacity-0 group-hover/block:opacity-100",
            )}
            aria-label={t("Insérer un bloc ici", "Insert a block here")}
            title={t("Insérer un bloc ici", "Insert a block here")}
          >
            <Plus className={cx("size-4 transition", !!props.insertMenu && "rotate-45")} />
          </button>
          {props.insertMenu}
        </>
      )}
      {props.dropAfter && <DropLine position="bottom" />}
    </div>
  );
}

function QuickInsert({ onPick }: { onPick: (type: BlockType) => void }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute top-full left-1/2 z-40 mt-5 grid max-h-[340px] w-[380px] max-w-[90vw] -translate-x-1/2 animate-pop-in grid-cols-5 gap-1 overflow-y-auto rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10"
    >
      {BLOCK_LIBRARY.map((b) => {
        const Icon = ICONS[b.type];
        return (
          <button
            key={b.type}
            type="button"
            onClick={() => onPick(b.type)}
            className="flex flex-col items-center gap-1 rounded-xl py-2 text-slate-700 transition hover:bg-brand-500 hover:text-white dark:text-slate-200"
          >
            <Icon className="size-4" strokeWidth={1.5} />
            <span className="font-display text-[10px] font-semibold">{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Floating formatting toolbar for rich text fields. Uses the browser's editing commands. */
function RichToolbar({ root, theme, onCommitted }: { root: React.RefObject<HTMLDivElement | null>; theme: Theme; onCommitted: (el: HTMLElement) => void }) {
  const [linkMode, setLinkMode] = useState(false);
  const [pop, setPop] = useState<null | "color" | "highlight" | "size">(null);
  const [url, setUrl] = useState("https://");
  const [tagsOpen, setTagsOpen] = useState(false);
  const saved = useRef<{ range: Range; el: HTMLElement } | null>(null);

  function activeField(): HTMLElement | null {
    const sel = document.getSelection();
    const node = sel?.anchorNode;
    const el = node ? (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>("[data-edit]") : null;
    return el && root.current?.contains(el) ? el : null;
  }

  function run(cmd: string, value?: string) {
    if (!activeField()) return;
    document.execCommand(cmd, false, value);
  }

  function startLink() {
    const sel = document.getSelection();
    const el = activeField();
    if (!sel || !sel.rangeCount || !el) return;
    saved.current = { range: sel.getRangeAt(0).cloneRange(), el };
    const a = (sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest("a");
    setUrl(a?.getAttribute("href") ?? "https://");
    setLinkMode(true);
  }

  function applyLink() {
    const s = saved.current;
    setLinkMode(false);
    if (!s) return;
    s.el.focus();
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(s.range);
    const href = normalizeUrl(url);
    if (href) {
      if (s.range.collapsed) document.execCommand("insertHTML", false, `<a href="${href.replace(/"/g, "&quot;")}">${href.replace(/</g, "&lt;")}</a>`);
      else document.execCommand("createLink", false, href);
    }
    onCommitted(s.el);
    saved.current = null;
  }

  /** Remember the selection before a popover steals focus. */
  function remember() {
    const sel = document.getSelection();
    const el = activeField();
    if (sel && sel.rangeCount && el) saved.current = { range: sel.getRangeAt(0).cloneRange(), el };
  }

  /** Wrap the current (or remembered) selection in a styled span. Empty value = remove that style. */
  function wrapStyle(prop: "color" | "backgroundColor" | "fontSize", value: string) {
    let el = activeField();
    const sel = document.getSelection();
    if (!el && saved.current) {
      el = saved.current.el;
      el.focus();
      sel?.removeAllRanges();
      sel?.addRange(saved.current.range);
    }
    if (!el || !sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !el.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.appendChild(range.extractContents());
    span.querySelectorAll<HTMLElement>("span:not([data-tag]), font").forEach((n) => (n.style[prop] = ""));
    if (value) span.style[prop] = value;
    range.insertNode(span);
    const r = document.createRange();
    r.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(r);
    saved.current = { range: r.cloneRange(), el };
    setPop(null);
  }

  const swatches = [...new Set([theme.text, theme.body || theme.text, theme.accent, "#FFFFFF", "#000000", "#E11D48", "#F59E0B", "#10B981", "#145CFF", "#7C3AED"].map((c) => c.toUpperCase()))];
  const highlights = ["#FEF08A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FED7AA", theme.accent.toUpperCase()];
  const sizes = [
    { label: t("Petit", "Small"), value: "13px" },
    { label: t("Normal", "Normal"), value: "" },
    { label: t("Grand", "Large"), value: "20px" },
    { label: t("Très grand", "Extra large"), value: "26px" },
    { label: t("Énorme", "Huge"), value: "36px" },
  ];

  function insertTag(tag: string, label: string) {
    run(
      "insertHTML",
      `<span data-tag="${tag}" contenteditable="false" style="display:inline-block;padding:0 6px;margin:0 1px;border-radius:6px;background:rgba(20,92,255,0.12);color:#145CFF;font-size:0.85em;font-weight:600;">${label}</span>&nbsp;`,
    );
    setTagsOpen(false);
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      data-rt-toolbar
      onClick={(e) => e.stopPropagation()}
      className="absolute -top-12 left-2 z-40 flex animate-pop-in items-center gap-0.5 rounded-full bg-slate-900 p-1 text-white shadow-xl"
    >
      {linkMode ? (
        <form
          className="flex items-center gap-1 pl-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <Link2 className="size-3.5 text-white/60" />
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => {
              if (!(e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest("[data-rt-toolbar]"))) {
                setLinkMode(false);
                if (saved.current) onCommitted(saved.current.el);
              }
            }}
            className="w-56 bg-transparent px-1 text-xs text-white outline-none placeholder:text-white/40"
            placeholder="https://"
          />
          <button type="submit" className="rounded-full bg-brand-500 px-3 py-1 font-display text-[11px] font-semibold">
            OK
          </button>
        </form>
      ) : (
        <>
          <RtBtn icon={Bold} label={t("Gras (⌘B)", "Bold (⌘B)")} onMouseDown={keep} onClick={() => run("bold")} />
          <RtBtn icon={Italic} label={t("Italique (⌘I)", "Italic (⌘I)")} onMouseDown={keep} onClick={() => run("italic")} />
          <RtBtn icon={Underline} label={t("Souligné (⌘U)", "Underline (⌘U)")} onMouseDown={keep} onClick={() => run("underline")} />
          <RtBtn icon={Strikethrough} label={t("Barré", "Strikethrough")} onMouseDown={keep} onClick={() => run("strikeThrough")} />
          <span className="mx-1 h-4 w-px bg-white/20" />
          <div className="relative">
            <RtBtn icon={Baseline} label={t("Couleur du texte", "Text color")} onMouseDown={keep} onClick={() => (remember(), setPop(pop === "color" ? null : "color"))} />
            {pop === "color" && (
              <ColorPop swatches={swatches} onPick={(c) => wrapStyle("color", c)} onClear={() => wrapStyle("color", "")} clearLabel={t("Couleur par défaut", "Default color")} />
            )}
          </div>
          <div className="relative">
            <RtBtn icon={Highlighter} label={t("Surligner", "Highlight")} onMouseDown={keep} onClick={() => (remember(), setPop(pop === "highlight" ? null : "highlight"))} />
            {pop === "highlight" && (
              <ColorPop swatches={highlights} onPick={(c) => wrapStyle("backgroundColor", c)} onClear={() => wrapStyle("backgroundColor", "")} clearLabel={t("Sans surlignage", "No highlight")} />
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onMouseDown={keep}
              onClick={() => (remember(), setPop(pop === "size" ? null : "size"))}
              className="rounded-full px-2 py-1 font-display text-[11px] font-bold hover:bg-white/15"
              title={t("Taille du texte", "Text size")}
            >
              Aa
            </button>
            {pop === "size" && (
              <div className="absolute top-full left-0 mt-1.5 w-36 rounded-xl bg-white p-1 text-slate-800 shadow-xl ring-1 ring-slate-900/10">
                {sizes.map((z) => (
                  <button
                    key={z.label}
                    type="button"
                    onMouseDown={keep}
                    onClick={() => wrapStyle("fontSize", z.value)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
                    style={{ fontSize: z.value ? Math.min(20, parseInt(z.value)) : 14 }}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="mx-1 h-4 w-px bg-white/20" />
          <RtBtn icon={Link2} label={t("Lien", "Link")} onMouseDown={keep} onClick={startLink} />
          <RtBtn icon={Link2Off} label={t("Retirer le lien", "Remove link")} onMouseDown={keep} onClick={() => run("unlink")} />
          <RtBtn icon={RemoveFormatting} label={t("Effacer la mise en forme", "Clear formatting")} onMouseDown={keep} onClick={() => run("removeFormat")} />
          <span className="mx-1 h-4 w-px bg-white/20" />
          <div className="relative">
            <button
              type="button"
              onMouseDown={keep}
              onClick={() => setTagsOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1.5 font-display text-[11px] font-semibold hover:bg-white/15"
            >
              <UserRound className="size-3.5" /> {t("Variable", "Variable")}
            </button>
            {tagsOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-36 rounded-xl bg-white p-1 text-slate-800 shadow-xl ring-1 ring-slate-900/10">
                {MERGE_TAGS.map((m) => (
                  <button
                    key={m.tag}
                    type="button"
                    onMouseDown={keep}
                    onClick={() => insertTag(m.tag, m.label)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** "boutique.fr" → "https://boutique.fr"; collapses a doubled protocol; keeps mailto:/tel:/merge tags. */
export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/^(https?:\/\/)+(?=https?:\/\/)/i, "");
  if (!u || /^https?:\/\/$/i.test(u)) return "";
  if (!/^(https?:|mailto:|tel:|\{\{)/i.test(u)) u = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(u) ? `mailto:${u}` : `https://${u}`;
  return u;
}

/** Swatch popover with a custom color picker (applied on change, not on every drag frame). */
function ColorPop({ swatches, onPick, onClear, clearLabel }: { swatches: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => onPick(el.value.toUpperCase());
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onPick]);
  return (
    <div className="absolute top-full left-0 mt-1.5 w-52 rounded-xl bg-white p-2.5 text-slate-800 shadow-xl ring-1 ring-slate-900/10">
      <div className="grid grid-cols-6 gap-1.5">
        {swatches.map((c) => (
          <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} className="size-6 rounded-full ring-1 ring-slate-900/15 transition hover:scale-110" style={{ background: c }} title={c} aria-label={c} />
        ))}
        <label className="relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] ring-1 ring-slate-900/15" title={t("Couleur personnalisée", "Custom color")}>
          <input ref={input} type="color" className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClear} className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100">
        {clearLabel}
      </button>
    </div>
  );
}

function RtBtn({ icon: Icon, label, onClick, onMouseDown }: { icon: LucideIcon; label: string; onClick: () => void; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" title={label} aria-label={label} onMouseDown={onMouseDown} onClick={onClick} className="rounded-full p-1.5 transition hover:bg-white/15">
      <Icon className="size-3.5" />
    </button>
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

function IconBtn({ icon: Icon, label, onClick, disabled, danger }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex size-8 items-center justify-center rounded-full text-slate-600 transition disabled:opacity-30 dark:text-slate-300",
        danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}

import type { ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, CaseSensitive, CaseUpper, Italic, MonitorOff, MousePointerClick, Plus, RotateCcw, SmartphoneNfc } from "lucide-react";
import { cx } from "../../lib/format";
import { Field, Input, Segmented, Select, Textarea } from "../ui/primitives";
import { ImageField } from "./media";
import { FONT_LIST, SOCIAL_LABELS, THEME_SWATCHES, type Align, type Block, type BlockStyle, type ColumnItem, type SocialNetwork, type Theme, type Transform } from "./model";

// --- Controls ---------------------------------------------------------------------------

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-slate-900/[0.07] dark:border-white/[0.07]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 select-none">
        <span className="font-display text-[11px] font-bold tracking-[0.16em] text-slate-900 uppercase dark:text-white">{title}</span>
        <Plus className="size-3.5 text-slate-400 transition group-open:rotate-45" />
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Label({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{children}</span>
      {onReset && (
        <button type="button" onClick={onReset} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand-500" title="Revenir au style global">
          <RotateCcw className="size-3" /> Global
        </button>
      )}
    </div>
  );
}

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

function AlignField({ value, onChange, label = "Alignement" }: { value: Align; onChange: (v: Align) => void; label?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <AlignPicker value={value} onChange={onChange} />
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">{children}</p>;
}

/** Color input. `inherit` = value shown when empty (from the global style); empty means "use global". */
export function ColorField({ label, value, onChange, inherit, allowEmpty }: { label: string; value: string | undefined; onChange: (v: string) => void; inherit?: string; allowEmpty?: boolean }) {
  const v = value ?? "";
  const shown = v || inherit || "";
  const safe = /^#[0-9a-f]{6}$/i.test(shown) ? shown : "#ffffff";
  const resettable = (allowEmpty || inherit !== undefined) && !!v;
  return (
    <div>
      <Label onReset={resettable ? () => onChange("") : undefined}>{label}</Label>
      <div className="flex items-center gap-2">
        <label
          className={cx("relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-slate-900/15 dark:ring-white/15", !shown && "bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:10px_10px]")}
          style={shown ? { background: shown } : undefined}
        >
          <input type="color" value={safe} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <Input value={v} onChange={(e) => onChange(e.target.value)} placeholder={inherit ? `${inherit} (global)` : "Aucune"} className="h-9 font-mono text-xs uppercase" />
      </div>
    </div>
  );
}

function Slider({ label, value, inherit, min, max, step = 1, unit = "px", onChange, format }: { label: string; value: number | undefined; inherit?: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number | undefined) => void; format?: (n: number) => string }) {
  const current = value ?? inherit ?? min;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <span className="flex items-center gap-2">
          <span className={cx("font-mono text-xs tabular-nums", value === undefined ? "text-slate-400" : "text-slate-900 dark:text-white")}>
            {format ? format(current) : current}
            {unit}
            {value === undefined && inherit !== undefined && " · global"}
          </span>
          {value !== undefined && inherit !== undefined && (
            <button type="button" onClick={() => onChange(undefined)} className="text-slate-400 hover:text-brand-500" title="Revenir au style global" aria-label={`Réinitialiser ${label}`}>
              <RotateCcw className="size-3" />
            </button>
          )}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={current} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-500" />
    </div>
  );
}

function Toggle({ label, checked, onChange, icon: Icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: typeof Italic }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
      <span className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-slate-400" strokeWidth={1.5} />}
        {label}
      </span>
      <span className={cx("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-brand-500" : "bg-slate-300 dark:bg-white/15")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </label>
  );
}

export function FontSelect({ label, value, onChange, inheritLabel }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; inheritLabel?: string }) {
  const safe = Object.entries(FONT_LIST).filter(([, f]) => f.kind === "sûre");
  const web = Object.entries(FONT_LIST).filter(([, f]) => f.kind === "web");
  return (
    <Field label={label}>
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={value ? { fontFamily: FONT_LIST[value]?.stack } : undefined}>
        {inheritLabel && <option value="">{inheritLabel}</option>}
        <optgroup label="Polices universelles (partout)">
          {safe.map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Polices web (Apple Mail, iOS… sinon remplacées)">
          {web.map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </optgroup>
      </Select>
    </Field>
  );
}

const WEIGHTS = [
  { value: "400", label: "Normal" },
  { value: "600", label: "Semi" },
  { value: "700", label: "Gras" },
  { value: "800", label: "Extra" },
];

function WeightField({ value, inherit, onChange }: { value: number | undefined; inherit?: number; onChange: (v: number | undefined) => void }) {
  const current = String(value ?? inherit ?? 400);
  const snapped = WEIGHTS.reduce((best, w) => (Math.abs(Number(w.value) - Number(current)) < Math.abs(Number(best) - Number(current)) ? w.value : best), "400");
  return (
    <div>
      <Label onReset={value !== undefined && inherit !== undefined ? () => onChange(undefined) : undefined}>Graisse</Label>
      <Segmented value={snapped} onChange={(v) => onChange(Number(v))} options={WEIGHTS} />
    </div>
  );
}

function CaseField({ value, inherit, onChange }: { value: Transform | undefined; inherit?: Transform; onChange: (v: Transform | undefined) => void }) {
  return (
    <div>
      <Label onReset={value !== undefined && inherit !== undefined ? () => onChange(undefined) : undefined}>Casse</Label>
      <Segmented
        value={value ?? inherit ?? "none"}
        onChange={onChange}
        options={[
          { value: "none", label: "Normale", icon: CaseSensitive },
          { value: "uppercase", label: "MAJUSCULES", icon: CaseUpper },
        ]}
      />
    </div>
  );
}

const EDIT_TIP = (
  <Hint>
    <MousePointerClick className="mr-1 inline size-3.5 -translate-y-px" />
    Écrivez directement dans l'email. Sélectionnez un mot pour le mettre en gras, changer sa couleur, sa taille ou ajouter un lien.
  </Hint>
);

// --- Block inspector ------------------------------------------------------------------

const DEFAULT_PAD: Partial<Record<Block["type"], [number, number]>> = {
  logo: [32, 24],
  heading: [12, 12],
  text: [10, 10],
  image: [12, 12],
  button: [18, 18],
  product: [12, 12],
  columns: [14, 14],
  promo: [14, 14],
  quote: [16, 16],
  video: [12, 12],
  social: [16, 16],
  divider: [18, 18],
  html: [12, 12],
  footer: [28, 36],
};

type Setter = (patch: Record<string, unknown>) => void;

export function BlockInspector({ block, theme, onChange }: { block: Block; theme: Theme; onChange: (patch: Partial<Block>) => void }) {
  const set: Setter = (patch) => {
    // `undefined` / "" = inherit from the global style.
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === "" ? undefined : v;
    onChange(clean as Partial<Block>);
  };
  const setStyle = (patch: Partial<BlockStyle>) => {
    const style: Record<string, unknown> = { ...block.style, ...patch };
    for (const k of Object.keys(style)) if (style[k] === undefined || style[k] === "" || style[k] === false) delete style[k];
    onChange({ style: Object.keys(style).length ? (style as BlockStyle) : undefined } as Partial<Block>);
  };
  const pads = DEFAULT_PAD[block.type];

  return (
    <>
      <BlockFields block={block} theme={theme} set={set} />
      {pads && (
        <Section title="Espacement" defaultOpen={false}>
          <Row>
            <Slider label="Haut" value={block.style?.padTop} inherit={pads[0]} min={0} max={120} step={2} onChange={(padTop) => setStyle({ padTop })} />
            <Slider label="Bas" value={block.style?.padBottom} inherit={pads[1]} min={0} max={120} step={2} onChange={(padBottom) => setStyle({ padBottom })} />
          </Row>
          <Slider label="Marges latérales" value={block.style?.padX} inherit={theme.padX} min={0} max={80} step={2} onChange={(padX) => setStyle({ padX })} />
          <Slider label="Retrait de la section" value={block.style?.inset} inherit={0} min={0} max={60} step={2} onChange={(inset) => setStyle({ inset })} />
        </Section>
      )}
      {pads && (
        <Section title="Fond & bordure de section" defaultOpen={!!(block.style?.bg || block.style?.borderWidth)}>
          <ColorField label="Fond" value={block.style?.bg} onChange={(bg) => setStyle({ bg })} allowEmpty />
          <Slider label="Arrondi" value={block.style?.radius} inherit={0} min={0} max={40} onChange={(radius) => setStyle({ radius })} />
          <Slider label="Bordure" value={block.style?.borderWidth} inherit={0} min={0} max={6} onChange={(borderWidth) => setStyle({ borderWidth })} />
          {!!block.style?.borderWidth && <ColorField label="Couleur de bordure" value={block.style?.borderColor} onChange={(borderColor) => setStyle({ borderColor })} allowEmpty />}
        </Section>
      )}
      <Section title="Visibilité" defaultOpen={!!(block.style?.hideMobile || block.style?.hideDesktop)}>
        <Toggle label="Masquer sur mobile" icon={SmartphoneNfc} checked={!!block.style?.hideMobile} onChange={(hideMobile) => setStyle({ hideMobile, hideDesktop: hideMobile ? undefined : block.style?.hideDesktop })} />
        <Toggle label="Masquer sur ordinateur" icon={MonitorOff} checked={!!block.style?.hideDesktop} onChange={(hideDesktop) => setStyle({ hideDesktop, hideMobile: hideDesktop ? undefined : block.style?.hideMobile })} />
      </Section>
    </>
  );
}

function ButtonStyleFields({ b, theme, set }: { b: Extract<Block, { type: "button" }>; theme: Theme; set: Setter }) {
  return (
    <>
      <Row>
        <ColorField label="Fond" value={b.color} inherit={theme.accent} onChange={(color) => set({ color })} />
        <ColorField label="Texte" value={b.textColor} inherit={theme.accentText} onChange={(textColor) => set({ textColor })} />
      </Row>
      <FontSelect label="Police" value={b.font} inheritLabel="Police du texte (global)" onChange={(font) => set({ font })} />
      <Slider label="Taille du texte" value={b.fontSize} inherit={theme.buttonSize} min={11} max={28} onChange={(fontSize) => set({ fontSize })} />
      <WeightField value={b.weight} inherit={theme.buttonWeight} onChange={(weight) => set({ weight })} />
      <CaseField value={b.transform} inherit={theme.buttonTransform} onChange={(transform) => set({ transform })} />
      <Row>
        <Slider label="Hauteur" value={b.padY} inherit={theme.buttonPadY} min={6} max={30} onChange={(padY) => set({ padY })} />
        <Slider label="Largeur" value={b.padX} inherit={theme.buttonPadX} min={10} max={70} step={2} onChange={(padX) => set({ padX })} />
      </Row>
      <Slider label="Arrondi" value={b.radius} inherit={Math.min(theme.radius, 40)} min={0} max={40} onChange={(radius) => set({ radius: radius === 40 ? 999 : radius })} format={(n) => (n >= 40 ? "pilule " : String(n))} />
      <Slider label="Bordure" value={b.borderWidth} inherit={0} min={0} max={4} onChange={(borderWidth) => set({ borderWidth })} />
      {!!b.borderWidth && <ColorField label="Couleur de bordure" value={b.borderColor} inherit={b.textColor || theme.accentText} onChange={(borderColor) => set({ borderColor })} />}
    </>
  );
}

function BlockFields({ block, theme, set }: { block: Block; theme: Theme; set: Setter }) {
  switch (block.type) {
    case "logo":
      return (
        <>
          <Section title="Contenu">
            <Field label="Nom de la marque">
              <Input value={block.text} onChange={(e) => set({ text: e.target.value })} />
            </Field>
            <ImageField label="Logo (image)" value={block.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
            {block.imageUrl && <Slider label="Hauteur du logo" value={block.height} inherit={40} min={16} max={160} step={2} onChange={(height) => set({ height })} />}
            <Field label="Lien au clic">
              <Input value={block.href ?? ""} onChange={(e) => set({ href: e.target.value })} placeholder="https://votre-site.fr" />
            </Field>
            <AlignField value={block.align} onChange={(align) => set({ align })} />
          </Section>
          {!block.imageUrl && (
            <Section title="Typographie">
              <FontSelect label="Police" value={block.font} inheritLabel="Police des titres (global)" onChange={(font) => set({ font })} />
              <Slider label="Taille" value={block.fontSize} inherit={24} min={12} max={64} onChange={(fontSize) => set({ fontSize })} />
              <WeightField value={block.weight} inherit={theme.headingWeight} onChange={(weight) => set({ weight })} />
              <CaseField value={block.transform} inherit={theme.headingTransform} onChange={(transform) => set({ transform })} />
              <ColorField label="Couleur" value={block.color} inherit={theme.text} onChange={(color) => set({ color })} />
            </Section>
          )}
        </>
      );
    case "heading":
      return (
        <>
          <Section title="Contenu">
            {EDIT_TIP}
            <AlignField value={block.align} onChange={(align) => set({ align })} />
          </Section>
          <Section title="Typographie">
            <FontSelect label="Police" value={block.font} inheritLabel="Police des titres (global)" onChange={(font) => set({ font })} />
            <Slider label="Taille" value={block.fontSize ?? { xl: 48, lg: 34, md: 22 }[block.size]} min={14} max={96} onChange={(fontSize) => set({ fontSize })} />
            <WeightField value={block.weight} inherit={theme.headingWeight} onChange={(weight) => set({ weight })} />
            <CaseField value={block.transform} inherit={theme.headingTransform} onChange={(transform) => set({ transform })} />
            <Row>
              <Slider label="Interlettrage" value={block.spacing === undefined ? undefined : Math.round(block.spacing * 100)} inherit={Math.round(theme.headingSpacing * 100)} min={-8} max={30} unit="" onChange={(v) => set({ spacing: v === undefined ? undefined : v / 100 })} />
              <Slider label="Interligne" value={block.lineHeight === undefined ? undefined : Math.round(block.lineHeight * 100)} inherit={Math.round(theme.headingLineHeight * 100)} min={80} max={180} step={5} unit="%" onChange={(v) => set({ lineHeight: v === undefined ? undefined : v / 100 })} />
            </Row>
            <Toggle label="Italique" icon={Italic} checked={!!block.italic} onChange={(italic) => set({ italic: italic || undefined })} />
            <ColorField label="Couleur" value={block.color} inherit={theme.text} onChange={(color) => set({ color })} />
          </Section>
        </>
      );
    case "text":
      return (
        <>
          <Section title="Contenu">
            {EDIT_TIP}
            <AlignField value={block.align} onChange={(align) => set({ align })} />
          </Section>
          <Section title="Typographie">
            <FontSelect label="Police" value={block.font} inheritLabel="Police du texte (global)" onChange={(font) => set({ font })} />
            <Slider label="Taille" value={block.fontSize} inherit={theme.bodySize + ({ sm: -2, md: 0, lg: 2 } as const)[block.size ?? "md"]} min={10} max={32} onChange={(fontSize) => set({ fontSize })} />
            <WeightField value={block.weight} inherit={400} onChange={(weight) => set({ weight })} />
            <Row>
              <Slider label="Interligne" value={block.lineHeight === undefined ? undefined : Math.round(block.lineHeight * 100)} inherit={Math.round(theme.bodyLineHeight * 100)} min={100} max={220} step={5} unit="%" onChange={(v) => set({ lineHeight: v === undefined ? undefined : v / 100 })} />
              <Slider label="Interlettrage" value={block.spacing === undefined ? undefined : Math.round(block.spacing * 100)} inherit={0} min={-5} max={30} unit="" onChange={(v) => set({ spacing: v === undefined ? undefined : v / 100 })} />
            </Row>
            <CaseField value={block.transform} inherit="none" onChange={(transform) => set({ transform })} />
            <Toggle label="Italique" icon={Italic} checked={!!block.italic} onChange={(italic) => set({ italic: italic || undefined })} />
            <ColorField label="Couleur" value={block.color} inherit={theme.body || theme.text} onChange={(color) => set({ color })} />
          </Section>
        </>
      );
    case "quote":
      return (
        <>
          <Section title="Contenu">
            {EDIT_TIP}
            <Field label="Auteur">
              <Input value={block.author} onChange={(e) => set({ author: e.target.value })} />
            </Field>
            <AlignField value={block.align ?? "left"} onChange={(align) => set({ align })} />
          </Section>
          <Section title="Style">
            <Slider label="Taille" value={block.fontSize} inherit={20} min={13} max={40} onChange={(fontSize) => set({ fontSize })} />
            <Toggle label="Italique" icon={Italic} checked={!!block.italic} onChange={(italic) => set({ italic: italic || undefined })} />
            <ColorField label="Couleur du texte" value={block.color} inherit={theme.text} onChange={(color) => set({ color })} />
            <ColorField label="Barre latérale" value={block.barColor} inherit={theme.accent} onChange={(barColor) => set({ barColor })} />
          </Section>
        </>
      );
    case "image":
      return (
        <>
          <Section title="Contenu">
            <ImageField value={block.src} onChange={(src) => set({ src })} />
            <Field label="Texte alternatif" hint="Lu par les lecteurs d'écran et affiché si l'image est bloquée.">
              <Input value={block.alt} onChange={(e) => set({ alt: e.target.value })} placeholder="Décrivez l'image" />
            </Field>
            <Field label="Lien au clic">
              <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
            </Field>
          </Section>
          <Section title="Style">
            <Slider label="Largeur" value={block.width ?? 100} min={10} max={100} step={5} unit="%" onChange={(width) => set({ width })} />
            <AlignField value={block.align ?? "center"} onChange={(align) => set({ align })} />
            <Slider label="Arrondi" value={block.radius ?? (block.rounded === false ? 0 : 12)} min={0} max={60} onChange={(radius) => set({ radius, rounded: undefined })} />
            <Slider label="Bordure" value={block.borderWidth} inherit={0} min={0} max={8} onChange={(borderWidth) => set({ borderWidth })} />
            {!!block.borderWidth && <ColorField label="Couleur de bordure" value={block.borderColor} inherit={theme.text} onChange={(borderColor) => set({ borderColor })} />}
          </Section>
        </>
      );
    case "button":
      return (
        <>
          <Section title="Contenu">
            <Field label="Libellé">
              <Input value={block.label} onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <Field label="Lien">
              <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
            </Field>
            <AlignField value={block.align} onChange={(align) => set({ align })} />
            <Toggle label="Pleine largeur" checked={block.full} onChange={(full) => set({ full })} />
          </Section>
          <Section title="Style du bouton">
            <ButtonStyleFields b={block} theme={theme} set={set} />
          </Section>
        </>
      );
    case "product":
      return (
        <>
          <Section title="Contenu">
            <ImageField label="Photo du produit" value={block.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
            <Field label="Nom du produit">
              <Input value={block.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Row>
              <Field label="Prix">
                <Input value={block.price} onChange={(e) => set({ price: e.target.value })} />
              </Field>
              <Field label="Prix barré">
                <Input value={block.oldPrice} onChange={(e) => set({ oldPrice: e.target.value })} placeholder="—" />
              </Field>
            </Row>
            <Field label="Lien du produit">
              <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
            </Field>
            <Field label="Texte du bouton">
              <Input value={block.cta} onChange={(e) => set({ cta: e.target.value })} />
            </Field>
          </Section>
          <Section title="Style">
            <div>
              <Label>Disposition</Label>
              <Segmented
                value={block.layout ?? "left"}
                onChange={(layout) => set({ layout })}
                options={[
                  { value: "left", label: "Image à gauche" },
                  { value: "right", label: "À droite" },
                  { value: "stack", label: "Empilé" },
                ]}
              />
            </div>
            <ColorField label="Fond de la carte" value={block.cardBg} onChange={(cardBg) => set({ cardBg })} allowEmpty />
            <ColorField label="Bordure" value={block.borderColor} onChange={(borderColor) => set({ borderColor })} allowEmpty />
            <ColorField label="Couleur du prix" value={block.priceColor} inherit={theme.text} onChange={(priceColor) => set({ priceColor })} />
            <Slider label="Arrondi" value={block.radius} inherit={14} min={0} max={40} onChange={(radius) => set({ radius })} />
          </Section>
        </>
      );
    case "columns": {
      const setItem = (i: number, patch: Partial<ColumnItem>) => set({ items: block.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
      return (
        <>
          <Section title="Colonnes">
            <Field label="Nombre" hint="Sur mobile, les colonnes s'empilent automatiquement.">
              <Segmented
                value={String(block.items.length)}
                onChange={(v) => {
                  const n = Number(v);
                  const items = block.items.slice(0, n);
                  while (items.length < n) items.push({ imageUrl: "", title: `Produit ${items.length + 1}`, text: "Une courte description.", href: "https://", cta: "Voir" });
                  set({ items });
                }}
                options={[
                  { value: "2", label: "2 colonnes" },
                  { value: "3", label: "3 colonnes" },
                ]}
              />
            </Field>
            {block.items.map((it, i) => (
              <details key={i} open={i === 0} className="rounded-2xl bg-slate-50 ring-1 ring-slate-900/[0.06] dark:bg-white/[0.03] dark:ring-white/10">
                <summary className="cursor-pointer px-3.5 py-2.5 font-display text-xs font-bold tracking-wider text-brand-500 uppercase">
                  Colonne {i + 1} · <span className="normal-case">{it.title}</span>
                </summary>
                <div className="space-y-3 px-3.5 pb-3.5">
                  <ImageField value={it.imageUrl} onChange={(imageUrl) => setItem(i, { imageUrl })} />
                  <Field label="Lien">
                    <Input value={it.href} onChange={(e) => setItem(i, { href: e.target.value })} placeholder="https://" />
                  </Field>
                  <Field label="Texte du lien">
                    <Input value={it.cta} onChange={(e) => setItem(i, { cta: e.target.value })} />
                  </Field>
                </div>
              </details>
            ))}
          </Section>
          <Section title="Style">
            <AlignField value={block.align ?? "left"} onChange={(align) => set({ align })} />
            <Slider label="Espace entre colonnes" value={block.gap} inherit={12} min={0} max={40} onChange={(gap) => set({ gap })} />
            <Slider label="Taille des titres" value={block.titleSize} inherit={17} min={12} max={30} onChange={(titleSize) => set({ titleSize })} />
            <Slider label="Arrondi des images" value={block.imageRadius} inherit={10} min={0} max={40} onChange={(imageRadius) => set({ imageRadius })} />
            <ColorField label="Fond des cartes" value={block.cardBg} onChange={(cardBg) => set({ cardBg })} allowEmpty />
            <ColorField label="Couleur des liens" value={block.linkColor} inherit={theme.link || theme.accent} onChange={(linkColor) => set({ linkColor })} />
            <Toggle label="Afficher les liens" checked={block.showCta !== false} onChange={(v) => set({ showCta: v ? undefined : false })} />
          </Section>
        </>
      );
    }
    case "promo":
      return (
        <>
          <Section title="Contenu">
            <Field label="Code">
              <Input value={block.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} className="font-mono tracking-widest" />
            </Field>
            <Field label="Étiquette">
              <Input value={block.label ?? "Votre code"} onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={block.caption} onChange={(e) => set({ caption: e.target.value })} />
            </Field>
          </Section>
          <Section title="Style">
            <Slider label="Taille du code" value={block.codeSize} inherit={28} min={16} max={56} onChange={(codeSize) => set({ codeSize })} />
            <ColorField label="Couleur du code" value={block.codeColor} inherit={theme.text} onChange={(codeColor) => set({ codeColor })} />
            <ColorField label="Fond" value={block.bg} onChange={(bg) => set({ bg })} allowEmpty />
            <ColorField label="Bordure" value={block.borderColor} inherit={theme.accent} onChange={(borderColor) => set({ borderColor })} />
            <div>
              <Label>Trait</Label>
              <Segmented
                value={block.borderStyle ?? "dashed"}
                onChange={(borderStyle) => set({ borderStyle })}
                options={[
                  { value: "dashed", label: "Tirets" },
                  { value: "dotted", label: "Points" },
                  { value: "solid", label: "Plein" },
                ]}
              />
            </div>
          </Section>
        </>
      );
    case "video":
      return (
        <>
          <Section title="Contenu">
            <ImageField label="Miniature" value={block.thumbnail} onChange={(thumbnail) => set({ thumbnail })} />
            <Field label="Lien de la vidéo" hint="YouTube, Vimeo, Instagram… La vidéo s'ouvre au clic (les emails ne lisent pas les vidéos).">
              <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://youtube.com/…" />
            </Field>
            <Field label="Légende">
              <Input value={block.caption} onChange={(e) => set({ caption: e.target.value })} />
            </Field>
          </Section>
          <Section title="Style">
            <Slider label="Arrondi" value={block.radius} inherit={12} min={0} max={40} onChange={(radius) => set({ radius })} />
            <ColorField label="Couleur de la légende" value={block.captionColor} inherit={theme.link || theme.accent} onChange={(captionColor) => set({ captionColor })} />
          </Section>
        </>
      );
    case "social": {
      const all = Object.keys(SOCIAL_LABELS) as SocialNetwork[];
      const url = (n: SocialNetwork) => block.links.find((l) => l.network === n)?.url ?? "";
      const setUrl = (n: SocialNetwork, value: string) => set({ links: all.map((net) => ({ network: net, url: net === n ? value : url(net) })).filter((l) => l.url !== "") });
      return (
        <>
          <Section title="Liens">
            <p className="text-xs text-slate-500">Laissez vide un réseau pour le masquer.</p>
            {all.map((n) => (
              <Field key={n} label={SOCIAL_LABELS[n]}>
                <Input value={url(n)} onChange={(e) => setUrl(n, e.target.value)} placeholder="https://" className="h-9 text-xs" />
              </Field>
            ))}
          </Section>
          <Section title="Style">
            <div>
              <Label>Apparence</Label>
              <Segmented
                value={block.variant ?? "outline"}
                onChange={(variant) => set({ variant })}
                options={[
                  { value: "outline", label: "Contour" },
                  { value: "filled", label: "Plein" },
                  { value: "text", label: "Texte" },
                ]}
              />
            </div>
            <AlignField value={block.align} onChange={(align) => set({ align })} />
            <Slider label="Taille" value={block.size} inherit={13} min={10} max={20} onChange={(size) => set({ size })} />
            <ColorField label="Couleur" value={block.color} inherit={theme.text} onChange={(color) => set({ color })} />
            {block.variant === "filled" && <ColorField label="Couleur du texte" value={block.textColor} inherit={theme.surface} onChange={(textColor) => set({ textColor })} />}
          </Section>
        </>
      );
    }
    case "divider":
      return (
        <Section title="Style">
          <Slider label="Épaisseur" value={block.thickness ?? 1} min={1} max={8} onChange={(thickness) => set({ thickness })} />
          <Slider label="Longueur" value={block.width} inherit={100} min={10} max={100} step={5} unit="%" onChange={(width) => set({ width })} />
          <div>
            <Label>Trait</Label>
            <Segmented
              value={block.lineStyle ?? "solid"}
              onChange={(lineStyle) => set({ lineStyle })}
              options={[
                { value: "solid", label: "Plein" },
                { value: "dashed", label: "Tirets" },
                { value: "dotted", label: "Points" },
              ]}
            />
          </div>
          <ColorField label="Couleur" value={block.color} onChange={(color) => set({ color })} allowEmpty />
        </Section>
      );
    case "spacer":
      return (
        <Section title="Style">
          <Slider label="Hauteur" value={block.height} min={4} max={200} step={4} onChange={(height) => set({ height: height ?? 24 })} />
        </Section>
      );
    case "html":
      return (
        <Section title="Code">
          <Field label="Code HTML" hint="Utilisez des styles en ligne : les clients mail ignorent la plupart des feuilles de style.">
            <Textarea rows={14} value={block.html} onChange={(e) => set({ html: e.target.value })} spellCheck={false} className="font-mono text-xs" />
          </Field>
        </Section>
      );
    case "footer":
      return (
        <>
          <Section title="Contenu">
            {EDIT_TIP}
            <Field label="Texte du lien de désinscription" hint="Le lien est obligatoire : il reste toujours présent.">
              <Input value={block.unsubscribeLabel ?? "Se désinscrire"} onChange={(e) => set({ unsubscribeLabel: e.target.value })} />
            </Field>
            <AlignField value={block.align ?? "center"} onChange={(align) => set({ align })} />
          </Section>
          <Section title="Style">
            <Slider label="Taille" value={block.fontSize} inherit={12} min={9} max={18} onChange={(fontSize) => set({ fontSize })} />
            <ColorField label="Couleur du texte" value={block.color} onChange={(color) => set({ color })} allowEmpty />
            <ColorField label="Couleur des liens" value={block.linkColor} onChange={(linkColor) => set({ linkColor })} allowEmpty />
          </Section>
        </>
      );
  }
}

// --- Theme inspector ----------------------------------------------------------------------

export function ThemeInspector({ theme, onChange, brandActions }: { theme: Theme; onChange: (patch: Partial<Theme>) => void; brandActions?: ReactNode }) {
  const n = (k: keyof Theme) => (v: number | undefined) => v !== undefined && onChange({ [k]: v } as Partial<Theme>);
  return (
    <>
      {brandActions}
      <Section title="Ambiances">
        <div className="grid grid-cols-3 gap-2">
          {THEME_SWATCHES.map((s) => {
            const active = theme.accent === s.theme.accent && theme.background === s.theme.background && theme.headingFont === s.theme.headingFont;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => onChange(s.theme)}
                className={cx("overflow-hidden rounded-xl text-left ring-1 transition hover:-translate-y-0.5", active ? "ring-2 ring-brand-500" : "ring-slate-900/10 dark:ring-white/10")}
              >
                <span className="flex h-12 items-end gap-1 p-2" style={{ background: s.theme.background }}>
                  <span className="flex h-7 flex-1 items-center rounded-md px-1.5" style={{ background: s.theme.surface, color: s.theme.text, fontFamily: FONT_LIST[s.theme.headingFont ?? "helvetica"]?.stack, fontWeight: s.theme.headingWeight }}>
                    <span className="text-[11px] leading-none">Aa</span>
                  </span>
                  <span className="h-3 w-5" style={{ background: s.theme.accent, borderRadius: Math.min(s.theme.radius ?? 12, 999) }} />
                </span>
                <span className="block px-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{s.name}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">Une ambiance règle couleurs, polices et boutons d'un coup. Ajustez ensuite chaque détail ci-dessous.</p>
      </Section>

      <Section title="Couleurs">
        <Row>
          <ColorField label="Fond extérieur" value={theme.background} onChange={(background) => onChange({ background })} />
          <ColorField label="Fond de l'email" value={theme.surface} onChange={(surface) => onChange({ surface })} />
        </Row>
        <Row>
          <ColorField label="Titres" value={theme.text} onChange={(text) => onChange({ text })} />
          <ColorField label="Texte" value={theme.body} inherit={theme.text} onChange={(body) => onChange({ body })} />
        </Row>
        <Row>
          <ColorField label="Accent" value={theme.accent} onChange={(accent) => onChange({ accent })} />
          <ColorField label="Liens" value={theme.link} inherit={theme.accent} onChange={(link) => onChange({ link })} />
        </Row>
        <ColorField label="Texte des boutons" value={theme.accentText} onChange={(accentText) => onChange({ accentText })} />
      </Section>

      <Section title="Titres">
        <FontSelect label="Police" value={theme.headingFont} onChange={(v) => v && onChange({ headingFont: v })} />
        <WeightField value={theme.headingWeight} onChange={(v) => v && onChange({ headingWeight: v })} />
        <CaseField value={theme.headingTransform} onChange={(v) => v && onChange({ headingTransform: v })} />
        <Row>
          <Slider label="Interlettrage" value={Math.round(theme.headingSpacing * 100)} min={-8} max={30} unit="" onChange={(v) => v !== undefined && onChange({ headingSpacing: v / 100 })} />
          <Slider label="Interligne" value={Math.round(theme.headingLineHeight * 100)} min={80} max={180} step={5} unit="%" onChange={(v) => v !== undefined && onChange({ headingLineHeight: v / 100 })} />
        </Row>
      </Section>

      <Section title="Texte">
        <FontSelect label="Police" value={theme.bodyFont} onChange={(v) => v && onChange({ bodyFont: v })} />
        <Row>
          <Slider label="Taille" value={theme.bodySize} min={12} max={22} onChange={n("bodySize")} />
          <Slider label="Interligne" value={Math.round(theme.bodyLineHeight * 100)} min={110} max={220} step={5} unit="%" onChange={(v) => v !== undefined && onChange({ bodyLineHeight: v / 100 })} />
        </Row>
      </Section>

      <Section title="Boutons">
        <Slider label="Arrondi" value={Math.min(theme.radius, 40)} min={0} max={40} onChange={(v) => v !== undefined && onChange({ radius: v === 40 ? 999 : v })} format={(x) => (x >= 40 ? "pilule " : String(x))} />
        <Row>
          <Slider label="Hauteur" value={theme.buttonPadY} min={6} max={30} onChange={n("buttonPadY")} />
          <Slider label="Largeur" value={theme.buttonPadX} min={10} max={70} step={2} onChange={n("buttonPadX")} />
        </Row>
        <Slider label="Taille du texte" value={theme.buttonSize} min={11} max={24} onChange={n("buttonSize")} />
        <WeightField value={theme.buttonWeight} onChange={(v) => v && onChange({ buttonWeight: v })} />
        <CaseField value={theme.buttonTransform} onChange={(v) => v && onChange({ buttonTransform: v })} />
      </Section>

      <Section title="Mise en page" defaultOpen={false}>
        <Slider label="Largeur de l'email" value={theme.width} min={480} max={720} step={10} onChange={n("width")} />
        <Slider label="Marges intérieures" value={theme.padX} min={12} max={72} step={2} onChange={n("padX")} />
        <Slider label="Espace autour de l'email" value={theme.outerPad} min={0} max={80} step={2} onChange={n("outerPad")} />
        <Slider label="Arrondi de l'email" value={theme.cardRadius} min={0} max={40} onChange={n("cardRadius")} />
        <Slider label="Bordure de l'email" value={theme.borderWidth} min={0} max={6} onChange={n("borderWidth")} />
        {theme.borderWidth > 0 && <ColorField label="Couleur de bordure" value={theme.borderColor} onChange={(borderColor) => onChange({ borderColor })} />}
      </Section>
    </>
  );
}

import type { ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Minus, MonitorOff, MousePointerClick, Plus, RotateCcw, SmartphoneNfc, Type } from "lucide-react";
import { cx } from "../../lib/format";
import { Field, Input, Segmented, Select, Textarea } from "../ui/primitives";
import { ImageField } from "./media";
import { FONTS, SOCIAL_LABELS, THEME_SWATCHES, type Align, type Block, type BlockStyle, type ColumnItem, type SocialNetwork, type Theme } from "./model";

// --- Small controls ---------------------------------------------------------------

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
  return <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">{children}</p>;
}

export function ColorField({ label, value, onChange, allowEmpty, placeholder }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean; placeholder?: string }) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <label
          className={cx("relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-slate-900/15 dark:ring-white/15", !value && "bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:10px_10px]")}
          style={value ? { background: value } : undefined}
        >
          <input type="color" value={safe} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "#RRGGBB"} className="h-9 font-mono text-xs uppercase" />
        {allowEmpty && value && (
          <button type="button" onClick={() => onChange("")} className="rounded-full p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white" title="Par défaut" aria-label="Couleur par défaut">
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    </Field>
  );
}

function Slider({ label, value, min, max, step = 1, unit = "px", onChange, onReset }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; onReset?: () => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {value}
            {unit}
          </span>
          {onReset && (
            <button type="button" onClick={onReset} className="text-slate-400 hover:text-slate-900 dark:hover:text-white" title="Valeur par défaut" aria-label={`Réinitialiser ${label}`}>
              <RotateCcw className="size-3" />
            </button>
          )}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-500" />
    </div>
  );
}

function Toggle({ label, checked, onChange, icon: Icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: typeof Type }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
      <span className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-slate-400" strokeWidth={1.5} />}
        {label}
      </span>
      <span className={cx("relative h-5 w-9 rounded-full transition", checked ? "bg-brand-500" : "bg-slate-300 dark:bg-white/15")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </label>
  );
}

const EDIT_TIP = (
  <Hint>
    <MousePointerClick className="mr-1 inline size-3.5 -translate-y-px" />
    Cliquez directement dans le texte de l'email pour l'écrire. Sélectionnez un mot pour le mettre en gras, en italique ou ajouter un lien.
  </Hint>
);

// --- Block inspector ------------------------------------------------------------------

/** Default vertical paddings, used by the layout sliders. */
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

export function BlockInspector({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<Block>);
  const setStyle = (patch: Partial<BlockStyle>) => {
    const style = { ...block.style, ...patch };
    for (const k of Object.keys(style) as Array<keyof BlockStyle>) if (style[k] === undefined || style[k] === "" || style[k] === false) delete style[k];
    set({ style: Object.keys(style).length ? style : undefined });
  };
  const pads = DEFAULT_PAD[block.type];

  return (
    <>
      <Section title="Contenu">
        <ContentFields block={block} set={set} />
      </Section>
      {pads && (
        <Section title="Espacement & fond">
          <Slider label="Marge haute" value={block.style?.padTop ?? pads[0]} min={0} max={96} step={2} onChange={(padTop) => setStyle({ padTop })} onReset={block.style?.padTop !== undefined ? () => setStyle({ padTop: undefined }) : undefined} />
          <Slider label="Marge basse" value={block.style?.padBottom ?? pads[1]} min={0} max={96} step={2} onChange={(padBottom) => setStyle({ padBottom })} onReset={block.style?.padBottom !== undefined ? () => setStyle({ padBottom: undefined }) : undefined} />
          <ColorField label="Fond de la section" value={block.style?.bg ?? ""} onChange={(bg) => setStyle({ bg })} allowEmpty placeholder="Transparent" />
        </Section>
      )}
      <Section title="Visibilité" defaultOpen={!!(block.style?.hideMobile || block.style?.hideDesktop)}>
        <Toggle label="Masquer sur mobile" icon={SmartphoneNfc} checked={!!block.style?.hideMobile} onChange={(hideMobile) => setStyle({ hideMobile, hideDesktop: hideMobile ? undefined : block.style?.hideDesktop })} />
        <Toggle label="Masquer sur ordinateur" icon={MonitorOff} checked={!!block.style?.hideDesktop} onChange={(hideDesktop) => setStyle({ hideDesktop, hideMobile: hideDesktop ? undefined : block.style?.hideMobile })} />
      </Section>
    </>
  );
}

function ContentFields({ block, set }: { block: Block; set: (patch: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "logo":
      return (
        <>
          <Field label="Nom de la marque">
            <Input value={block.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <ImageField label="Logo (image)" value={block.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
          {block.imageUrl && <Slider label="Hauteur" value={block.height ?? 40} min={20} max={120} step={2} onChange={(height) => set({ height })} />}
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => set({ align })} />
          </Field>
        </>
      );
    case "heading":
      return (
        <>
          {EDIT_TIP}
          <Field label="Taille">
            <Segmented
              value={block.size}
              onChange={(size) => set({ size })}
              options={[
                { value: "md", label: "Moyen" },
                { value: "lg", label: "Grand" },
                { value: "xl", label: "Géant" },
              ]}
            />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => set({ align })} />
          </Field>
          <ColorField label="Couleur" value={block.color ?? ""} onChange={(color) => set({ color: color || undefined })} allowEmpty placeholder="Couleur du thème" />
        </>
      );
    case "text":
      return (
        <>
          {EDIT_TIP}
          <Field label="Taille du texte">
            <Segmented
              value={block.size ?? "md"}
              onChange={(size) => set({ size })}
              options={[
                { value: "sm", label: "Petit" },
                { value: "md", label: "Normal" },
                { value: "lg", label: "Grand" },
              ]}
            />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => set({ align })} />
          </Field>
        </>
      );
    case "quote":
      return (
        <>
          {EDIT_TIP}
          <Field label="Auteur">
            <Input value={block.author} onChange={(e) => set({ author: e.target.value })} />
          </Field>
        </>
      );
    case "image":
      return (
        <>
          <ImageField value={block.src} onChange={(src) => set({ src })} />
          <Field label="Texte alternatif" hint="Lu par les lecteurs d'écran et affiché si l'image est bloquée.">
            <Input value={block.alt} onChange={(e) => set({ alt: e.target.value })} placeholder="Décrivez l'image" />
          </Field>
          <Field label="Lien au clic">
            <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Slider label="Largeur" value={block.width ?? 100} min={20} max={100} step={5} unit="%" onChange={(width) => set({ width })} />
          <Field label="Alignement">
            <AlignPicker value={block.align ?? "center"} onChange={(align) => set({ align })} />
          </Field>
          <Toggle label="Coins arrondis" checked={block.rounded !== false} onChange={(rounded) => set({ rounded })} />
        </>
      );
    case "button":
      return (
        <>
          <Field label="Libellé">
            <Input value={block.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field label="Lien">
            <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => set({ align })} />
          </Field>
          <Toggle label="Pleine largeur" checked={block.full} onChange={(full) => set({ full })} />
          <ColorField label="Couleur du bouton" value={block.color ?? ""} onChange={(color) => set({ color: color || undefined })} allowEmpty placeholder="Accent du thème" />
          <ColorField label="Couleur du texte" value={block.textColor ?? ""} onChange={(textColor) => set({ textColor: textColor || undefined })} allowEmpty placeholder="Par défaut" />
        </>
      );
    case "product":
      return (
        <>
          <ImageField label="Photo du produit" value={block.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
          <Field label="Nom du produit">
            <Input value={block.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix">
              <Input value={block.price} onChange={(e) => set({ price: e.target.value })} />
            </Field>
            <Field label="Prix barré">
              <Input value={block.oldPrice} onChange={(e) => set({ oldPrice: e.target.value })} placeholder="—" />
            </Field>
          </div>
          <Field label="Lien du produit">
            <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="Texte du bouton">
            <Input value={block.cta} onChange={(e) => set({ cta: e.target.value })} />
          </Field>
        </>
      );
    case "columns": {
      const setItem = (i: number, patch: Partial<ColumnItem>) => set({ items: block.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
      return (
        <>
          <Field label="Nombre de colonnes" hint="Sur mobile, les colonnes s'empilent automatiquement.">
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
            <div key={i} className="space-y-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-900/[0.06] dark:bg-white/[0.03] dark:ring-white/10">
              <p className="font-display text-xs font-bold tracking-wider text-brand-500 uppercase">Colonne {i + 1}</p>
              <ImageField value={it.imageUrl} onChange={(imageUrl) => setItem(i, { imageUrl })} />
              <Field label="Lien">
                <Input value={it.href} onChange={(e) => setItem(i, { href: e.target.value })} placeholder="https://" />
              </Field>
              <Field label="Texte du lien">
                <Input value={it.cta} onChange={(e) => setItem(i, { cta: e.target.value })} />
              </Field>
            </div>
          ))}
        </>
      );
    }
    case "promo":
      return (
        <>
          <Field label="Code">
            <Input value={block.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} className="font-mono tracking-widest" />
          </Field>
          <Field label="Description">
            <Input value={block.caption} onChange={(e) => set({ caption: e.target.value })} />
          </Field>
        </>
      );
    case "video":
      return (
        <>
          <ImageField label="Miniature" value={block.thumbnail} onChange={(thumbnail) => set({ thumbnail })} />
          <Field label="Lien de la vidéo" hint="YouTube, Vimeo, Instagram… La vidéo s'ouvre au clic (les emails ne lisent pas les vidéos).">
            <Input value={block.href} onChange={(e) => set({ href: e.target.value })} placeholder="https://youtube.com/…" />
          </Field>
          <Field label="Légende">
            <Input value={block.caption} onChange={(e) => set({ caption: e.target.value })} />
          </Field>
        </>
      );
    case "social": {
      const all = Object.keys(SOCIAL_LABELS) as SocialNetwork[];
      const url = (n: SocialNetwork) => block.links.find((l) => l.network === n)?.url ?? "";
      const setUrl = (n: SocialNetwork, value: string) => {
        const links = all
          .map((net) => ({ network: net, url: net === n ? value : url(net) }))
          .filter((l) => l.url !== "");
        set({ links });
      };
      return (
        <>
          <p className="text-xs text-slate-500">Laissez vide un réseau pour le masquer.</p>
          {all.map((n) => (
            <Field key={n} label={SOCIAL_LABELS[n]}>
              <Input value={url(n)} onChange={(e) => setUrl(n, e.target.value)} placeholder="https://" className="h-9 text-xs" />
            </Field>
          ))}
          <Field label="Alignement">
            <AlignPicker value={block.align} onChange={(align) => set({ align })} />
          </Field>
        </>
      );
    }
    case "divider":
      return (
        <>
          <Slider label="Épaisseur" value={block.thickness ?? 1} min={1} max={8} onChange={(thickness) => set({ thickness })} />
          <ColorField label="Couleur" value={block.color ?? ""} onChange={(color) => set({ color: color || undefined })} allowEmpty placeholder="Discrète (auto)" />
        </>
      );
    case "spacer":
      return <Slider label="Hauteur" value={block.height} min={4} max={200} step={4} onChange={(height) => set({ height })} />;
    case "html":
      return (
        <Field label="Code HTML" hint="Utilisez des styles en ligne : les clients mail ignorent la plupart des feuilles de style.">
          <Textarea rows={12} value={block.html} onChange={(e) => set({ html: e.target.value })} spellCheck={false} className="font-mono text-xs" />
        </Field>
      );
    case "footer":
      return (
        <>
          {EDIT_TIP}
          <p className="text-xs text-slate-500">Le lien « Se désinscrire » est ajouté automatiquement : il est obligatoire.</p>
        </>
      );
  }
}

// --- Theme inspector ----------------------------------------------------------------------

export function ThemeInspector({ theme, onChange }: { theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  return (
    <>
      <Section title="Ambiance">
        <div className="grid grid-cols-3 gap-2">
          {THEME_SWATCHES.map((s) => {
            const active = theme.accent === s.theme.accent && theme.background === s.theme.background && theme.text === s.theme.text;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => onChange(s.theme)}
                className={cx("overflow-hidden rounded-xl text-left ring-1 transition hover:-translate-y-0.5", active ? "ring-2 ring-brand-500" : "ring-slate-900/10 dark:ring-white/10")}
              >
                <span className="flex h-12 items-end gap-1 p-2" style={{ background: s.theme.background }}>
                  <span className="h-6 flex-1 rounded-md" style={{ background: s.theme.surface }} />
                  <span className="h-3 w-5 rounded-full" style={{ background: s.theme.accent }} />
                </span>
                <span className="block px-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{s.name}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Couleurs">
        <ColorField label="Fond extérieur" value={theme.background} onChange={(background) => onChange({ background })} />
        <ColorField label="Fond de l'email" value={theme.surface} onChange={(surface) => onChange({ surface })} />
        <ColorField label="Texte" value={theme.text} onChange={(text) => onChange({ text })} />
        <ColorField label="Accent (boutons, liens)" value={theme.accent} onChange={(accent) => onChange({ accent })} />
        <ColorField label="Texte des boutons" value={theme.accentText} onChange={(accentText) => onChange({ accentText })} />
      </Section>
      <Section title="Typographie & formes">
        <Field label="Police des titres" hint="Polices sûres, affichées pareil dans tous les clients mail.">
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
            value={String(theme.radius >= 999 ? 999 : theme.radius >= 10 ? 12 : theme.radius >= 4 ? 6 : 0)}
            onChange={(v) => onChange({ radius: Number(v) })}
            options={[
              { value: "0", label: "Carré" },
              { value: "6", label: "Doux" },
              { value: "12", label: "Arrondi" },
              { value: "999", label: "Pilule" },
            ]}
          />
        </Field>
      </Section>
      <div className="px-5 py-4">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Minus className="size-3" /> Sélectionnez un bloc dans l'email pour le modifier.
        </p>
      </div>
    </>
  );
}

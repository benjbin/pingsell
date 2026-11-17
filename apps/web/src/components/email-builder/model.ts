/**
 * Visual email builder — data model, presets and the email-safe HTML renderer.
 *
 * A design is a list of blocks plus a theme. Each block renders to a self-contained,
 * table-based HTML snippet with inline styles. The same renderer produces the
 * on-canvas WYSIWYG view (with inline-editable fields) and the final email.
 *
 * Text fields come in two kinds:
 *  - rich  (heading, text, footer, quote): sanitized HTML limited to <strong>, <em>, <u>, <a>, <br>;
 *  - plain (button labels, prices, codes…): plain strings.
 * Merge tags such as {{first_name|}} are kept verbatim and replaced at send time.
 */

export type Align = "left" | "center" | "right";

export interface BlockStyle {
  /** Extra vertical padding override, in px. */
  padTop?: number;
  padBottom?: number;
  /** Section background behind the block. */
  bg?: string;
  hideMobile?: boolean;
  hideDesktop?: boolean;
}

export interface ColumnItem {
  imageUrl: string;
  title: string;
  text: string;
  href: string;
  cta: string;
}

export type SocialNetwork = "instagram" | "facebook" | "tiktok" | "x" | "linkedin" | "youtube" | "pinterest" | "website";

type Base = { id: string; style?: BlockStyle };

export type Block = Base &
  (
    | { type: "logo"; text: string; imageUrl: string; align: Align; height?: number }
    | { type: "heading"; text: string; size: "xl" | "lg" | "md"; align: Align; color?: string }
    | { type: "text"; text: string; align: Align; size?: "sm" | "md" | "lg" }
    | { type: "image"; src: string; alt: string; href: string; width?: number; align?: Align; rounded?: boolean }
    | { type: "button"; label: string; href: string; align: Align; full: boolean; color?: string; textColor?: string }
    | { type: "product"; imageUrl: string; title: string; price: string; oldPrice: string; href: string; cta: string }
    | { type: "columns"; items: ColumnItem[] }
    | { type: "promo"; code: string; caption: string }
    | { type: "quote"; text: string; author: string }
    | { type: "video"; thumbnail: string; href: string; caption: string }
    | { type: "social"; align: Align; links: Array<{ network: SocialNetwork; url: string }> }
    | { type: "divider"; color?: string; thickness?: number }
    | { type: "spacer"; height: number }
    | { type: "html"; html: string }
    | { type: "footer"; text: string }
  );

export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export interface Theme {
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  font: "sans" | "serif" | "geometric" | "humanist";
  radius: number;
}

export interface Design {
  version: 2;
  theme: Theme;
  blocks: Block[];
}

export const FONTS: Record<Theme["font"], { label: string; heading: string; body: string }> = {
  sans: { label: "Moderne (Helvetica)", heading: "Helvetica, Arial, sans-serif", body: "Helvetica, Arial, sans-serif" },
  geometric: {
    label: "Géométrique (Futura)",
    heading: "Futura, 'Century Gothic', 'Trebuchet MS', Helvetica, sans-serif",
    body: "Helvetica, Arial, sans-serif",
  },
  humanist: { label: "Humaniste (Verdana)", heading: "Verdana, Geneva, sans-serif", body: "Verdana, Geneva, sans-serif" },
  serif: { label: "Éditorial (Georgia)", heading: "Georgia, 'Times New Roman', serif", body: "Helvetica, Arial, sans-serif" },
};

export const DEFAULT_THEME: Theme = {
  background: "#EEF2F8",
  surface: "#FFFFFF",
  text: "#0B214A",
  accent: "#145CFF",
  accentText: "#FFFFFF",
  font: "sans",
  radius: 12,
};

export const THEME_SWATCHES: Array<{ name: string; theme: Partial<Theme> }> = [
  { name: "Neokrome", theme: { background: "#EEF2F8", surface: "#FFFFFF", text: "#0B214A", accent: "#145CFF", accentText: "#FFFFFF" } },
  { name: "Encre", theme: { background: "#F3F1EA", surface: "#FFFFFF", text: "#0E0E0C", accent: "#0E0E0C", accentText: "#FFFFFF" } },
  { name: "Vermillon", theme: { background: "#FFF3EE", surface: "#FFFFFF", text: "#1A1A18", accent: "#FF4D1C", accentText: "#FFFFFF" } },
  { name: "Forêt", theme: { background: "#EEF2EC", surface: "#FFFFFF", text: "#16241B", accent: "#1F4D36", accentText: "#FFFFFF" } },
  { name: "Océan", theme: { background: "#EDF2F7", surface: "#FFFFFF", text: "#0F1E2E", accent: "#1D4ED8", accentText: "#FFFFFF" } },
  { name: "Nuit", theme: { background: "#071733", surface: "#0B214A", text: "#FFFFFF", accent: "#145CFF", accentText: "#FFFFFF" } },
];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
  website: "Site web",
};

export const MERGE_TAGS: Array<{ tag: string; label: string }> = [
  { tag: "{{first_name|}}", label: "Prénom" },
  { tag: "{{last_name|}}", label: "Nom" },
  { tag: "{{email}}", label: "Email" },
];

// --- Factories --------------------------------------------------------------

let counter = 0;
export function uid(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type BlockCategory = "Contenu" | "Commerce" | "Mise en page";

export const BLOCK_LIBRARY: Array<{ type: BlockType; label: string; hint: string; category: BlockCategory }> = [
  { type: "heading", label: "Titre", hint: "Grand titre accrocheur", category: "Contenu" },
  { type: "text", label: "Texte", hint: "Paragraphe mis en forme", category: "Contenu" },
  { type: "image", label: "Image", hint: "Visuel, avec lien optionnel", category: "Contenu" },
  { type: "button", label: "Bouton", hint: "Appel à l'action", category: "Contenu" },
  { type: "quote", label: "Citation", hint: "Avis client, témoignage", category: "Contenu" },
  { type: "video", label: "Vidéo", hint: "Miniature cliquable", category: "Contenu" },
  { type: "product", label: "Produit", hint: "Photo, prix, lien", category: "Commerce" },
  { type: "columns", label: "Colonnes", hint: "2 ou 3 cartes côte à côte", category: "Commerce" },
  { type: "promo", label: "Code promo", hint: "Code à copier", category: "Commerce" },
  { type: "logo", label: "Logo", hint: "Nom ou image de marque", category: "Mise en page" },
  { type: "social", label: "Réseaux", hint: "Liens vers vos réseaux", category: "Mise en page" },
  { type: "divider", label: "Séparateur", hint: "Ligne fine", category: "Mise en page" },
  { type: "spacer", label: "Espace", hint: "Respiration verticale", category: "Mise en page" },
  { type: "html", label: "HTML", hint: "Code personnalisé", category: "Mise en page" },
  { type: "footer", label: "Pied de page", hint: "Mentions + désinscription", category: "Mise en page" },
];

const emptyColumn = (n: number): ColumnItem => ({
  imageUrl: "",
  title: `Produit ${n}`,
  text: "Une courte description.",
  href: "https://",
  cta: "Voir",
});

export function createBlock(type: BlockType, brand = "Votre marque"): Block {
  const id = uid();
  switch (type) {
    case "logo":
      return { id, type, text: brand, imageUrl: "", align: "center", height: 40 };
    case "heading":
      return { id, type, text: "Un titre qui donne envie", size: "lg", align: "left" };
    case "text":
      return {
        id,
        type,
        text: "Bonjour {{first_name|}},<br><br>Racontez ici votre nouveauté, votre offre ou votre histoire. Restez court : une idée, une émotion, une action.",
        align: "left",
        size: "md",
      };
    case "image":
      return { id, type, src: "", alt: "", href: "", width: 100, align: "center", rounded: true };
    case "button":
      return { id, type, label: "Découvrir", href: "https://", align: "left", full: false };
    case "product":
      return { id, type, imageUrl: "", title: "Nom du produit", price: "49 €", oldPrice: "", href: "https://", cta: "Voir le produit" };
    case "columns":
      return { id, type, items: [emptyColumn(1), emptyColumn(2)] };
    case "promo":
      return { id, type, code: "BIENVENUE10", caption: "-10 % sur votre première commande" };
    case "quote":
      return { id, type, text: "« Livraison rapide, produit superbe. Je recommande les yeux fermés. »", author: "Camille, cliente depuis 2024" };
    case "video":
      return { id, type, thumbnail: "", href: "https://", caption: "Regarder la vidéo" };
    case "social":
      return {
        id,
        type,
        align: "center",
        links: [
          { network: "instagram", url: "https://instagram.com/" },
          { network: "facebook", url: "https://facebook.com/" },
          { network: "tiktok", url: "https://tiktok.com/" },
        ],
      };
    case "divider":
      return { id, type, thickness: 1 };
    case "spacer":
      return { id, type, height: 24 };
    case "html":
      return { id, type, html: '<p style="margin:0;text-align:center;">Votre HTML ici</p>' };
    case "footer":
      return { id, type, text: `${esc(brand)} · Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.` };
  }
}

export function cloneBlock(block: Block): Block {
  return structuredClone({ ...block, id: uid() }) as Block;
}

/** Fields that hold rich HTML (vs plain text). */
export const RICH_FIELDS = new Set(["heading.text", "text.text", "footer.text", "quote.text"]);

// --- Presets ----------------------------------------------------------------

export interface Preset {
  key: string;
  name: string;
  description: string;
  subject: string;
  preheader: string;
  build: (brand: string) => Design;
}

const T = (overrides: Partial<Theme> = {}): Theme => ({ ...DEFAULT_THEME, ...overrides });
const H = (text: string, size: BlockOf<"heading">["size"], align: Align = "left"): Block => ({ id: uid(), type: "heading", text, size, align });
const P = (text: string, align: Align = "left"): Block => ({ id: uid(), type: "text", text, align, size: "md" });
const BTN = (label: string, align: Align = "left", full = false): Block => ({ id: uid(), type: "button", label, href: "https://", align, full });

export const PRESETS: Preset[] = [
  {
    key: "blank",
    name: "Page blanche",
    description: "Logo, titre, texte, bouton.",
    subject: "",
    preheader: "",
    build: (brand) => ({
      version: 2,
      theme: T(),
      blocks: [createBlock("logo", brand), createBlock("heading"), createBlock("text"), createBlock("button"), createBlock("footer", brand)],
    }),
  },
  {
    key: "sale",
    name: "Soldes",
    description: "Grosse remise, code promo, produits.",
    subject: "{{first_name|}}, -20 % sur tout, ce week-end seulement",
    preheader: "Vos prix préférés n'ont jamais été aussi bas.",
    build: (brand) => ({
      version: 2,
      theme: T({ background: "#FFF3EE", accent: "#FF4D1C", text: "#1A1A18" }),
      blocks: [
        createBlock("logo", brand),
        H("-20 %<br>sur tout.", "xl"),
        P("Bonjour {{first_name|}},<br><br>Ce week-end seulement, toute la boutique passe à <strong>-20 %</strong>. Les quantités sont limitées : vos favoris n'attendront pas."),
        { id: uid(), type: "promo", code: "SOLDES20", caption: "À saisir au moment du paiement · jusqu'à dimanche minuit" },
        {
          id: uid(),
          type: "columns",
          items: [
            { imageUrl: "", title: "Pull mérinos", text: "<s>89 €</s> 71,20 €", href: "https://", cta: "J'en profite" },
            { imageUrl: "", title: "Écharpe en laine", text: "<s>45 €</s> 36 €", href: "https://", cta: "J'en profite" },
          ],
        },
        BTN("Voir toute la boutique", "center", true),
        createBlock("social"),
        createBlock("footer", brand),
      ],
    }),
  },
  {
    key: "launch",
    name: "Nouveauté",
    description: "Lancement de produit, visuel fort.",
    subject: "Nouveau : on l'attendait depuis longtemps",
    preheader: "Découvrez-le en avant-première.",
    build: (brand) => ({
      version: 2,
      theme: T({ background: "#071733", surface: "#0B214A", text: "#FFFFFF", accent: "#145CFF", accentText: "#FFFFFF" }),
      blocks: [
        createBlock("logo", brand),
        createBlock("image"),
        H("La nouvelle collection est là.", "xl", "center"),
        P("{{first_name|Bonjour}}, vous êtes parmi les premiers à la découvrir. Des pièces pensées pour durer, en quantités limitées.", "center"),
        BTN("Découvrir la collection", "center"),
        createBlock("footer", brand),
      ],
    }),
  },
  {
    key: "welcome",
    name: "Bienvenue",
    description: "Premier email après inscription.",
    subject: "Bienvenue {{first_name|}} 👋",
    preheader: "Un petit cadeau pour bien commencer.",
    build: (brand) => ({
      version: 2,
      theme: T({ background: "#EEF2EC", accent: "#1F4D36", text: "#16241B" }),
      blocks: [
        createBlock("logo", brand),
        H("Bienvenue dans la famille.", "xl"),
        P(`Bonjour {{first_name|}},<br><br>Merci de nous avoir rejoints ! Chez ${esc(brand)}, on aime les choses bien faites. Pour fêter votre arrivée, voici un petit cadeau :`),
        { id: uid(), type: "promo", code: "BIENVENUE10", caption: "-10 % sur votre première commande" },
        BTN("Faire mon premier achat"),
        createBlock("quote"),
        createBlock("footer", brand),
      ],
    }),
  },
  {
    key: "cart",
    name: "Panier abandonné",
    description: "Relance douce avec le produit.",
    subject: "{{first_name|}}, vous avez oublié quelque chose",
    preheader: "Votre panier vous attend encore.",
    build: (brand) => ({
      version: 2,
      theme: T(),
      blocks: [
        createBlock("logo", brand),
        H("Votre panier vous attend.", "lg"),
        P("Bonjour {{first_name|}},<br><br>Vous étiez à deux clics de craquer. On a mis votre sélection de côté, mais pas pour longtemps."),
        { id: uid(), type: "product", imageUrl: "", title: "Votre article", price: "59 €", oldPrice: "", href: "https://", cta: "Finaliser ma commande" },
        P("Une question ? Répondez simplement à cet email, on vous répond dans la journée."),
        createBlock("footer", brand),
      ],
    }),
  },
  {
    key: "newsletter",
    name: "Newsletter",
    description: "Édito + plusieurs sujets.",
    subject: "Les nouvelles du mois chez nous",
    preheader: "Coulisses, nouveautés et coups de cœur.",
    build: (brand) => ({
      version: 2,
      theme: T({ background: "#EDF2F7", accent: "#1D4ED8", text: "#0F1E2E", font: "serif" }),
      blocks: [
        createBlock("logo", brand),
        H("L'édito", "lg"),
        P("Bonjour {{first_name|}},<br><br>Ce mois-ci, on vous emmène dans les coulisses de l'atelier et on vous présente nos trois coups de cœur."),
        createBlock("divider"),
        createBlock("video"),
        H("Nos coups de cœur", "md"),
        { id: uid(), type: "columns", items: [emptyColumn(1), emptyColumn(2), emptyColumn(3)] },
        BTN("Lire la suite"),
        createBlock("social"),
        createBlock("footer", brand),
      ],
    }),
  },
];

// --- Serialization ------------------------------------------------------------

/** Legacy (v1) text: escaped, **bold** and line breaks. */
function legacyRich(value: string): string {
  return esc(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function upgradeBlock(b: Block): Block {
  if (b.type === "heading" || b.type === "text") return { ...b, text: legacyRich(b.text) };
  if (b.type === "footer") return { ...b, text: legacyRich(b.text) };
  return b;
}

export function parseDesign(raw: string | null | undefined): Design | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { version: number; theme: Theme; blocks: Block[] };
    if (!d || !Array.isArray(d.blocks) || !d.theme) return null;
    if (d.version === 1) return { version: 2, theme: { ...DEFAULT_THEME, ...d.theme }, blocks: d.blocks.map(upgradeBlock) };
    if (d.version === 2) return { version: 2, theme: { ...DEFAULT_THEME, ...d.theme }, blocks: d.blocks };
  } catch {
    /* invalid JSON → treated as no design */
  }
  return null;
}

export function serializeDesign(design: Design): string {
  return JSON.stringify(design);
}

// --- Sanitizing (browser) ---------------------------------------------------------

const TAG_RE = /^\{\{\s*[a-z_]+\s*(\|[^}]*)?\}\}$/;
const SAFE_URL = /^(https?:|mailto:|tel:|\{\{)/i;

/**
 * Turns contentEditable output into the restricted rich-text dialect.
 * Merge-tag chips (`<span data-tag="{{…}}">`) are turned back into their tag.
 */
export function sanitizeRich(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out: string[] = [];
  const walk = (node: Node, isRoot = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(esc(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const dataTag = el.getAttribute("data-tag");
    if (dataTag && TAG_RE.test(dataTag)) {
      out.push(dataTag);
      return;
    }
    if (tag === "br") {
      out.push("<br>");
      return;
    }
    if (tag === "script" || tag === "style") return;
    const block = !isRoot && (tag === "div" || tag === "p");
    if (block && out.length && out[out.length - 1] !== "<br>") out.push("<br>");
    const style = el.getAttribute("style") ?? "";
    const map: Record<string, string> = { b: "strong", strong: "strong", i: "em", em: "em", u: "u", s: "s", strike: "s" };
    let open = "";
    let close = "";
    if (map[tag]) {
      open = `<${map[tag]}>`;
      close = `</${map[tag]}>`;
    } else if (tag === "a") {
      const href = (el.getAttribute("href") ?? "").trim();
      if (SAFE_URL.test(href)) {
        open = `<a href="${esc(href)}">`;
        close = "</a>";
      }
    } else if (tag === "span") {
      // execCommand may produce styled spans instead of tags.
      if (/font-weight:\s*(bold|[6-9]00)/.test(style)) (open += "<strong>"), (close = "</strong>" + close);
      if (/font-style:\s*italic/.test(style)) (open += "<em>"), (close = "</em>" + close);
      if (/text-decoration[^;]*underline/.test(style)) (open += "<u>"), (close = "</u>" + close);
    }
    out.push(open);
    el.childNodes.forEach((c) => walk(c));
    out.push(close);
  };
  walk(doc.body.firstChild as Node, true);
  return out
    .join("")
    .replace(/(<br>)+$/, "")
    .replace(/<(strong|em|u|s)><\/\1>/g, "");
}

/** Plain text from an editable element, keeping merge tags. */
export function extractPlain(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-tag]").forEach((chip) => chip.replaceWith(chip.getAttribute("data-tag") ?? ""));
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

// --- Rendering ------------------------------------------------------------------

export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHref(href: string): string {
  const h = href.trim();
  if (!h || h === "https://") return "#";
  if (SAFE_URL.test(h)) return esc(h);
  return esc(`https://${h}`);
}

export function mix(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const TAG_LABELS: Record<string, string> = { first_name: "Prénom", last_name: "Nom", email: "Email", unsubscribe_url: "Lien désinscription" };

/** Canvas only: show merge tags as non-editable chips (outside of HTML tags). */
function chipify(html: string): string {
  return html
    .split(/(<[^>]+>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(/\{\{\s*([a-z_]+)\s*(\|[^}]*)?\}\}/g, (m, key: string) => {
            const label = TAG_LABELS[key] ?? key;
            return `<span data-tag="${esc(m)}" contenteditable="false" style="display:inline-block;padding:0 6px;margin:0 1px;border-radius:6px;background:rgba(20,92,255,0.12);color:#145CFF;font-size:0.85em;font-weight:600;line-height:1.5;vertical-align:baseline;">${label}</span>`;
          }),
    )
    .join("");
}

interface Ctx {
  theme: Theme;
  canvas: boolean;
  editable: boolean;
}

/** Output for an editable field. `path` is the block field (e.g. "text", "items.0.title"). */
function field(ctx: Ctx, path: string, value: string, rich: boolean, linkColor?: string): string {
  let html = rich ? value : esc(value);
  if (rich && linkColor) html = html.replace(/<a href="([^"]*)">/g, `<a href="$1" target="_blank" style="color:${linkColor};text-decoration:underline;">`);
  if (!ctx.canvas) return html;
  html = chipify(html);
  if (!ctx.editable) return html;
  return `<span data-edit="${path}"${rich ? ' data-rich="1"' : ""} contenteditable="true" spellcheck="true" style="outline:none;display:inline-block;min-width:1ch;width:100%;">${html}</span>`;
}

/** Inline field (inside buttons, prices…): no full width. */
function inlineField(ctx: Ctx, path: string, value: string): string {
  if (!ctx.canvas) return esc(value);
  const html = chipify(esc(value));
  if (!ctx.editable) return html;
  return `<span data-edit="${path}" contenteditable="true" spellcheck="true" style="outline:none;min-width:1ch;">${html}</span>`;
}

function pad(block: Block, top: number, bottom: number, x = 40): string {
  const t = block.style?.padTop ?? top;
  const b = block.style?.padBottom ?? bottom;
  return `${t}px ${x}px ${b}px`;
}

function row(inner: string, padding: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:${padding};">${inner}</td></tr></table>`;
}

function buttonHtml(ctx: Ctx, label: string, href: string, full: boolean, path: string, colors?: { bg?: string; fg?: string }): string {
  const { theme } = ctx;
  const radius = Math.min(theme.radius, 999);
  const bg = colors?.bg || theme.accent;
  const fg = colors?.fg || theme.accentText;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ""} style="border-collapse:separate;"><tr><td align="center" bgcolor="${bg}" style="background:${bg};border-radius:${radius}px;"><a href="${safeHref(href)}" target="_blank" style="display:${full ? "block" : "inline-block"};padding:15px 30px;font-family:${FONTS[theme.font].body};font-size:15px;font-weight:bold;letter-spacing:0.01em;color:${fg};text-decoration:none;border-radius:${radius}px;">${inlineField(ctx, path, label)}</a></td></tr></table>`;
}

function placeholder(ctx: Ctx, height: number, label: string): string {
  return `<div style="height:${height}px;border:1.5px dashed ${mix(ctx.theme.text, 0.25)};border-radius:12px;background:${mix(ctx.theme.text, 0.03)};display:flex;align-items:center;justify-content:center;text-align:center;font-family:${FONTS.sans.body};font-size:13px;color:${mix(ctx.theme.text, 0.55)};">${label}</div>`;
}

function inner(block: Block, ctx: Ctx): string {
  const { theme } = ctx;
  const f = FONTS[theme.font];
  const muted = mix(theme.text, 0.6);
  const bold = theme.font === "serif" ? "normal" : "bold";
  switch (block.type) {
    case "logo": {
      const h = block.height ?? 40;
      const content = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.text)}" height="${h}" style="display:inline-block;height:${h}px;width:auto;border:0;">`
        : `<span style="font-family:${f.heading};font-size:24px;font-weight:${bold};letter-spacing:-0.01em;color:${theme.text};">${inlineField(ctx, "text", block.text)}</span>`;
      return row(`<div style="text-align:${block.align};">${content}</div>`, pad(block, 32, 24));
    }
    case "heading": {
      const size = block.size === "xl" ? 48 : block.size === "lg" ? 34 : 22;
      return row(
        `<h1 style="margin:0;font-family:${f.heading};font-size:${size}px;line-height:1.08;font-weight:${bold};letter-spacing:-0.02em;color:${block.color || theme.text};text-align:${block.align};">${field(ctx, "text", block.text, true, theme.accent)}</h1>`,
        pad(block, 12, 12),
      );
    }
    case "text": {
      const size = block.size === "sm" ? 14 : block.size === "lg" ? 18 : 16;
      return row(
        `<div style="margin:0;font-family:${f.body};font-size:${size}px;line-height:1.65;color:${mix(theme.text, 0.82)};text-align:${block.align};">${field(ctx, "text", block.text, true, theme.accent)}</div>`,
        pad(block, 10, 10),
      );
    }
    case "image": {
      if (!block.src) return ctx.canvas ? row(placeholder(ctx, 220, "Glissez une image ici<br>ou choisissez-la dans le panneau de droite"), pad(block, 12, 12)) : "";
      const w = Math.round((520 * (block.width ?? 100)) / 100);
      const radius = block.rounded === false ? 0 : 12;
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt)}" width="${w}" style="display:inline-block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:${radius}px;">`;
      return row(`<div style="text-align:${block.align ?? "center"};">${block.href ? `<a href="${safeHref(block.href)}" target="_blank">${img}</a>` : img}</div>`, pad(block, 12, 12));
    }
    case "button": {
      const btn = buttonHtml(ctx, block.label, block.href, block.full, "label", { bg: block.color, fg: block.textColor });
      return row(`<div style="text-align:${block.align};">${block.full ? btn : `<div style="display:inline-block;">${btn}</div>`}</div>`, pad(block, 18, 18));
    }
    case "product": {
      const img = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.title)}" width="200" style="display:block;width:100%;max-width:200px;height:auto;border:0;border-radius:10px;">`
        : ctx.canvas
          ? placeholder(ctx, 200, "Photo")
          : "";
      const old = block.oldPrice ? ` <span style="font-size:14px;font-weight:normal;text-decoration:line-through;color:${muted};">${inlineField(ctx, "oldPrice", block.oldPrice)}</span>` : "";
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${mix(theme.text, 0.12)};border-radius:14px;"><tr>
<td class="col" width="200" valign="top" style="padding:16px;">${img}</td>
<td class="col" valign="middle" style="padding:16px 20px 16px 4px;font-family:${f.body};">
<p style="margin:0 0 6px;font-family:${f.heading};font-size:22px;line-height:1.2;font-weight:${bold};color:${theme.text};">${inlineField(ctx, "title", block.title)}</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:${theme.text};">${inlineField(ctx, "price", block.price)}${old}</p>
${buttonHtml(ctx, block.cta, block.href, false, "cta")}
</td></tr></table>`,
        pad(block, 12, 12),
      );
    }
    case "columns": {
      const n = block.items.length;
      const gap = 12;
      const imgW = Math.floor((520 - gap * (n - 1)) / n);
      const cells = block.items
        .map((it, i) => {
          const img = it.imageUrl
            ? `<img src="${esc(it.imageUrl)}" alt="${esc(it.title)}" width="${imgW}" style="display:block;width:100%;height:auto;border:0;border-radius:10px;">`
            : ctx.canvas
              ? placeholder(ctx, Math.round(imgW * 0.9), "Image")
              : "";
          const link = it.cta
            ? `<a href="${safeHref(it.href)}" target="_blank" style="font-family:${f.body};font-size:14px;font-weight:bold;color:${theme.accent};text-decoration:none;">${inlineField(ctx, `items.${i}.cta`, it.cta)} →</a>`
            : "";
          return `<td class="col" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 ${i < n - 1 ? gap / 2 : 0}px 0 ${i > 0 ? gap / 2 : 0}px;">
${img}
<p style="margin:12px 0 4px;font-family:${f.heading};font-size:17px;line-height:1.25;font-weight:${bold};color:${theme.text};">${inlineField(ctx, `items.${i}.title`, it.title)}</p>
<div style="margin:0 0 10px;font-family:${f.body};font-size:14px;line-height:1.5;color:${muted};">${field(ctx, `items.${i}.text`, it.text, true, theme.accent)}</div>
${link}
</td>`;
        })
        .join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, pad(block, 14, 14));
    }
    case "promo":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px dashed ${theme.accent};border-radius:14px;"><tr><td align="center" style="padding:22px 16px;font-family:${f.body};">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${muted};">Votre code</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:28px;font-weight:bold;letter-spacing:0.12em;color:${theme.text};">${inlineField(ctx, "code", block.code)}</p>
<p style="margin:8px 0 0;font-size:13px;color:${muted};">${inlineField(ctx, "caption", block.caption)}</p>
</td></tr></table>`,
        pad(block, 14, 14),
      );
    case "quote":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${theme.accent};padding:4px 0 4px 20px;">
<div style="font-family:${f.heading};font-size:20px;line-height:1.45;color:${theme.text};">${field(ctx, "text", block.text, true, theme.accent)}</div>
<p style="margin:10px 0 0;font-family:${f.body};font-size:13px;color:${muted};">— ${inlineField(ctx, "author", block.author)}</p>
</td></tr></table>`,
        pad(block, 16, 16),
      );
    case "video": {
      const thumb = block.thumbnail
        ? `<a href="${safeHref(block.href)}" target="_blank" style="display:block;position:relative;"><img src="${esc(block.thumbnail)}" alt="${esc(block.caption)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px;"></a>`
        : ctx.canvas
          ? placeholder(ctx, 260, "▶&nbsp; Miniature de la vidéo")
          : "";
      return row(
        `${thumb}<p style="margin:12px 0 0;text-align:center;font-family:${f.body};font-size:14px;font-weight:bold;"><a href="${safeHref(block.href)}" target="_blank" style="color:${theme.accent};text-decoration:none;">▶&nbsp; ${inlineField(ctx, "caption", block.caption)}</a></p>`,
        pad(block, 12, 12),
      );
    }
    case "social": {
      const links = block.links
        .filter((l) => l.url.trim() && l.url.trim() !== "https://")
        .map(
          (l) =>
            `<a href="${safeHref(l.url)}" target="_blank" style="display:inline-block;margin:4px;padding:8px 14px;border:1px solid ${mix(theme.text, 0.18)};border-radius:999px;font-family:${f.body};font-size:13px;font-weight:bold;color:${theme.text};text-decoration:none;">${SOCIAL_LABELS[l.network]}</a>`,
        )
        .join("");
      if (!links) return ctx.canvas ? row(placeholder(ctx, 60, "Ajoutez vos liens de réseaux sociaux"), pad(block, 12, 12)) : "";
      return row(`<div style="text-align:${block.align};">${links}</div>`, pad(block, 16, 16));
    }
    case "divider": {
      const t = Math.max(1, Math.min(8, block.thickness ?? 1));
      return row(`<div style="height:${t}px;line-height:${t}px;font-size:0;background:${block.color || mix(theme.text, 0.14)};">&nbsp;</div>`, pad(block, 18, 18));
    }
    case "spacer":
      return `<div style="height:${Math.max(4, Math.min(200, block.height))}px;line-height:1px;font-size:0;">&nbsp;</div>`;
    case "html":
      return row(block.html || (ctx.canvas ? placeholder(ctx, 60, "Bloc HTML vide") : ""), pad(block, 12, 12));
    case "footer":
      return row(
        `<div style="border-top:1px solid ${mix(theme.text, 0.12)};padding-top:24px;font-family:${f.body};font-size:12px;line-height:1.6;color:${muted};text-align:center;">${field(ctx, "text", block.text, true, muted)}<br><a href="{{unsubscribe_url}}" style="color:${muted};text-decoration:underline;">Se désinscrire</a></div>`,
        pad(block, 28, 36),
      );
  }
}

/** Renders a single block. `canvas` adds placeholders and (if `editable`) inline-editable fields. */
export function renderBlock(block: Block, theme: Theme, opts: { canvas?: boolean; editable?: boolean } = {}): string {
  const ctx: Ctx = { theme, canvas: !!opts.canvas, editable: !!opts.editable };
  const html = inner(block, ctx);
  if (!html) return "";
  const s = block.style;
  const cls = [s?.hideMobile ? "hide-m" : "", s?.hideDesktop ? "hide-d" : ""].filter(Boolean).join(" ");
  if (!s?.bg && !cls) return html;
  if (ctx.canvas) return s?.bg ? `<div style="background:${s.bg};">${html}</div>` : html;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${cls ? ` class="${cls}"` : ""}${s?.bg ? ` bgcolor="${s.bg}" style="background:${s.bg};"` : ""}><tr><td>${html}</td></tr></table>`;
}

/** Full, standalone email document. Always contains an unsubscribe link. */
export function renderEmail(design: Design, preheader = ""): string {
  const { theme } = design;
  const body = design.blocks.map((b) => renderBlock(b, theme)).join("\n");
  const hasFooter = design.blocks.some((b) => b.type === "footer");
  const footer = hasFooter
    ? ""
    : row(
        `<div style="font-family:${FONTS.sans.body};font-size:12px;color:${mix(theme.text, 0.6)};text-align:center;"><a href="{{unsubscribe_url}}" style="color:${mix(theme.text, 0.6)};">Se désinscrire</a></div>`,
        "24px 40px 32px",
      );
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
<style>
  .hide-d { display: table; }
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; border-radius: 0 !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .col { display: block !important; width: 100% !important; padding: 0 0 18px 0 !important; }
    .hide-m { display: none !important; }
    h1 { font-size: 34px !important; }
  }
  @media only screen and (min-width: 621px) {
    .hide-d { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${theme.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.background}" style="background:${theme.background};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.surface}" style="width:600px;max-width:600px;background:${theme.surface};border-radius:20px;overflow:hidden;">
<tr><td>
${body}
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// --- Field paths ------------------------------------------------------------------

/** Immutable set of a (possibly nested) field such as "items.1.title". */
export function setPath(block: Block, path: string, value: string): Block {
  const keys = path.split(".");
  const next = structuredClone(block) as unknown as Record<string, unknown>;
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
  return next as unknown as Block;
}

export function isRichPath(block: Block, path: string): boolean {
  return RICH_FIELDS.has(`${block.type}.${path}`) || (block.type === "columns" && /^items\.\d+\.text$/.test(path));
}

/** Short human summary of a block, for the layers panel. */
export function blockSummary(block: Block): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\{\{\s*([a-z_]+)[^}]*\}\}/g, "[$1]").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  switch (block.type) {
    case "heading":
    case "text":
    case "quote":
    case "footer":
      return strip(block.text);
    case "logo":
      return block.text;
    case "button":
      return block.label;
    case "product":
      return `${block.title} · ${block.price}`;
    case "columns":
      return block.items.map((i) => i.title).join(" · ");
    case "promo":
      return block.code;
    case "video":
      return block.caption;
    case "image":
      return block.alt || (block.src ? block.src.split("/").pop() ?? "" : "Sans image");
    case "social":
      return block.links.map((l) => SOCIAL_LABELS[l.network]).join(", ");
    case "spacer":
      return `${block.height} px`;
    case "html":
      return "Code personnalisé";
    default:
      return "";
  }
}

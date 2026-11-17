/**
 * Visual email builder — data model, presets and the email-safe HTML renderer.
 *
 * A design is a list of blocks plus a theme. Everything is customizable at three levels:
 *  1. the theme (global style: colors, fonts, buttons, layout),
 *  2. each block (its own typography, colors, spacing, borders, visibility),
 *  3. the text itself (bold, italic, links, color, size, highlight — inline).
 * Optional block fields left `undefined` inherit from the theme.
 *
 * Each block renders to a table-based HTML snippet with inline styles. The same renderer
 * produces the on-canvas WYSIWYG view (with inline-editable fields) and the final email.
 * Merge tags such as {{first_name|}} are kept verbatim and replaced at send time.
 */

export type Align = "left" | "center" | "right";
export type Transform = "none" | "uppercase";

// --- Fonts ---------------------------------------------------------------------------

export interface FontDef {
  label: string;
  stack: string;
  /** Google Fonts family spec — loaded in clients that support web fonts (Apple Mail, iOS, Thunderbird…). */
  google?: string;
  kind: "sûre" | "web";
}

export const FONT_LIST: Record<string, FontDef> = {
  helvetica: { label: "Helvetica", stack: "Helvetica, Arial, sans-serif", kind: "sûre" },
  arial: { label: "Arial", stack: "Arial, Helvetica, sans-serif", kind: "sûre" },
  verdana: { label: "Verdana", stack: "Verdana, Geneva, sans-serif", kind: "sûre" },
  trebuchet: { label: "Trebuchet", stack: "'Trebuchet MS', Helvetica, sans-serif", kind: "sûre" },
  tahoma: { label: "Tahoma", stack: "Tahoma, Verdana, sans-serif", kind: "sûre" },
  futura: { label: "Futura", stack: "Futura, 'Century Gothic', 'Trebuchet MS', Helvetica, sans-serif", kind: "sûre" },
  georgia: { label: "Georgia", stack: "Georgia, 'Times New Roman', serif", kind: "sûre" },
  times: { label: "Times", stack: "'Times New Roman', Times, serif", kind: "sûre" },
  palatino: { label: "Palatino", stack: "'Palatino Linotype', Palatino, Georgia, serif", kind: "sûre" },
  courier: { label: "Courier", stack: "'Courier New', Courier, monospace", kind: "sûre" },
  inter: { label: "Inter", stack: "'Inter', Helvetica, Arial, sans-serif", google: "Inter:wght@400;500;600;700;800", kind: "web" },
  outfit: { label: "Outfit", stack: "'Outfit', Helvetica, Arial, sans-serif", google: "Outfit:wght@400;500;600;700;800;900", kind: "web" },
  manrope: { label: "Manrope", stack: "'Manrope', Helvetica, Arial, sans-serif", google: "Manrope:wght@400;500;600;700;800", kind: "web" },
  poppins: { label: "Poppins", stack: "'Poppins', Helvetica, Arial, sans-serif", google: "Poppins:wght@400;500;600;700;800", kind: "web" },
  montserrat: { label: "Montserrat", stack: "'Montserrat', Helvetica, Arial, sans-serif", google: "Montserrat:wght@400;500;600;700;800;900", kind: "web" },
  dmsans: { label: "DM Sans", stack: "'DM Sans', Helvetica, Arial, sans-serif", google: "DM+Sans:wght@400;500;700", kind: "web" },
  spacegrotesk: { label: "Space Grotesk", stack: "'Space Grotesk', Helvetica, Arial, sans-serif", google: "Space+Grotesk:wght@400;500;700", kind: "web" },
  bebas: { label: "Bebas Neue", stack: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif", google: "Bebas+Neue", kind: "web" },
  playfair: { label: "Playfair Display", stack: "'Playfair Display', Georgia, serif", google: "Playfair+Display:wght@400;600;700;800", kind: "web" },
  lora: { label: "Lora", stack: "'Lora', Georgia, serif", google: "Lora:wght@400;500;600;700", kind: "web" },
  dmserif: { label: "DM Serif Display", stack: "'DM Serif Display', Georgia, serif", google: "DM+Serif+Display", kind: "web" },
};

export const fontStack = (key: string | undefined, fallback: string) => (FONT_LIST[key ?? ""] ?? FONT_LIST[fallback] ?? FONT_LIST.helvetica).stack;

// --- Theme ------------------------------------------------------------------------------

export interface Theme {
  // Colors
  background: string;
  surface: string;
  /** Headings color. */
  text: string;
  /** Body text color ("" = derived from `text`). */
  body: string;
  /** Link color ("" = accent). */
  link: string;
  accent: string;
  accentText: string;
  // Typography
  headingFont: string;
  bodyFont: string;
  headingWeight: number;
  headingTransform: Transform;
  /** Letter spacing in em. */
  headingSpacing: number;
  headingLineHeight: number;
  bodySize: number;
  bodyLineHeight: number;
  // Buttons
  radius: number;
  buttonPadY: number;
  buttonPadX: number;
  buttonSize: number;
  buttonWeight: number;
  buttonTransform: Transform;
  // Layout
  width: number;
  padX: number;
  cardRadius: number;
  outerPad: number;
  borderWidth: number;
  borderColor: string;
}

export interface BlockStyle {
  padTop?: number;
  padBottom?: number;
  /** Horizontal padding inside the section. */
  padX?: number;
  /** Outer horizontal margin (turns a colored section into an inset card). */
  inset?: number;
  bg?: string;
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  hideMobile?: boolean;
  hideDesktop?: boolean;
}

/** Shared typography overrides. */
export interface TypeOverrides {
  font?: string;
  fontSize?: number;
  color?: string;
  weight?: number;
  lineHeight?: number;
  spacing?: number;
  transform?: Transform;
  italic?: boolean;
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
    | ({ type: "logo"; text: string; imageUrl: string; align: Align; height?: number; href?: string } & TypeOverrides)
    | ({ type: "heading"; text: string; size: "xl" | "lg" | "md"; align: Align } & TypeOverrides)
    | ({ type: "text"; text: string; align: Align; size?: "sm" | "md" | "lg" } & TypeOverrides)
    | { type: "image"; src: string; alt: string; href: string; width?: number; align?: Align; rounded?: boolean; radius?: number; borderWidth?: number; borderColor?: string }
    | {
        type: "button";
        label: string;
        href: string;
        align: Align;
        full: boolean;
        color?: string;
        textColor?: string;
        fontSize?: number;
        padY?: number;
        padX?: number;
        radius?: number;
        weight?: number;
        transform?: Transform;
        borderWidth?: number;
        borderColor?: string;
        font?: string;
      }
    | {
        type: "product";
        imageUrl: string;
        title: string;
        price: string;
        oldPrice: string;
        href: string;
        cta: string;
        layout?: "left" | "right" | "stack";
        cardBg?: string;
        borderColor?: string;
        radius?: number;
        priceColor?: string;
      }
    | { type: "columns"; items: ColumnItem[]; gap?: number; align?: Align; cardBg?: string; imageRadius?: number; titleSize?: number; linkColor?: string; showCta?: boolean }
    | { type: "promo"; code: string; caption: string; borderColor?: string; bg?: string; codeColor?: string; codeSize?: number; borderStyle?: "dashed" | "solid" | "dotted"; label?: string }
    | { type: "quote"; text: string; author: string; barColor?: string; fontSize?: number; color?: string; italic?: boolean; align?: Align }
    | { type: "video"; thumbnail: string; href: string; caption: string; radius?: number; captionColor?: string }
    | { type: "social"; align: Align; links: Array<{ network: SocialNetwork; url: string }>; variant?: "outline" | "filled" | "text"; color?: string; textColor?: string; size?: number }
    | { type: "divider"; color?: string; thickness?: number; width?: number; lineStyle?: "solid" | "dashed" | "dotted" }
    | { type: "spacer"; height: number }
    | { type: "html"; html: string }
    | { type: "footer"; text: string; fontSize?: number; color?: string; linkColor?: string; align?: Align; unsubscribeLabel?: string }
  );

export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export interface Design {
  version: 2;
  theme: Theme;
  blocks: Block[];
}

export const DEFAULT_THEME: Theme = {
  background: "#EEF2F8",
  surface: "#FFFFFF",
  text: "#0B214A",
  body: "",
  link: "",
  accent: "#145CFF",
  accentText: "#FFFFFF",
  headingFont: "helvetica",
  bodyFont: "helvetica",
  headingWeight: 700,
  headingTransform: "none",
  headingSpacing: -0.02,
  headingLineHeight: 1.1,
  bodySize: 16,
  bodyLineHeight: 1.65,
  radius: 12,
  buttonPadY: 15,
  buttonPadX: 30,
  buttonSize: 15,
  buttonWeight: 700,
  buttonTransform: "none",
  width: 600,
  padX: 40,
  cardRadius: 20,
  outerPad: 32,
  borderWidth: 0,
  borderColor: "#DDE4F0",
};

export const THEME_SWATCHES: Array<{ name: string; theme: Partial<Theme> }> = [
  {
    name: "Neokrome",
    theme: { background: "#EEF2F8", surface: "#FFFFFF", text: "#0B214A", body: "", accent: "#145CFF", accentText: "#FFFFFF", headingFont: "outfit", headingWeight: 800, headingTransform: "uppercase", headingSpacing: -0.03, bodyFont: "manrope", radius: 999 },
  },
  { name: "Encre", theme: { background: "#F3F1EA", surface: "#FFFFFF", text: "#0E0E0C", body: "", accent: "#0E0E0C", accentText: "#FFFFFF", headingFont: "playfair", headingWeight: 600, headingTransform: "none", headingSpacing: -0.01, bodyFont: "helvetica", radius: 0 } },
  { name: "Vermillon", theme: { background: "#FFF3EE", surface: "#FFFFFF", text: "#1A1A18", body: "", accent: "#FF4D1C", accentText: "#FFFFFF", headingFont: "poppins", headingWeight: 800, headingTransform: "none", headingSpacing: -0.03, bodyFont: "poppins", radius: 12 } },
  { name: "Forêt", theme: { background: "#EEF2EC", surface: "#FFFFFF", text: "#16241B", body: "", accent: "#1F4D36", accentText: "#FFFFFF", headingFont: "lora", headingWeight: 600, headingTransform: "none", headingSpacing: -0.01, bodyFont: "helvetica", radius: 6 } },
  { name: "Océan", theme: { background: "#EDF2F7", surface: "#FFFFFF", text: "#0F1E2E", body: "", accent: "#1D4ED8", accentText: "#FFFFFF", headingFont: "inter", headingWeight: 800, headingTransform: "none", headingSpacing: -0.02, bodyFont: "inter", radius: 12 } },
  { name: "Nuit", theme: { background: "#071733", surface: "#0B214A", text: "#FFFFFF", body: "", accent: "#145CFF", accentText: "#FFFFFF", headingFont: "spacegrotesk", headingWeight: 700, headingTransform: "none", headingSpacing: -0.02, bodyFont: "helvetica", radius: 999 } },
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

// --- Brand kit ------------------------------------------------------------------------------

/** Account-level defaults applied to new emails and new blocks. */
export interface BrandKit {
  theme: Theme;
  logoUrl?: string;
  logoHeight?: number;
  footerText?: string;
  socials?: Array<{ network: SocialNetwork; url: string }>;
}

export function parseBrandKit(raw: string | null | undefined): BrandKit | null {
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as BrandKit;
    return k && k.theme ? { ...k, theme: normalizeTheme(k.theme) } : null;
  } catch {
    return null;
  }
}

/** Apply a brand kit to a design: theme + logo/footer/socials blocks. */
export function applyBrandKit(design: Design, kit: BrandKit | null): Design {
  if (!kit) return design;
  return {
    ...design,
    theme: { ...kit.theme },
    blocks: design.blocks.map((b) => brandBlock(b, kit)),
  };
}

export function brandBlock(b: Block, kit: BrandKit | null): Block {
  if (!kit) return b;
  if (b.type === "logo" && kit.logoUrl) return { ...b, imageUrl: kit.logoUrl, height: kit.logoHeight ?? b.height };
  if (b.type === "footer" && kit.footerText) return { ...b, text: kit.footerText };
  if (b.type === "social" && kit.socials?.length) return { ...b, links: kit.socials.map((s) => ({ ...s })) };
  return b;
}

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

export function createBlock(type: BlockType, brand = "Votre marque", kit: BrandKit | null = null): Block {
  return brandBlock(rawBlock(type, brand), kit);
}

function rawBlock(type: BlockType, brand: string): Block {
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
      return { id, type, src: "", alt: "", href: "", width: 100, align: "center", radius: 12 };
    case "button":
      return { id, type, label: "Découvrir", href: "https://", align: "left", full: false };
    case "product":
      return { id, type, imageUrl: "", title: "Nom du produit", price: "49 €", oldPrice: "", href: "https://", cta: "Voir le produit", layout: "left" };
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
const swatch = (name: string) => THEME_SWATCHES.find((s) => s.name === name)!.theme;
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
      blocks: [rawBlock("logo", brand), rawBlock("heading", brand), rawBlock("text", brand), rawBlock("button", brand), rawBlock("footer", brand)],
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
      theme: T(swatch("Vermillon")),
      blocks: [
        rawBlock("logo", brand),
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
        rawBlock("social", brand),
        rawBlock("footer", brand),
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
      theme: T(swatch("Nuit")),
      blocks: [
        rawBlock("logo", brand),
        rawBlock("image", brand),
        H("La nouvelle collection est là.", "xl", "center"),
        P("{{first_name|Bonjour}}, vous êtes parmi les premiers à la découvrir. Des pièces pensées pour durer, en quantités limitées.", "center"),
        BTN("Découvrir la collection", "center"),
        rawBlock("footer", brand),
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
      theme: T(swatch("Forêt")),
      blocks: [
        rawBlock("logo", brand),
        H("Bienvenue dans la famille.", "xl"),
        P(`Bonjour {{first_name|}},<br><br>Merci de nous avoir rejoints ! Chez ${esc(brand)}, on aime les choses bien faites. Pour fêter votre arrivée, voici un petit cadeau :`),
        { id: uid(), type: "promo", code: "BIENVENUE10", caption: "-10 % sur votre première commande" },
        BTN("Faire mon premier achat"),
        rawBlock("quote", brand),
        rawBlock("footer", brand),
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
        rawBlock("logo", brand),
        H("Votre panier vous attend.", "lg"),
        P("Bonjour {{first_name|}},<br><br>Vous étiez à deux clics de craquer. On a mis votre sélection de côté, mais pas pour longtemps."),
        { id: uid(), type: "product", imageUrl: "", title: "Votre article", price: "59 €", oldPrice: "", href: "https://", cta: "Finaliser ma commande", layout: "left" },
        P("Une question ? Répondez simplement à cet email, on vous répond dans la journée."),
        rawBlock("footer", brand),
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
      theme: T(swatch("Encre")),
      blocks: [
        rawBlock("logo", brand),
        H("L'édito", "lg"),
        P("Bonjour {{first_name|}},<br><br>Ce mois-ci, on vous emmène dans les coulisses de l'atelier et on vous présente nos trois coups de cœur."),
        rawBlock("divider", brand),
        rawBlock("video", brand),
        H("Nos coups de cœur", "md"),
        { id: uid(), type: "columns", items: [emptyColumn(1), emptyColumn(2), emptyColumn(3)] },
        BTN("Lire la suite"),
        rawBlock("social", brand),
        rawBlock("footer", brand),
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
  if (b.type === "heading" || b.type === "text" || b.type === "footer") return { ...b, text: legacyRich(b.text) };
  return b;
}

const LEGACY_FONTS: Record<string, [string, string]> = {
  sans: ["helvetica", "helvetica"],
  serif: ["georgia", "helvetica"],
  geometric: ["futura", "helvetica"],
  humanist: ["verdana", "verdana"],
};

/** Fill missing theme fields (older designs) with defaults. */
export function normalizeTheme(t: Partial<Theme> & { font?: string }): Theme {
  const legacy = t.font ? LEGACY_FONTS[t.font] : undefined;
  const merged = { ...DEFAULT_THEME, ...(legacy ? { headingFont: legacy[0], bodyFont: legacy[1], headingWeight: t.font === "serif" ? 400 : 700 } : {}), ...t } as Theme & { font?: string };
  delete merged.font;
  return merged;
}

export function parseDesign(raw: string | null | undefined): Design | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { version: number; theme: Theme; blocks: Block[] };
    if (!d || !Array.isArray(d.blocks) || !d.theme) return null;
    if (d.version === 1) return { version: 2, theme: normalizeTheme(d.theme), blocks: d.blocks.map(upgradeBlock) };
    if (d.version === 2) return { version: 2, theme: normalizeTheme(d.theme), blocks: d.blocks };
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
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const SIZE_KEYWORDS: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };
const FONT_TAG_SIZES = [0, 10, 13, 16, 18, 24, 32, 48];

function inlineStyle(el: HTMLElement): string {
  const parts: string[] = [];
  const color = el.style.color || (el.tagName === "FONT" ? el.getAttribute("color") ?? "" : "");
  if (color && COLOR_RE.test(color.replace(/\s+/g, " ").trim())) parts.push(`color:${color}`);
  const bg = el.style.backgroundColor;
  if (bg && COLOR_RE.test(bg.trim()) && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) parts.push(`background-color:${bg}`);
  let size = 0;
  const fs = el.style.fontSize;
  if (/^\d+(\.\d+)?px$/.test(fs)) size = Math.round(parseFloat(fs));
  else if (fs && SIZE_KEYWORDS[fs]) size = SIZE_KEYWORDS[fs];
  else if (el.tagName === "FONT" && el.getAttribute("size")) size = FONT_TAG_SIZES[Number(el.getAttribute("size"))] ?? 0;
  if (size >= 8 && size <= 96) parts.push(`font-size:${size}px`);
  return parts.join(";");
}

/**
 * Turns contentEditable output into the restricted rich-text dialect:
 * <strong> <em> <u> <s> <a href> <br> and <span style="color|background-color|font-size">.
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
    }
    if (tag === "span" || tag === "font") {
      if (/font-weight:\s*(bold|[6-9]00)/.test(style)) (open += "<strong>"), (close = "</strong>" + close);
      if (/font-style:\s*italic/.test(style)) (open += "<em>"), (close = "</em>" + close);
      if (/text-decoration[^;]*underline/.test(style)) (open += "<u>"), (close = "</u>" + close);
      if (/text-decoration[^;]*line-through/.test(style)) (open += "<s>"), (close = "</s>" + close);
    }
    if (tag === "span" || tag === "font" || tag === "a") {
      const css = inlineStyle(el);
      if (css) {
        if (tag === "a" && open) open = open.replace(/>$/, ` style="${css}">`);
        else (open += `<span style="${css}">`), (close = "</span>" + close);
      }
    }
    out.push(open);
    el.childNodes.forEach((c) => walk(c));
    out.push(close);
  };
  walk(doc.body.firstChild as Node, true);
  return out
    .join("")
    .replace(/(<br>)+$/, "")
    .replace(/<(strong|em|u|s)><\/\1>/g, "")
    .replace(/<span style="[^"]*"><\/span>/g, "");
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
            return `<span data-tag="${esc(m)}" contenteditable="false" style="display:inline-block;padding:0 6px;margin:0 1px;border-radius:6px;background:rgba(20,92,255,0.12);color:#145CFF;font-size:0.85em;font-weight:600;line-height:1.5;vertical-align:baseline;text-transform:none;letter-spacing:0;">${label}</span>`;
          }),
    )
    .join("");
}

interface Ctx {
  theme: Theme;
  canvas: boolean;
  editable: boolean;
}

const bodyColor = (t: Theme) => t.body || mix(t.text, 0.82);
const linkColor = (t: Theme) => t.link || t.accent;
const mutedColor = (t: Theme) => mix(t.body || t.text, 0.6);
const css = (o: Record<string, string | number | undefined | false>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/** Output for an editable field. `path` is the block field (e.g. "text", "items.0.title"). */
function field(ctx: Ctx, path: string, value: string, rich: boolean, link?: string): string {
  let html = rich ? value : esc(value);
  if (rich && link) html = html.replace(/<a href="([^"]*)"( style="([^"]*)")?>/g, (_m, href: string, _s, st?: string) => `<a href="${href}" target="_blank" style="color:${link};text-decoration:underline;${st ?? ""}">`);
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

function pad(ctx: Ctx, block: Block, top: number, bottom: number): string {
  const t = block.style?.padTop ?? top;
  const b = block.style?.padBottom ?? bottom;
  const x = block.style?.padX ?? ctx.theme.padX;
  return `${t}px ${x}px ${b}px`;
}

function row(inner: string, padding: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:${padding};">${inner}</td></tr></table>`;
}

interface ButtonOpts {
  bg?: string;
  fg?: string;
  fontSize?: number;
  padY?: number;
  padX?: number;
  radius?: number;
  weight?: number;
  transform?: Transform;
  borderWidth?: number;
  borderColor?: string;
  font?: string;
}

function buttonHtml(ctx: Ctx, label: string, href: string, full: boolean, path: string, o: ButtonOpts = {}): string {
  const { theme } = ctx;
  const radius = Math.min(o.radius ?? theme.radius, 999);
  const bg = o.bg || theme.accent;
  const fg = o.fg || theme.accentText;
  const bw = o.borderWidth ?? 0;
  const border = bw > 0 ? `${bw}px solid ${o.borderColor || fg}` : undefined;
  const a = css({
    display: full ? "block" : "inline-block",
    padding: `${o.padY ?? theme.buttonPadY}px ${o.padX ?? theme.buttonPadX}px`,
    "font-family": fontStack(o.font, theme.bodyFont),
    "font-size": `${o.fontSize ?? theme.buttonSize}px`,
    "font-weight": o.weight ?? theme.buttonWeight,
    "letter-spacing": (o.transform ?? theme.buttonTransform) === "uppercase" ? "0.08em" : "0.01em",
    "text-transform": (o.transform ?? theme.buttonTransform) === "uppercase" ? "uppercase" : undefined,
    color: fg,
    "text-decoration": "none",
    "border-radius": `${radius}px`,
    border,
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ""} style="border-collapse:separate;"><tr><td align="center" bgcolor="${bg}" style="background:${bg};border-radius:${radius}px;"><a href="${safeHref(href)}" target="_blank" style="${a}">${inlineField(ctx, path, label)}</a></td></tr></table>`;
}

function placeholder(ctx: Ctx, height: number, label: string): string {
  return `<div style="height:${height}px;border:1.5px dashed ${mix(ctx.theme.text, 0.25)};border-radius:12px;background:${mix(ctx.theme.text, 0.03)};display:flex;align-items:center;justify-content:center;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${mix(ctx.theme.text, 0.55)};">${label}</div>`;
}

const HEADING_SIZES = { xl: 48, lg: 34, md: 22 } as const;
const TEXT_SIZES = { sm: -2, md: 0, lg: 2 } as const;

function inner(block: Block, ctx: Ctx): string {
  const { theme } = ctx;
  const hFont = (k?: string) => fontStack(k, theme.headingFont);
  const bFont = (k?: string) => fontStack(k, theme.bodyFont);
  const muted = mutedColor(theme);
  const contentWidth = theme.width - 2 * theme.padX;
  switch (block.type) {
    case "logo": {
      const h = block.height ?? 40;
      const content = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.text)}" height="${h}" style="display:inline-block;height:${h}px;width:auto;border:0;">`
        : `<span style="${css({
            "font-family": hFont(block.font),
            "font-size": `${block.fontSize ?? 24}px`,
            "font-weight": block.weight ?? theme.headingWeight,
            "letter-spacing": `${block.spacing ?? theme.headingSpacing}em`,
            "text-transform": (block.transform ?? theme.headingTransform) === "uppercase" ? "uppercase" : undefined,
            color: block.color || theme.text,
          })}">${inlineField(ctx, "text", block.text)}</span>`;
      const linked = block.href && !ctx.canvas ? `<a href="${safeHref(block.href)}" target="_blank" style="text-decoration:none;">${content}</a>` : content;
      return row(`<div style="text-align:${block.align};">${linked}</div>`, pad(ctx, block, 32, 24));
    }
    case "heading": {
      const size = block.fontSize ?? HEADING_SIZES[block.size];
      const style = css({
        margin: 0,
        "font-family": hFont(block.font),
        "font-size": `${size}px`,
        "line-height": block.lineHeight ?? theme.headingLineHeight,
        "font-weight": block.weight ?? theme.headingWeight,
        "font-style": block.italic ? "italic" : undefined,
        "letter-spacing": `${block.spacing ?? theme.headingSpacing}em`,
        "text-transform": (block.transform ?? theme.headingTransform) === "uppercase" ? "uppercase" : undefined,
        color: block.color || theme.text,
        "text-align": block.align,
      });
      return row(`<h1 style="${style}">${field(ctx, "text", block.text, true, linkColor(theme))}</h1>`, pad(ctx, block, 12, 12));
    }
    case "text": {
      const size = block.fontSize ?? theme.bodySize + TEXT_SIZES[block.size ?? "md"];
      const style = css({
        margin: 0,
        "font-family": bFont(block.font),
        "font-size": `${size}px`,
        "line-height": block.lineHeight ?? theme.bodyLineHeight,
        "font-weight": block.weight,
        "font-style": block.italic ? "italic" : undefined,
        "letter-spacing": block.spacing !== undefined ? `${block.spacing}em` : undefined,
        "text-transform": block.transform === "uppercase" ? "uppercase" : undefined,
        color: block.color || bodyColor(theme),
        "text-align": block.align,
      });
      return row(`<div style="${style}">${field(ctx, "text", block.text, true, linkColor(theme))}</div>`, pad(ctx, block, 10, 10));
    }
    case "image": {
      if (!block.src) return ctx.canvas ? row(placeholder(ctx, 220, "Glissez une image ici<br>ou choisissez-la dans le panneau de droite"), pad(ctx, block, 12, 12)) : "";
      const w = Math.round((contentWidth * (block.width ?? 100)) / 100);
      const radius = block.radius ?? (block.rounded === false ? 0 : 12);
      const bw = block.borderWidth ?? 0;
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt)}" width="${w}" style="${css({
        display: "inline-block",
        width: "100%",
        "max-width": `${w}px`,
        height: "auto",
        border: bw > 0 ? `${bw}px solid ${block.borderColor || theme.text}` : "0",
        "border-radius": `${radius}px`,
      })}">`;
      return row(`<div style="text-align:${block.align ?? "center"};">${block.href ? `<a href="${safeHref(block.href)}" target="_blank">${img}</a>` : img}</div>`, pad(ctx, block, 12, 12));
    }
    case "button": {
      const btn = buttonHtml(ctx, block.label, block.href, block.full, "label", {
        bg: block.color,
        fg: block.textColor,
        fontSize: block.fontSize,
        padY: block.padY,
        padX: block.padX,
        radius: block.radius,
        weight: block.weight,
        transform: block.transform,
        borderWidth: block.borderWidth,
        borderColor: block.borderColor,
        font: block.font,
      });
      return row(`<div style="text-align:${block.align};">${block.full ? btn : `<div style="display:inline-block;">${btn}</div>`}</div>`, pad(ctx, block, 18, 18));
    }
    case "product": {
      const layout = block.layout ?? "left";
      const radius = block.radius ?? 14;
      const imgW = layout === "stack" ? contentWidth - 32 : 200;
      const img = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.title)}" width="${imgW}" style="display:block;width:100%;max-width:${imgW}px;height:auto;border:0;border-radius:${Math.max(0, radius - 4)}px;">`
        : ctx.canvas
          ? placeholder(ctx, layout === "stack" ? 260 : 200, "Photo")
          : "";
      const old = block.oldPrice ? ` <span style="font-size:14px;font-weight:normal;text-decoration:line-through;color:${muted};">${inlineField(ctx, "oldPrice", block.oldPrice)}</span>` : "";
      const info = `<p style="margin:0 0 6px;font-family:${hFont()};font-size:22px;line-height:1.2;font-weight:${theme.headingWeight};color:${theme.text};">${inlineField(ctx, "title", block.title)}</p>
<p style="margin:0 0 16px;font-family:${bFont()};font-size:18px;font-weight:bold;color:${block.priceColor || theme.text};">${inlineField(ctx, "price", block.price)}${old}</p>
${buttonHtml(ctx, block.cta, block.href, false, "cta")}`;
      const box = css({ border: `1px solid ${block.borderColor || mix(theme.text, 0.12)}`, "border-radius": `${radius}px`, background: block.cardBg });
      const cells =
        layout === "stack"
          ? `<tr><td style="padding:16px 16px 0;">${img}</td></tr><tr><td style="padding:16px 20px 20px;">${info}</td></tr>`
          : layout === "right"
            ? `<tr><td class="col" valign="middle" style="padding:16px 4px 16px 20px;">${info}</td><td class="col" width="200" valign="top" style="padding:16px;">${img}</td></tr>`
            : `<tr><td class="col" width="200" valign="top" style="padding:16px;">${img}</td><td class="col" valign="middle" style="padding:16px 20px 16px 4px;">${info}</td></tr>`;
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${block.cardBg ? ` bgcolor="${block.cardBg}"` : ""} style="${box}">${cells}</table>`, pad(ctx, block, 12, 12));
    }
    case "columns": {
      const n = block.items.length;
      const gap = block.gap ?? 12;
      const imgW = Math.floor((contentWidth - gap * (n - 1)) / n);
      const align = block.align ?? "left";
      const cells = block.items
        .map((it, i) => {
          const img = it.imageUrl
            ? `<img src="${esc(it.imageUrl)}" alt="${esc(it.title)}" width="${imgW}" style="display:block;width:100%;height:auto;border:0;border-radius:${block.imageRadius ?? 10}px;">`
            : ctx.canvas
              ? placeholder(ctx, Math.round(imgW * 0.9), "Image")
              : "";
          const link =
            block.showCta !== false && it.cta
              ? `<a href="${safeHref(it.href)}" target="_blank" style="font-family:${bFont()};font-size:14px;font-weight:bold;color:${block.linkColor || linkColor(theme)};text-decoration:none;">${inlineField(ctx, `items.${i}.cta`, it.cta)} →</a>`
              : "";
          const cardPad = block.cardBg ? "12px" : "0";
          return `<td class="col" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 ${i < n - 1 ? gap / 2 : 0}px 0 ${i > 0 ? gap / 2 : 0}px;">
<div style="${css({ background: block.cardBg, padding: cardPad, "border-radius": block.cardBg ? `${(block.imageRadius ?? 10) + 4}px` : undefined, "text-align": align })}">
${img}
<p style="margin:12px 0 4px;font-family:${hFont()};font-size:${block.titleSize ?? 17}px;line-height:1.25;font-weight:${theme.headingWeight};color:${theme.text};">${inlineField(ctx, `items.${i}.title`, it.title)}</p>
<div style="margin:0 0 10px;font-family:${bFont()};font-size:14px;line-height:1.5;color:${muted};">${field(ctx, `items.${i}.text`, it.text, true, linkColor(theme))}</div>
${link}
</div>
</td>`;
        })
        .join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, pad(ctx, block, 14, 14));
    }
    case "promo": {
      const border = `1.5px ${block.borderStyle ?? "dashed"} ${block.borderColor || theme.accent}`;
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${block.bg ? ` bgcolor="${block.bg}"` : ""} style="${css({ border, "border-radius": "14px", background: block.bg })}"><tr><td align="center" style="padding:22px 16px;font-family:${bFont()};">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${muted};">${inlineField(ctx, "label", block.label ?? "Votre code")}</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:${block.codeSize ?? 28}px;font-weight:bold;letter-spacing:0.12em;color:${block.codeColor || theme.text};">${inlineField(ctx, "code", block.code)}</p>
<p style="margin:8px 0 0;font-size:13px;color:${muted};">${inlineField(ctx, "caption", block.caption)}</p>
</td></tr></table>`,
        pad(ctx, block, 14, 14),
      );
    }
    case "quote": {
      const align = block.align ?? "left";
      const bar = block.barColor || theme.accent;
      const cellStyle = align === "left" ? `border-left:3px solid ${bar};padding:4px 0 4px 20px;` : `padding:4px 0;text-align:${align};`;
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${cellStyle}">
<div style="${css({ "font-family": hFont(), "font-size": `${block.fontSize ?? 20}px`, "line-height": 1.45, "font-style": block.italic ? "italic" : undefined, color: block.color || theme.text })}">${field(ctx, "text", block.text, true, linkColor(theme))}</div>
<p style="margin:10px 0 0;font-family:${bFont()};font-size:13px;color:${muted};">— ${inlineField(ctx, "author", block.author)}</p>
</td></tr></table>`,
        pad(ctx, block, 16, 16),
      );
    }
    case "video": {
      const radius = block.radius ?? 12;
      const thumb = block.thumbnail
        ? `<a href="${safeHref(block.href)}" target="_blank" style="display:block;"><img src="${esc(block.thumbnail)}" alt="${esc(block.caption)}" width="${contentWidth}" style="display:block;width:100%;max-width:${contentWidth}px;height:auto;border:0;border-radius:${radius}px;"></a>`
        : ctx.canvas
          ? placeholder(ctx, 260, "▶&nbsp; Miniature de la vidéo")
          : "";
      return row(
        `${thumb}<p style="margin:12px 0 0;text-align:center;font-family:${bFont()};font-size:14px;font-weight:bold;"><a href="${safeHref(block.href)}" target="_blank" style="color:${block.captionColor || linkColor(theme)};text-decoration:none;">▶&nbsp; ${inlineField(ctx, "caption", block.caption)}</a></p>`,
        pad(ctx, block, 12, 12),
      );
    }
    case "social": {
      const variant = block.variant ?? "outline";
      const color = block.color || theme.text;
      const size = block.size ?? 13;
      const style =
        variant === "filled"
          ? css({ display: "inline-block", margin: "4px", padding: "8px 14px", background: color, "border-radius": "999px", color: block.textColor || theme.surface })
          : variant === "text"
            ? css({ display: "inline-block", margin: "4px 10px", color })
            : css({ display: "inline-block", margin: "4px", padding: "8px 14px", border: `1px solid ${mix(color, 0.25)}`, "border-radius": "999px", color });
      const links = block.links
        .filter((l) => l.url.trim() && l.url.trim() !== "https://")
        .map((l) => `<a href="${safeHref(l.url)}" target="_blank" style="${style};font-family:${bFont()};font-size:${size}px;font-weight:bold;text-decoration:none;">${SOCIAL_LABELS[l.network]}</a>`)
        .join("");
      if (!links) return ctx.canvas ? row(placeholder(ctx, 60, "Ajoutez vos liens de réseaux sociaux"), pad(ctx, block, 12, 12)) : "";
      return row(`<div style="text-align:${block.align};">${links}</div>`, pad(ctx, block, 16, 16));
    }
    case "divider": {
      const t = Math.max(1, Math.min(8, block.thickness ?? 1));
      const w = block.width ?? 100;
      const color = block.color || mix(theme.text, 0.14);
      return row(`<div style="width:${w}%;margin:0 auto;border-top:${t}px ${block.lineStyle ?? "solid"} ${color};height:0;line-height:0;font-size:0;">&nbsp;</div>`, pad(ctx, block, 18, 18));
    }
    case "spacer":
      return `<div style="height:${Math.max(4, Math.min(200, block.height))}px;line-height:1px;font-size:0;">&nbsp;</div>`;
    case "html":
      return row(block.html || (ctx.canvas ? placeholder(ctx, 60, "Bloc HTML vide") : ""), pad(ctx, block, 12, 12));
    case "footer": {
      const color = block.color || muted;
      const lc = block.linkColor || color;
      return row(
        `<div style="border-top:1px solid ${mix(theme.text, 0.12)};padding-top:24px;font-family:${bFont()};font-size:${block.fontSize ?? 12}px;line-height:1.6;color:${color};text-align:${block.align ?? "center"};">${field(ctx, "text", block.text, true, lc)}<br><a href="{{unsubscribe_url}}" style="color:${lc};text-decoration:underline;">${inlineField(ctx, "unsubscribeLabel", block.unsubscribeLabel ?? "Se désinscrire")}</a></div>`,
        pad(ctx, block, 28, 36),
      );
    }
  }
}

/** Renders a single block. `canvas` adds placeholders and (if `editable`) inline-editable fields. */
export function renderBlock(block: Block, theme: Theme, opts: { canvas?: boolean; editable?: boolean } = {}): string {
  const ctx: Ctx = { theme, canvas: !!opts.canvas, editable: !!opts.editable };
  const html = inner(block, ctx);
  if (!html) return "";
  const s = block.style;
  const cls = [s?.hideMobile ? "hide-m" : "", s?.hideDesktop ? "hide-d" : ""].filter(Boolean).join(" ");
  const boxed = !!(s?.bg || s?.radius || s?.borderWidth);
  if (!boxed && !cls && !s?.inset) return html;
  const box = css({
    background: s?.bg,
    "border-radius": s?.radius ? `${s.radius}px` : undefined,
    border: s?.borderWidth ? `${s.borderWidth}px solid ${s.borderColor || mix(theme.text, 0.15)}` : undefined,
    overflow: s?.radius ? "hidden" : undefined,
  });
  const inset = s?.inset ?? 0;
  if (ctx.canvas) return `<div style="padding:0 ${inset}px;"><div style="${box}">${html}</div></div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${cls ? ` class="${cls}"` : ""}><tr><td style="padding:0 ${inset}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${s?.bg ? ` bgcolor="${s.bg}"` : ""} style="${box}"><tr><td>${html}</td></tr></table></td></tr></table>`;
}

/** Google Fonts used by a design (theme + block overrides). */
export function usedWebFonts(design: Design): string[] {
  const keys = new Set<string>([design.theme.headingFont, design.theme.bodyFont]);
  for (const b of design.blocks) if ("font" in b && b.font) keys.add(b.font);
  return [...keys].map((k) => FONT_LIST[k]?.google).filter((g): g is string => !!g);
}

export function googleFontsHref(families: string[]): string | null {
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap` : null;
}

/** Full, standalone email document. Always contains an unsubscribe link. */
export function renderEmail(design: Design, preheader = ""): string {
  const { theme } = design;
  const body = design.blocks.map((b) => renderBlock(b, theme)).join("\n");
  const hasFooter = design.blocks.some((b) => b.type === "footer");
  const muted = mutedColor(theme);
  const footer = hasFooter
    ? ""
    : row(`<div style="font-family:${fontStack(theme.bodyFont, "helvetica")};font-size:12px;color:${muted};text-align:center;"><a href="{{unsubscribe_url}}" style="color:${muted};">Se désinscrire</a></div>`, `24px ${theme.padX}px 32px`);
  const fonts = googleFontsHref(usedWebFonts(design));
  const border = theme.borderWidth > 0 ? `border:${theme.borderWidth}px solid ${theme.borderColor};` : "";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
${fonts ? `<link href="${fonts}" rel="stylesheet">` : ""}
<style>
  .hide-d { display: table; }
  @media only screen and (max-width: ${theme.width + 20}px) {
    .container { width: 100% !important; border-radius: 0 !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .col { display: block !important; width: 100% !important; padding: 0 0 18px 0 !important; }
    .hide-m { display: none !important; }
    h1 { font-size: 34px !important; }
  }
  @media only screen and (min-width: ${theme.width + 21}px) {
    .hide-d { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${theme.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.background}" style="background:${theme.background};">
<tr><td align="center" style="padding:${theme.outerPad}px 12px;">
<table role="presentation" class="container" width="${theme.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.surface}" style="width:${theme.width}px;max-width:${theme.width}px;background:${theme.surface};border-radius:${theme.cardRadius}px;overflow:hidden;${border}">
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

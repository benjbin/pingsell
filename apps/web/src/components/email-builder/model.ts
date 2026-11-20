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

import { t, LANG, LOCALE } from "../../lib/i18n";

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

/** A font added by the merchant: any Google font, or a font file they uploaded. */
export interface CustomFont {
  key: string;
  label: string;
  /** CSS family name. */
  family: string;
  source: "google" | "upload";
  /** Google Fonts family spec (source "google"). */
  google?: string;
  /** Font file URL (source "upload"). */
  url?: string;
  /** Used by mail clients that ignore web fonts (Gmail, Outlook). */
  fallback: "sans" | "serif" | "mono";
}

const FALLBACK_STACKS = { sans: "Helvetica, Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "'Courier New', Courier, monospace" } as const;

export function customFontDef(f: CustomFont): FontDef {
  return { label: f.label, stack: `'${f.family.replace(/'/g, "")}', ${FALLBACK_STACKS[f.fallback] ?? FALLBACK_STACKS.sans}`, google: f.google, kind: "web" };
}

export function fontDef(key: string | undefined, custom: CustomFont[] = []): FontDef | undefined {
  if (!key) return undefined;
  const c = custom.find((f) => f.key === key);
  return c ? customFontDef(c) : FONT_LIST[key];
}

export const fontStack = (key: string | undefined, fallback: string, custom: CustomFont[] = []) => (fontDef(key, custom) ?? fontDef(fallback, custom) ?? FONT_LIST.helvetica).stack;

export function customFontKey(label: string): string {
  return `c_${label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "")}_${Math.random().toString(36).slice(2, 6)}`;
}

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
  /** Merchant fonts (Google or uploaded), usable anywhere a font is picked. */
  customFonts: CustomFont[];
  // Buttons
  /** "" = body font. */
  buttonFont: string;
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
  /** Typography overrides for the whole block (titles / texts inside it). */
  headingFont?: string;
  bodyFont?: string;
  headingColor?: string;
  textColor?: string;
  accent?: string;
  /** Scales every text size in the block, in %. */
  textScale?: number;
  padTop?: number;
  padBottom?: number;
  /** Horizontal padding inside the section. */
  padX?: number;
  /** Outer horizontal margin (turns a colored section into an inset card). */
  inset?: number;
  bg?: string;
  /** Warm light rising from the section's edge (a radial gradient into `bg`). */
  glow?: string;
  glowAt?: "bottom" | "corner";
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
    | { type: "hero"; imageUrl: string; title: string; text: string; cta: string; href: string; align: Align; showCta?: boolean; bg?: string; textColor?: string; overlay?: number; titleSize?: number; buttonBg?: string; buttonText?: string }
    | { type: "imageText"; imageUrl: string; title: string; text: string; cta: string; href: string; layout?: "left" | "right"; imageWidth?: number; showCta?: boolean; imageRadius?: number; valign?: "top" | "middle" }
    | { type: "list"; items: Array<{ text: string }>; marker?: "bullet" | "number" | "check" | "arrow" | "star"; markerColor?: string; fontSize?: number; color?: string; gap?: number }
    | { type: "gallery"; images: Array<{ src: string; href: string; alt: string }>; columns?: 2 | 3; gap?: number; radius?: number }
    | { type: "buttons"; primary: { label: string; href: string }; secondary: { label: string; href: string }; align: Align; secondaryStyle?: "outline" | "text" }
    | { type: "stats"; items: Array<{ value: string; label: string }>; color?: string; valueSize?: number; labelColor?: string }
    | { type: "review"; rating: number; text: string; author: string; avatarUrl: string; starColor?: string; align?: Align; cardBg?: string }
    | { type: "faq"; items: Array<{ q: string; a: string }>; qColor?: string; separators?: boolean }
    | { type: "features"; items: Array<{ icon: string; title: string; text: string }>; layout?: "row" | "list"; iconBg?: string; align?: Align }
    | { type: "countdown"; until: string; title: string; bg?: string; color?: string; boxBg?: string; showSeconds?: boolean }
    | { type: "event"; title: string; date: string; time: string; place: string; cta: string; href: string; accent?: string; cardBg?: string }
    | { type: "survey"; question: string; scale: "stars" | "emoji" | "nps" | "yesno"; href: string; color?: string; lowLabel?: string; highLabel?: string }
    | { type: "apps"; iosUrl: string; androidUrl: string; align: Align; color?: string }
    | { type: "menu"; links: Array<{ label: string; href: string }>; align: Align; color?: string; fontSize?: number; uppercase?: boolean; separator?: boolean }
    | { type: "signature"; avatarUrl: string; name: string; role: string; text: string; nameColor?: string }
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
  customFonts: [],
  buttonFont: "",
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

export const THEME_SWATCHES: Array<{ key: string; name: string; theme: Partial<Theme> }> = [
  {
    key: "Neokrome",
    name: "Neokrome",
    theme: { background: "#EEF2F8", surface: "#FFFFFF", text: "#0B214A", body: "", accent: "#145CFF", accentText: "#FFFFFF", headingFont: "outfit", headingWeight: 800, headingTransform: "uppercase", headingSpacing: -0.03, bodyFont: "manrope", radius: 999 },
  },
  { key: "Encre", name: t("Encre", "Ink"), theme: { background: "#F3F1EA", surface: "#FFFFFF", text: "#0E0E0C", body: "", accent: "#0E0E0C", accentText: "#FFFFFF", headingFont: "playfair", headingWeight: 600, headingTransform: "none", headingSpacing: -0.01, bodyFont: "helvetica", radius: 0 } },
  { key: "Vermillon", name: t("Vermillon", "Vermilion"), theme: { background: "#FFF3EE", surface: "#FFFFFF", text: "#1A1A18", body: "", accent: "#FF4D1C", accentText: "#FFFFFF", headingFont: "poppins", headingWeight: 800, headingTransform: "none", headingSpacing: -0.03, bodyFont: "poppins", radius: 12 } },
  { key: "Forêt", name: t("Forêt", "Forest"), theme: { background: "#EEF2EC", surface: "#FFFFFF", text: "#16241B", body: "", accent: "#1F4D36", accentText: "#FFFFFF", headingFont: "lora", headingWeight: 600, headingTransform: "none", headingSpacing: -0.01, bodyFont: "helvetica", radius: 6 } },
  { key: "Océan", name: t("Océan", "Ocean"), theme: { background: "#EDF2F7", surface: "#FFFFFF", text: "#0F1E2E", body: "", accent: "#1D4ED8", accentText: "#FFFFFF", headingFont: "inter", headingWeight: 800, headingTransform: "none", headingSpacing: -0.02, bodyFont: "inter", radius: 12 } },
  { key: "Nuit", name: t("Nuit", "Night"), theme: { background: "#071733", surface: "#0B214A", text: "#FFFFFF", body: "", accent: "#145CFF", accentText: "#FFFFFF", headingFont: "spacegrotesk", headingWeight: 700, headingTransform: "none", headingSpacing: -0.02, bodyFont: "helvetica", radius: 999 } },
];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
  website: t("Site web", "Website"),
};

export const MERGE_TAGS: Array<{ tag: string; label: string }> = [
  { tag: "{{first_name|}}", label: t("Prénom", "First name") },
  { tag: "{{last_name|}}", label: t("Nom", "Last name") },
  { tag: "{{email}}", label: t("Email", "Email") },
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

/** Display label of a block category (localized). */
export type BlockCategory = string;

const CAT_CONTENT = t("Contenu", "Content");
const CAT_FEATURE = t("Mise en avant", "Highlights");
const CAT_COMMERCE = t("Commerce", "Commerce");
const CAT_ENGAGE = t("Engagement", "Engagement");
const CAT_LAYOUT = t("Mise en page", "Layout");

export const BLOCK_LIBRARY: Array<{ type: BlockType; label: string; hint: string; category: BlockCategory }> = [
  { type: "heading", label: t("Titre", "Heading"), hint: t("Grand titre accrocheur", "Big, catchy headline"), category: CAT_CONTENT },
  { type: "text", label: t("Texte", "Text"), hint: t("Paragraphe mis en forme", "Formatted paragraph"), category: CAT_CONTENT },
  { type: "image", label: t("Image", "Image"), hint: t("Visuel, avec lien optionnel", "Visual, with optional link"), category: CAT_CONTENT },
  { type: "button", label: t("Bouton", "Button"), hint: t("Appel à l'action", "Call to action"), category: CAT_CONTENT },
  { type: "buttons", label: t("2 boutons", "2 buttons"), hint: t("Action principale + secondaire", "Primary + secondary action"), category: CAT_CONTENT },
  { type: "list", label: t("Liste", "List"), hint: t("Puces, numéros, coches", "Bullets, numbers, checks"), category: CAT_CONTENT },
  { type: "quote", label: t("Citation", "Quote"), hint: t("Phrase mise en valeur", "Highlighted sentence"), category: CAT_CONTENT },
  { type: "video", label: t("Vidéo", "Video"), hint: t("Miniature cliquable", "Clickable thumbnail"), category: CAT_CONTENT },
  { type: "hero", label: t("Bannière", "Banner"), hint: t("Image de fond + titre + bouton", "Background image + headline + button"), category: CAT_FEATURE },
  { type: "imageText", label: t("Image + texte", "Image + text"), hint: t("Côte à côte", "Side by side"), category: CAT_FEATURE },
  { type: "gallery", label: t("Galerie", "Gallery"), hint: t("Grille de 2 à 9 images", "Grid of 2 to 9 images"), category: CAT_FEATURE },
  { type: "features", label: t("Avantages", "Perks"), hint: t("Livraison, retours, paiement…", "Shipping, returns, payment…"), category: CAT_FEATURE },
  { type: "stats", label: t("Chiffres", "Stats"), hint: t("Chiffres clés", "Key figures"), category: CAT_FEATURE },
  { type: "product", label: t("Produit", "Product"), hint: t("Photo, prix, lien", "Photo, price, link"), category: CAT_COMMERCE },
  { type: "columns", label: t("Colonnes", "Columns"), hint: t("2 ou 3 cartes côte à côte", "2 or 3 cards side by side"), category: CAT_COMMERCE },
  { type: "promo", label: t("Code promo", "Promo code"), hint: t("Code à copier", "Code to copy"), category: CAT_COMMERCE },
  { type: "countdown", label: t("Compte à rebours", "Countdown"), hint: t("Calculé au moment de l'envoi", "Calculated at send time"), category: CAT_COMMERCE },
  { type: "review", label: t("Avis client", "Customer review"), hint: t("Étoiles + témoignage", "Stars + testimonial"), category: CAT_COMMERCE },
  { type: "survey", label: t("Sondage", "Survey"), hint: t("Note, emoji, NPS, oui/non", "Rating, emoji, NPS, yes/no"), category: CAT_ENGAGE },
  { type: "event", label: t("Événement", "Event"), hint: t("Date, lieu, inscription", "Date, place, sign-up"), category: CAT_ENGAGE },
  { type: "faq", label: t("FAQ", "FAQ"), hint: t("Questions / réponses", "Questions & answers"), category: CAT_ENGAGE },
  { type: "apps", label: t("Applis", "Apps"), hint: t("App Store, Google Play", "App Store, Google Play"), category: CAT_ENGAGE },
  { type: "signature", label: t("Signature", "Signature"), hint: t("Photo, nom, fonction", "Photo, name, role"), category: CAT_ENGAGE },
  { type: "logo", label: t("Logo", "Logo"), hint: t("Nom ou image de marque", "Brand name or image"), category: CAT_LAYOUT },
  { type: "menu", label: t("Menu", "Menu"), hint: t("Liens de navigation", "Navigation links"), category: CAT_LAYOUT },
  { type: "social", label: t("Réseaux", "Social"), hint: t("Liens vers vos réseaux", "Links to your social accounts"), category: CAT_LAYOUT },
  { type: "divider", label: t("Séparateur", "Divider"), hint: t("Ligne fine", "Thin line"), category: CAT_LAYOUT },
  { type: "spacer", label: t("Espace", "Spacer"), hint: t("Respiration verticale", "Vertical breathing room"), category: CAT_LAYOUT },
  { type: "html", label: t("HTML", "HTML"), hint: t("Code personnalisé", "Custom code"), category: CAT_LAYOUT },
  { type: "footer", label: t("Pied de page", "Footer"), hint: t("Mentions + désinscription", "Legal notice + unsubscribe"), category: CAT_LAYOUT },
];

const emptyColumn = (n: number): ColumnItem => ({
  imageUrl: "",
  title: t(`Produit ${n}`, `Product ${n}`),
  text: t("Une courte description.", "A short description."),
  href: "https://",
  cta: t("Voir", "View"),
});

export function createBlock(type: BlockType, brand = t("Votre marque", "Your brand"), kit: BrandKit | null = null): Block {
  return brandBlock(rawBlock(type, brand), kit);
}

function rawBlock(type: BlockType, brand: string): Block {
  const id = uid();
  switch (type) {
    case "logo":
      return { id, type, text: brand, imageUrl: "", align: "center", height: 40 };
    case "heading":
      return { id, type, text: t("Un titre qui donne envie", "A headline worth reading"), size: "lg", align: "left" };
    case "text":
      return {
        id,
        type,
        text: t(
          "Bonjour {{first_name|}},<br><br>Racontez ici votre nouveauté, votre offre ou votre histoire. Restez court : une idée, une émotion, une action.",
          "Hi {{first_name|}},<br><br>Share your news, your offer or your story here. Keep it short: one idea, one feeling, one action.",
        ),
        align: "left",
        size: "md",
      };
    case "image":
      return { id, type, src: "", alt: "", href: "", width: 100, align: "center", radius: 12 };
    case "button":
      return { id, type, label: t("Découvrir", "Discover"), href: "https://", align: "left", full: false };
    case "product":
      return { id, type, imageUrl: "", title: t("Nom du produit", "Product name"), price: t("49 €", "€49"), oldPrice: "", href: "https://", cta: t("Voir le produit", "View product"), layout: "left" };
    case "columns":
      return { id, type, items: [emptyColumn(1), emptyColumn(2)] };
    case "promo":
      return { id, type, code: t("BIENVENUE10", "WELCOME10"), caption: t("-10 % sur votre première commande", "10% off your first order") };
    case "quote":
      return { id, type, text: t("« Livraison rapide, produit superbe. Je recommande les yeux fermés. »", "“Fast shipping, gorgeous product. I recommend it without hesitation.”"), author: t("Camille, cliente depuis 2024", "Camille, customer since 2024") };
    case "video":
      return { id, type, thumbnail: "", href: "https://", caption: t("Regarder la vidéo", "Watch the video") };
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
      return { id, type, html: `<p style="margin:0;text-align:center;">${t("Votre HTML ici", "Your HTML here")}</p>` };
    case "footer":
      return { id, type, text: t(`${esc(brand)} · Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.`, `${esc(brand)} · You are receiving this email because you subscribed to our newsletter.`) };
    case "hero":
      return { id, type, imageUrl: "", title: t("La nouvelle collection est là", "The new collection is here"), text: t("Des pièces pensées pour durer, en édition limitée.", "Pieces made to last, in a limited edition."), cta: t("Découvrir", "Discover"), href: "https://", align: "center", overlay: 35 };
    case "imageText":
      return { id, type, imageUrl: "", title: t("Fabriqué avec soin", "Made with care"), text: t("Racontez l'histoire du produit, de l'atelier ou de l'équipe en quelques lignes.", "Tell the story of the product, the workshop or the team in a few lines."), cta: t("En savoir plus", "Learn more"), href: "https://", layout: "left" };
    case "list":
      return { id, type, marker: "check", items: [{ text: t("Livraison offerte dès 50 €", "Free shipping on orders over €50") }, { text: t("Retours gratuits sous 30 jours", "Free returns within 30 days") }, { text: t("Paiement en 3 fois sans frais", "Pay in 3 interest-free installments") }] };
    case "gallery":
      return { id, type, columns: 2, images: [0, 1, 2, 3].map(() => ({ src: "", href: "", alt: "" })) };
    case "buttons":
      return { id, type, align: "center", primary: { label: t("Acheter", "Shop now"), href: "https://" }, secondary: { label: t("En savoir plus", "Learn more"), href: "https://" } };
    case "stats":
      return { id, type, items: [{ value: t("12 000+", "12,000+"), label: t("clients satisfaits", "happy customers") }, { value: t("4,9/5", "4.9/5"), label: t("note moyenne", "average rating") }, { value: t("48 h", "48h"), label: t("livraison", "delivery") }] };
    case "review":
      return { id, type, rating: 5, text: t("« Qualité impeccable et service client au top. Ma deuxième commande ne tardera pas ! »", "“Flawless quality and top-notch customer service. My second order is coming soon!”"), author: t("Léa M., cliente vérifiée", "Léa M., verified customer"), avatarUrl: "", align: "center" };
    case "faq":
      return {
        id,
        type,
        separators: true,
        items: [
          { q: t("Quels sont les délais de livraison ?", "How long does shipping take?"), a: t("Votre commande est expédiée sous 24 h et livrée en 2 à 4 jours ouvrés.", "Your order ships within 24 hours and arrives in 2 to 4 business days.") },
          { q: t("Puis-je retourner un article ?", "Can I return an item?"), a: t("Oui, vous disposez de 30 jours pour changer d'avis. Le retour est gratuit.", "Yes, you have 30 days to change your mind. Returns are free.") },
        ],
      };
    case "features":
      return {
        id,
        type,
        layout: "row",
        align: "center",
        items: [
          { icon: "🚚", title: t("Livraison offerte", "Free shipping"), text: t("Dès 50 € d'achat", "On orders over €50") },
          { icon: "↩️", title: t("Retours gratuits", "Free returns"), text: t("Sous 30 jours", "Within 30 days") },
          { icon: "🔒", title: t("Paiement sécurisé", "Secure checkout"), text: t("CB, PayPal, Apple Pay", "Card, PayPal, Apple Pay") },
        ],
      };
    case "countdown": {
      const until = new Date(Date.now() + 3 * 86400000);
      until.setMinutes(0, 0, 0);
      return { id, type, until: until.toISOString(), title: t("L'offre se termine dans", "Offer ends in") };
    }
    case "event":
      return { id, type, title: t("Vente privée en boutique", "In-store private sale"), date: t("Samedi 6 décembre", "Saturday, December 6"), time: t("14 h – 19 h", "2–7 PM"), place: "12 rue des Artisans, Paris", cta: t("Je m'inscris", "Sign me up"), href: "https://" };
    case "survey":
      return { id, type, question: t("Comment s'est passée votre dernière commande ?", "How was your last order?"), scale: "stars", href: "https://", lowLabel: t("Décevant", "Disappointing"), highLabel: t("Parfait", "Perfect") };
    case "apps":
      return { id, type, iosUrl: "https://apps.apple.com/", androidUrl: "https://play.google.com/", align: "center" };
    case "menu":
      return {
        id,
        type,
        align: "center",
        uppercase: true,
        links: [
          { label: t("Nouveautés", "New in"), href: "https://" },
          { label: t("Femme", "Women"), href: "https://" },
          { label: t("Homme", "Men"), href: "https://" },
          { label: t("Promos", "Sale"), href: "https://" },
        ],
      };
    case "signature":
      return { id, type, avatarUrl: "", name: "Camille Durand", role: t(`Fondatrice, ${esc(brand)}`, `Founder, ${esc(brand)}`), text: t("Merci de faire partie de l'aventure. À très vite !", "Thanks for being part of the journey. See you soon!") };
  }
}

export function cloneBlock(block: Block): Block {
  return structuredClone({ ...block, id: uid() }) as Block;
}

/** Fields that hold rich HTML (vs plain text). */
export const RICH_FIELDS = new Set(["heading.text", "text.text", "footer.text", "quote.text", "hero.text", "imageText.text", "review.text", "signature.text"]);

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
const swatch = (key: string) => THEME_SWATCHES.find((s) => s.key === key)!.theme;
const H = (text: string, size: BlockOf<"heading">["size"], align: Align = "left"): Block => ({ id: uid(), type: "heading", text, size, align });
const P = (text: string, align: Align = "left"): Block => ({ id: uid(), type: "text", text, align, size: "md" });
const BTN = (label: string, align: Align = "left", full = false): Block => ({ id: uid(), type: "button", label, href: "https://", align, full });

export const PRESETS: Preset[] = [
  {
    key: "blank",
    name: t("Page blanche", "Blank page"),
    description: t("Logo, titre, texte, bouton.", "Logo, headline, text, button."),
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
    name: t("Soldes", "Sale"),
    description: t("Grosse remise, code promo, produits.", "Big discount, promo code, products."),
    subject: t("{{first_name|}}, -20 % sur tout, ce week-end seulement", "{{first_name|}}, 20% off everything, this weekend only"),
    preheader: t("Vos prix préférés n'ont jamais été aussi bas.", "Your favorites have never been this cheap."),
    build: (brand) => ({
      version: 2,
      theme: T(swatch("Vermillon")),
      blocks: [
        rawBlock("logo", brand),
        H(t("-20 %<br>sur tout.", "20% off<br>everything."), "xl"),
        P(
          t(
            "Bonjour {{first_name|}},<br><br>Ce week-end seulement, toute la boutique passe à <strong>-20 %</strong>. Les quantités sont limitées : vos favoris n'attendront pas.",
            "Hi {{first_name|}},<br><br>This weekend only, the whole store is <strong>20% off</strong>. Quantities are limited: your favorites won't wait.",
          ),
        ),
        { id: uid(), type: "promo", code: t("SOLDES20", "SALE20"), caption: t("À saisir au moment du paiement · jusqu'à dimanche minuit", "Enter it at checkout · until Sunday midnight") },
        {
          id: uid(),
          type: "columns",
          items: [
            { imageUrl: "", title: t("Pull mérinos", "Merino sweater"), text: t("<s>89 €</s> 71,20 €", "<s>€89</s> €71.20"), href: "https://", cta: t("J'en profite", "Grab it") },
            { imageUrl: "", title: t("Écharpe en laine", "Wool scarf"), text: t("<s>45 €</s> 36 €", "<s>€45</s> €36"), href: "https://", cta: t("J'en profite", "Grab it") },
          ],
        },
        BTN(t("Voir toute la boutique", "Shop the whole store"), "center", true),
        rawBlock("social", brand),
        rawBlock("footer", brand),
      ],
    }),
  },
  {
    key: "launch",
    name: t("Nouveauté", "Launch"),
    description: t("Lancement de produit, visuel fort.", "Product launch, bold visual."),
    subject: t("Nouveau : on l'attendait depuis longtemps", "New: the one we've all been waiting for"),
    preheader: t("Découvrez-le en avant-première.", "Be the first to see it."),
    build: (brand) => ({
      version: 2,
      theme: T(swatch("Nuit")),
      blocks: [
        rawBlock("logo", brand),
        rawBlock("image", brand),
        H(t("La nouvelle collection est là.", "The new collection is here."), "xl", "center"),
        P(t("{{first_name|Bonjour}}, vous êtes parmi les premiers à la découvrir. Des pièces pensées pour durer, en quantités limitées.", "{{first_name|Hi}}, you're among the first to see it. Pieces made to last, in limited quantities."), "center"),
        BTN(t("Découvrir la collection", "Discover the collection"), "center"),
        rawBlock("footer", brand),
      ],
    }),
  },
  {
    key: "welcome",
    name: t("Bienvenue", "Welcome"),
    description: t("Premier email après inscription.", "First email after sign-up."),
    subject: t("Bienvenue {{first_name|}} 👋", "Welcome {{first_name|}} 👋"),
    preheader: t("Un petit cadeau pour bien commencer.", "A little gift to get you started."),
    build: (brand) => ({
      version: 2,
      theme: T(swatch("Forêt")),
      blocks: [
        rawBlock("logo", brand),
        H(t("Bienvenue dans la famille.", "Welcome to the family."), "xl"),
        P(
          t(
            `Bonjour {{first_name|}},<br><br>Merci de nous avoir rejoints ! Chez ${esc(brand)}, on aime les choses bien faites. Pour fêter votre arrivée, voici un petit cadeau :`,
            `Hi {{first_name|}},<br><br>Thanks for joining us! At ${esc(brand)}, we love things done right. To celebrate your arrival, here's a little gift:`,
          ),
        ),
        { id: uid(), type: "promo", code: t("BIENVENUE10", "WELCOME10"), caption: t("-10 % sur votre première commande", "10% off your first order") },
        BTN(t("Faire mon premier achat", "Make my first purchase")),
        rawBlock("quote", brand),
        rawBlock("footer", brand),
      ],
    }),
  },
  {
    key: "cart",
    name: t("Panier abandonné", "Abandoned cart"),
    description: t("Relance douce avec le produit.", "Gentle reminder with the product."),
    subject: t("{{first_name|}}, vous avez oublié quelque chose", "{{first_name|}}, you forgot something"),
    preheader: t("Votre panier vous attend encore.", "Your cart is still waiting."),
    build: (brand) => ({
      version: 2,
      theme: T(),
      blocks: [
        rawBlock("logo", brand),
        H(t("Votre panier vous attend.", "Your cart is waiting."), "lg"),
        P(t("Bonjour {{first_name|}},<br><br>Vous étiez à deux clics de craquer. On a mis votre sélection de côté, mais pas pour longtemps.", "Hi {{first_name|}},<br><br>You were two clicks away. We saved your picks for you, but not for long.")),
        { id: uid(), type: "product", imageUrl: "", title: t("Votre article", "Your item"), price: t("59 €", "€59"), oldPrice: "", href: "https://", cta: t("Finaliser ma commande", "Complete my order"), layout: "left" },
        P(t("Une question ? Répondez simplement à cet email, on vous répond dans la journée.", "Questions? Just reply to this email and we'll get back to you the same day.")),
        rawBlock("footer", brand),
      ],
    }),
  },
  {
    key: "newsletter",
    name: t("Newsletter", "Newsletter"),
    description: t("Édito + plusieurs sujets.", "Editorial + several stories."),
    subject: t("Les nouvelles du mois chez nous", "This month's news from us"),
    preheader: t("Coulisses, nouveautés et coups de cœur.", "Behind the scenes, new arrivals and favorites."),
    build: (brand) => ({
      version: 2,
      theme: T(swatch("Encre")),
      blocks: [
        rawBlock("logo", brand),
        H(t("L'édito", "The editorial"), "lg"),
        P(t("Bonjour {{first_name|}},<br><br>Ce mois-ci, on vous emmène dans les coulisses de l'atelier et on vous présente nos trois coups de cœur.", "Hi {{first_name|}},<br><br>This month, we take you behind the scenes at the workshop and share our three favorites.")),
        rawBlock("divider", brand),
        rawBlock("video", brand),
        H(t("Nos coups de cœur", "Our favorites"), "md"),
        { id: uid(), type: "columns", items: [emptyColumn(1), emptyColumn(2), emptyColumn(3)] },
        BTN(t("Lire la suite", "Read more")),
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
  merged.customFonts = Array.isArray(merged.customFonts) ? [...merged.customFonts] : [];
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

const TAG_LABELS: Record<string, string> = { first_name: t("Prénom", "First name"), last_name: t("Nom", "Last name"), email: t("Email", "Email"), unsubscribe_url: t("Lien désinscription", "Unsubscribe link") };

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
    "font-family": fontStack(o.font, theme.buttonFont || theme.bodyFont, theme.customFonts),
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


function aligned(align: Align, btn: string): string {
  return `<div style="text-align:${align};"><div style="display:inline-block;">${btn}</div></div>`;
}

export type CountdownUnit = "days" | "hours" | "minutes" | "seconds";

/** Remaining time until `iso`, zero-padded. Also used at send time (server) and in previews. */
export function countdownParts(iso: string, now: number): Record<CountdownUnit, string> {
  const end = Date.parse(iso);
  let left = Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return { days: p(days), hours: p(hours), minutes: p(minutes), seconds: p(left - minutes * 60) };
}

export function formatUntil(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" }) : t("Date invalide", "Invalid date");
}

const HEADING_SIZES = { xl: 48, lg: 34, md: 22 } as const;
const TEXT_SIZES = { sm: -2, md: 0, lg: 2 } as const;

function inner(block: Block, ctx: Ctx): string {
  const { theme } = ctx;
  const hFont = (k?: string) => fontStack(k, theme.headingFont, theme.customFonts);
  const bFont = (k?: string) => fontStack(k, theme.bodyFont, theme.customFonts);
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
      if (!block.src) return ctx.canvas ? row(placeholder(ctx, 220, t("Glissez une image ici<br>ou choisissez-la dans le panneau de droite", "Drop an image here<br>or pick one in the right panel")), pad(ctx, block, 12, 12)) : "";
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
          ? placeholder(ctx, layout === "stack" ? 260 : 200, t("Photo", "Photo"))
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
              ? placeholder(ctx, Math.round(imgW * 0.9), t("Image", "Image"))
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
<p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${muted};">${inlineField(ctx, "label", block.label ?? t("Votre code", "Your code"))}</p>
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
          ? placeholder(ctx, 260, t("▶&nbsp; Miniature de la vidéo", "▶&nbsp; Video thumbnail"))
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
      if (!links) return ctx.canvas ? row(placeholder(ctx, 60, t("Ajoutez vos liens de réseaux sociaux", "Add your social media links")), pad(ctx, block, 12, 12)) : "";
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
      return row(block.html || (ctx.canvas ? placeholder(ctx, 60, t("Bloc HTML vide", "Empty HTML block")) : ""), pad(ctx, block, 12, 12));
    case "footer": {
      const color = block.color || muted;
      const lc = block.linkColor || color;
      return row(
        `<div style="border-top:1px solid ${mix(theme.text, 0.12)};padding-top:24px;font-family:${bFont()};font-size:${block.fontSize ?? 12}px;line-height:1.6;color:${color};text-align:${block.align ?? "center"};">${field(ctx, "text", block.text, true, lc)}<br><a href="{{unsubscribe_url}}" style="color:${lc};text-decoration:underline;">${inlineField(ctx, "unsubscribeLabel", block.unsubscribeLabel ?? t("Se désinscrire", "Unsubscribe"))}</a></div>`,
        pad(ctx, block, 28, 36),
      );
    }
    case "hero": {
      const fg = block.textColor || "#FFFFFF";
      const bg = block.bg || theme.text;
      const ov = Math.max(0, Math.min(90, block.overlay ?? 35)) / 100;
      const img = block.imageUrl ? `background-image:url('${esc(block.imageUrl)}');background-size:cover;background-position:center;` : "";
      const title = `<h1 style="${css({
        margin: "0 0 14px",
        "font-family": hFont(),
        "font-size": `${block.titleSize ?? 40}px`,
        "line-height": theme.headingLineHeight,
        "font-weight": theme.headingWeight,
        "letter-spacing": `${theme.headingSpacing}em`,
        "text-transform": theme.headingTransform === "uppercase" ? "uppercase" : undefined,
        color: fg,
      })}">${field(ctx, "title", block.title, false)}</h1>`;
      const text = `<div style="margin:0 0 24px;font-family:${bFont()};font-size:${theme.bodySize + 1}px;line-height:${theme.bodyLineHeight};color:${fg};opacity:0.92;">${field(ctx, "text", block.text, true, fg)}</div>`;
      const btn = block.showCta !== false ? aligned(block.align, buttonHtml(ctx, block.cta, block.href, false, "cta", { bg: block.buttonBg, fg: block.buttonText })) : "";
      const p = pad(ctx, block, 72, 72);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}"${block.imageUrl ? ` background="${esc(block.imageUrl)}"` : ""} style="background-color:${bg};${img}"><tr><td class="px" style="padding:${p};text-align:${block.align};background:${ov ? `rgba(0,0,0,${ov})` : "transparent"};">${title}${text}${btn}</td></tr></table>`;
    }
    case "imageText": {
      const share = Math.max(25, Math.min(65, block.imageWidth ?? 45));
      const imgW = Math.round((contentWidth * share) / 100);
      const img = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.title)}" width="${imgW}" style="display:block;width:100%;max-width:${imgW}px;height:auto;border:0;border-radius:${block.imageRadius ?? 12}px;">`
        : ctx.canvas
          ? placeholder(ctx, Math.round(imgW * 0.9), t("Image", "Image"))
          : "";
      const text = `<p style="margin:0 0 8px;font-family:${hFont()};font-size:22px;line-height:1.2;font-weight:${theme.headingWeight};${theme.headingTransform === "uppercase" ? "text-transform:uppercase;" : ""}color:${theme.text};">${inlineField(ctx, "title", block.title)}</p>
<div style="margin:0 0 16px;font-family:${bFont()};font-size:${theme.bodySize - 1}px;line-height:${theme.bodyLineHeight};color:${bodyColor(theme)};">${field(ctx, "text", block.text, true, linkColor(theme))}</div>
${block.showCta !== false ? buttonHtml(ctx, block.cta, block.href, false, "cta") : ""}`;
      const v = block.valign ?? "middle";
      const imgCell = `<td class="col" width="${share}%" valign="top" style="padding:0;">${img}</td>`;
      const right = block.layout === "right";
      const textCell = `<td class="col" valign="${v}" style="padding:${right ? "0 24px 0 0" : "0 0 0 24px"};">${text}</td>`;
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${right ? textCell + imgCell : imgCell + textCell}</tr></table>`, pad(ctx, block, 16, 16));
    }
    case "list": {
      const size = block.fontSize ?? theme.bodySize;
      const mc = block.markerColor || theme.accent;
      const gap = block.gap ?? 10;
      const marker = (i: number) => ({ bullet: "●", number: `${i + 1}.`, check: "✓", arrow: "→", star: "★" })[block.marker ?? "bullet"];
      const rows = block.items
        .map(
          (it, i) =>
            `<tr><td width="28" valign="top" style="padding:0 0 ${gap}px;font-family:${bFont()};font-size:${block.marker === "bullet" || !block.marker ? Math.round(size * 0.6) : size}px;line-height:${block.marker === "bullet" || !block.marker ? `${size * theme.bodyLineHeight}px` : theme.bodyLineHeight};font-weight:bold;color:${mc};">${marker(i)}</td><td valign="top" style="padding:0 0 ${gap}px;font-family:${bFont()};font-size:${size}px;line-height:${theme.bodyLineHeight};color:${block.color || bodyColor(theme)};">${inlineField(ctx, `items.${i}.text`, it.text)}</td></tr>`,
        )
        .join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, pad(ctx, block, 10, 4));
    }
    case "gallery": {
      const n = block.columns ?? 2;
      const gap = block.gap ?? 10;
      const w = Math.floor((contentWidth - gap * (n - 1)) / n);
      const cell = (im: { src: string; href: string; alt: string } | undefined, i: number) => {
        if (!im) return `<td class="col" width="${Math.floor(100 / n)}%"></td>`;
        const tag = im.src
          ? `<img src="${esc(im.src)}" alt="${esc(im.alt)}" width="${w}" style="display:block;width:100%;height:auto;border:0;border-radius:${block.radius ?? 10}px;">`
          : ctx.canvas
            ? placeholder(ctx, w, t(`Image ${i + 1}`, `Image ${i + 1}`))
            : "";
        const inner = im.href && im.src ? `<a href="${safeHref(im.href)}" target="_blank">${tag}</a>` : tag;
        const col = i % n;
        return `<td class="col" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 ${col < n - 1 ? gap / 2 : 0}px ${gap}px ${col > 0 ? gap / 2 : 0}px;">${inner}</td>`;
      };
      const rowsHtml: string[] = [];
      for (let r = 0; r < block.images.length; r += n) {
        const cells = Array.from({ length: n }, (_, k) => cell(block.images[r + k], r + k)).join("");
        rowsHtml.push(`<tr>${cells}</tr>`);
      }
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml.join("")}</table>`, pad(ctx, block, 12, 2));
    }
    case "buttons": {
      const outline = (block.secondaryStyle ?? "outline") === "outline";
      const a = buttonHtml(ctx, block.primary.label, block.primary.href, false, "primary.label");
      const b = outline
        ? buttonHtml(ctx, block.secondary.label, block.secondary.href, false, "secondary.label", { bg: theme.surface, fg: theme.accent, borderWidth: 2, borderColor: theme.accent })
        : `<a href="${safeHref(block.secondary.href)}" target="_blank" style="display:inline-block;padding:${theme.buttonPadY}px 8px;font-family:${bFont()};font-size:${theme.buttonSize}px;font-weight:${theme.buttonWeight};color:${linkColor(theme)};text-decoration:underline;">${inlineField(ctx, "secondary.label", block.secondary.label)}</a>`;
      const tableAlign = block.align === "left" ? "" : ` align="${block.align}"`;
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${tableAlign} style="${block.align === "center" ? "margin:0 auto;" : block.align === "right" ? "margin-left:auto;" : ""}"><tr><td style="padding:4px 6px 4px 0;">${a}</td><td style="padding:4px 0 4px 6px;">${b}</td></tr></table>`,
        pad(ctx, block, 18, 18),
      );
    }
    case "stats": {
      const n = block.items.length;
      const cells = block.items
        .map(
          (it, i) =>
            `<td class="col" width="${Math.floor(100 / n)}%" align="center" valign="top" style="padding:0 6px;text-align:center;"><p style="margin:0;font-family:${hFont()};font-size:${block.valueSize ?? 34}px;line-height:1.1;font-weight:${theme.headingWeight};letter-spacing:${theme.headingSpacing}em;color:${block.color || theme.accent};">${inlineField(ctx, `items.${i}.value`, it.value)}</p><p style="margin:6px 0 0;font-family:${bFont()};font-size:13px;line-height:1.4;color:${block.labelColor || muted};">${inlineField(ctx, `items.${i}.label`, it.label)}</p></td>`,
        )
        .join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, pad(ctx, block, 20, 20));
    }
    case "review": {
      const align = block.align ?? "center";
      const r = Math.max(0, Math.min(5, Math.round(block.rating)));
      const stars = `<span style="color:${block.starColor || "#F5B301"};">${"★".repeat(r)}</span><span style="color:${mix(theme.text, 0.18)};">${"★".repeat(5 - r)}</span>`;
      const avatar = block.avatarUrl ? `<img src="${esc(block.avatarUrl)}" alt="" width="40" height="40" style="display:inline-block;width:40px;height:40px;border-radius:999px;vertical-align:middle;margin-right:10px;border:0;">` : "";
      return row(
        `<div style="${css({ background: block.cardBg, padding: block.cardBg ? "24px" : undefined, "border-radius": block.cardBg ? "16px" : undefined, "text-align": align })}">
<p style="margin:0 0 12px;font-size:22px;letter-spacing:3px;line-height:1;">${stars}</p>
<div style="margin:0 0 14px;font-family:${hFont()};font-size:19px;line-height:1.45;color:${theme.text};">${field(ctx, "text", block.text, true, linkColor(theme))}</div>
<p style="margin:0;font-family:${bFont()};font-size:13px;font-weight:bold;color:${muted};">${avatar}${inlineField(ctx, "author", block.author)}</p>
</div>`,
        pad(ctx, block, 18, 18),
      );
    }
    case "faq": {
      const sep = block.separators !== false;
      const items = block.items
        .map(
          (it, i) =>
            `<div style="padding:16px 0;${sep && i > 0 ? `border-top:1px solid ${mix(theme.text, 0.1)};` : ""}"><p style="margin:0 0 6px;font-family:${hFont()};font-size:17px;line-height:1.3;font-weight:${theme.headingWeight};color:${block.qColor || theme.text};">${inlineField(ctx, `items.${i}.q`, it.q)}</p><div style="margin:0;font-family:${bFont()};font-size:${theme.bodySize - 1}px;line-height:${theme.bodyLineHeight};color:${bodyColor(theme)};">${field(ctx, `items.${i}.a`, it.a, true, linkColor(theme))}</div></div>`,
        )
        .join("");
      return row(items, pad(ctx, block, 8, 8));
    }
    case "features": {
      const ibg = block.iconBg || mix(theme.accent, 0.1);
      const icon = (i: number, ic: string) => `<span style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:999px;background:${ibg};text-align:center;font-size:22px;">${inlineField(ctx, `items.${i}.icon`, ic)}</span>`;
      const title = (i: number, t: string) => `<p style="margin:10px 0 4px;font-family:${hFont()};font-size:15px;line-height:1.3;font-weight:${theme.headingWeight};color:${theme.text};">${inlineField(ctx, `items.${i}.title`, t)}</p>`;
      const desc = (i: number, t: string) => `<p style="margin:0;font-family:${bFont()};font-size:13px;line-height:1.5;color:${muted};">${inlineField(ctx, `items.${i}.text`, t)}</p>`;
      if (block.layout === "list") {
        const rows = block.items.map((it, i) => `<tr><td width="60" valign="top" style="padding:0 0 14px;">${icon(i, it.icon)}</td><td valign="middle" style="padding:0 0 14px;">${title(i, it.title).replace("margin:10px 0 4px", "margin:0 0 2px")}${desc(i, it.text)}</td></tr>`).join("");
        return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, pad(ctx, block, 16, 4));
      }
      const n = block.items.length;
      const align = block.align ?? "center";
      const cells = block.items.map((it, i) => `<td class="col" width="${Math.floor(100 / n)}%" valign="top" style="padding:0 8px;text-align:${align};">${icon(i, it.icon)}${title(i, it.title)}${desc(i, it.text)}</td>`).join("");
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, pad(ctx, block, 20, 20));
    }
    case "countdown": {
      const color = block.color || theme.text;
      const boxBg = block.boxBg || mix(theme.text, 0.06);
      const live = countdownParts(block.until, Date.now());
      const units: Array<[CountdownUnit, string]> = [
        ["days", t("jours", "days")],
        ["hours", t("heures", "hours")],
        ["minutes", t("minutes", "minutes")],
      ];
      if (block.showSeconds) units.push(["seconds", t("secondes", "seconds")]);
      const value = (u: CountdownUnit) => (ctx.canvas ? live[u] : `{{countdown_${u}|${block.until}}}`);
      const cells = units
        .map(
          ([u, label]) =>
            `<td align="center" style="padding:0 5px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${boxBg}" style="background:${boxBg};border-radius:12px;width:68px;padding:12px 0 10px;"><p style="margin:0;font-family:${hFont()};font-size:32px;line-height:1;font-weight:${theme.headingWeight};color:${color};">${value(u)}</p><p style="margin:6px 0 0;font-family:${bFont()};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${mix(color, 0.6)};">${label}</p></td></tr></table></td>`,
        )
        .join("");
      return row(
        `<div style="${css({ background: block.bg, padding: block.bg ? "24px 12px" : undefined, "border-radius": block.bg ? "16px" : undefined, "text-align": "center" })}"><p style="margin:0 0 14px;font-family:${bFont()};font-size:13px;font-weight:bold;letter-spacing:0.14em;text-transform:uppercase;color:${color};">${inlineField(ctx, "title", block.title)}</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>${cells}</tr></table></div>`,
        pad(ctx, block, 18, 18),
      );
    }
    case "event": {
      const ac = block.accent || theme.accent;
      const line = (emoji: string, path: string, v: string) => (v || ctx.canvas ? `<p style="margin:0 0 6px;font-family:${bFont()};font-size:15px;line-height:1.5;color:${bodyColor(theme)};">${emoji}&nbsp; ${inlineField(ctx, path, v)}</p>` : "");
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${block.cardBg ? ` bgcolor="${block.cardBg}"` : ""} style="${css({ background: block.cardBg || mix(ac, 0.06), "border-radius": "16px", "border-left": `4px solid ${ac}` })}"><tr><td style="padding:22px 24px;">
<p style="margin:0 0 6px;font-family:${bFont()};font-size:11px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;color:${ac};">${t("Événement", "Event")}</p>
<p style="margin:0 0 14px;font-family:${hFont()};font-size:24px;line-height:1.2;font-weight:${theme.headingWeight};${theme.headingTransform === "uppercase" ? "text-transform:uppercase;" : ""}color:${theme.text};">${inlineField(ctx, "title", block.title)}</p>
${line("📅", "date", block.date)}${line("🕒", "time", block.time)}${line("📍", "place", block.place)}
<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
${buttonHtml(ctx, block.cta, block.href, false, "cta", { bg: block.accent })}
</td></tr></table>`,
        pad(ctx, block, 14, 14),
      );
    }
    case "survey": {
      const color = block.color || theme.accent;
      const href = (v: string) => {
        const base = safeHref(block.href);
        return `${base}${base.includes("?") ? "&" : "?"}note=${encodeURIComponent(v)}`;
      };
      const opts: Array<[string, string]> =
        block.scale === "emoji"
          ? [["1", "😞"], ["2", "🙁"], ["3", "😐"], ["4", "🙂"], ["5", "😍"]]
          : block.scale === "nps"
            ? Array.from({ length: 11 }, (_, i) => [String(i), String(i)] as [string, string])
            : block.scale === "yesno"
              ? [["oui", t("Oui", "Yes")], ["non", t("Non", "No")]]
              : [["1", "★"], ["2", "★★"], ["3", "★★★"], ["4", "★★★★"], ["5", "★★★★★"]];
      const cell = ([v, label]: [string, string]) => {
        if (block.scale === "emoji") return `<td style="padding:0 4px;"><a href="${href(v)}" target="_blank" style="display:inline-block;font-size:34px;line-height:1;text-decoration:none;">${label}</a></td>`;
        if (block.scale === "nps") return `<td style="padding:0 2px;"><a href="${href(v)}" target="_blank" style="display:inline-block;width:30px;line-height:34px;border-radius:8px;border:1px solid ${mix(color, 0.35)};font-family:${bFont()};font-size:13px;font-weight:bold;color:${color};text-align:center;text-decoration:none;">${label}</a></td>`;
        if (block.scale === "yesno") return `<td style="padding:0 6px;"><a href="${href(v)}" target="_blank" style="display:inline-block;padding:12px 30px;border-radius:${Math.min(theme.radius, 999)}px;border:2px solid ${color};font-family:${bFont()};font-size:15px;font-weight:bold;color:${color};text-decoration:none;">${label}</a></td>`;
        return `<td style="padding:0 0 6px;"><a href="${href(v)}" target="_blank" style="display:block;font-size:20px;letter-spacing:2px;color:${color};text-decoration:none;">${label}</a></td>`;
      };
      const stars = block.scale === "stars" || !block.scale;
      const body = stars
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">${opts.map((o) => `<tr>${cell(o)}</tr>`).reverse().join("")}</table>`
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>${opts.map(cell).join("")}</tr></table>`;
      const scaleLabels =
        block.scale === "nps" || block.scale === "emoji"
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${block.scale === "nps" ? 374 : 240}px;margin:8px auto 0;"><tr><td style="font-family:${bFont()};font-size:11px;color:${muted};text-align:left;">${inlineField(ctx, "lowLabel", block.lowLabel ?? "")}</td><td style="font-family:${bFont()};font-size:11px;color:${muted};text-align:right;">${inlineField(ctx, "highLabel", block.highLabel ?? "")}</td></tr></table>`
          : "";
      return row(
        `<div style="text-align:center;"><p style="margin:0 0 16px;font-family:${hFont()};font-size:20px;line-height:1.3;font-weight:${theme.headingWeight};color:${theme.text};">${inlineField(ctx, "question", block.question)}</p>${body}${scaleLabels}</div>`,
        pad(ctx, block, 20, 20),
      );
    }
    case "apps": {
      // Official store badges (Apple and Google artwork, unaltered), hosted with the app so every inbox shows them.
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const lang = LANG === "fr" ? "fr" : "en";
      const badge = (url: string, file: string, width: number, alt: string) =>
        url.trim() && url.trim() !== "https://"
          ? `<td style="padding:4px;"><a href="${safeHref(url)}" target="_blank" style="display:inline-block;text-decoration:none;"><img src="${base}/email/badges/${file}-${lang}.png" alt="${alt}" width="${width}" height="40" style="display:block;width:${width}px;height:40px;border:0;"></a></td>`
          : "";
      const cells =
        badge(block.iosUrl, "app-store", lang === "fr" ? 127 : 120, t("Télécharger dans l'App Store", "Download on the App Store")) +
        badge(block.androidUrl, "google-play", 135, t("Disponible sur Google Play", "Get it on Google Play"));
      if (!cells) return ctx.canvas ? row(placeholder(ctx, 60, t("Ajoutez les liens de vos applis", "Add your app links")), pad(ctx, block, 12, 12)) : "";
      return row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"${block.align === "left" ? "" : ` align="${block.align}"`} style="${block.align === "center" ? "margin:0 auto;" : block.align === "right" ? "margin-left:auto;" : ""}"><tr>${cells}</tr></table>`, pad(ctx, block, 16, 16));
    }
    case "menu": {
      const color = block.color || theme.text;
      const sep = block.separator ? `<span style="color:${mix(color, 0.3)};padding:0 4px;">·</span>` : "";
      const links = block.links
        .map(
          (l, i) =>
            `<a href="${safeHref(l.href)}" target="_blank" style="display:inline-block;padding:4px 10px;font-family:${bFont()};font-size:${block.fontSize ?? 13}px;font-weight:bold;${block.uppercase ? "text-transform:uppercase;letter-spacing:0.1em;" : ""}color:${color};text-decoration:none;">${inlineField(ctx, `links.${i}.label`, l.label)}</a>`,
        )
        .join(sep);
      return row(`<div style="text-align:${block.align};">${links}</div>`, pad(ctx, block, 12, 12));
    }
    case "signature": {
      const avatar = block.avatarUrl
        ? `<img src="${esc(block.avatarUrl)}" alt="${esc(block.name)}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:999px;border:0;">`
        : `<div style="width:56px;height:56px;line-height:56px;border-radius:999px;background:${mix(theme.accent, 0.12)};text-align:center;font-family:${hFont()};font-size:20px;font-weight:bold;color:${theme.accent};">${esc((block.name.trim()[0] ?? "?").toUpperCase())}</div>`;
      return row(
        `<div style="margin:0 0 18px;font-family:${bFont()};font-size:${theme.bodySize}px;line-height:${theme.bodyLineHeight};color:${bodyColor(theme)};">${field(ctx, "text", block.text, true, linkColor(theme))}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:14px;">${avatar}</td><td valign="middle"><p style="margin:0;font-family:${hFont()};font-size:16px;font-weight:bold;color:${block.nameColor || theme.text};">${inlineField(ctx, "name", block.name)}</p><p style="margin:2px 0 0;font-family:${bFont()};font-size:13px;color:${muted};">${inlineField(ctx, "role", block.role)}</p></td></tr></table>`,
        pad(ctx, block, 16, 16),
      );
    }
  }
}

// --- Sections ----------------------------------------------------------------------
// Consecutive blocks with the same section background (and inset) form one section: a single box
// holding them all, so its rounded corners, border and glow span the whole section.

const sectionKey = (b: Block | undefined) => (b?.style?.bg ? `${b.style.bg.toLowerCase()}|${b.style.inset ?? 0}` : null);

export interface SectionGroup {
  start: number;
  /** Exclusive. */
  end: number;
  /** The section's look (background, inset, radius, border, glow); null = blocks outside any section. */
  style: BlockStyle | null;
}

/** The section look shared by a run of blocks: each setting is taken from the first block that has it. */
function sectionStyle(blocks: Block[]): BlockStyle {
  const pick = <K extends keyof BlockStyle>(k: K) => blocks.find((b) => b.style?.[k] !== undefined && b.style?.[k] !== "")?.style?.[k];
  return { bg: blocks[0].style?.bg, inset: blocks[0].style?.inset, radius: pick("radius"), borderWidth: pick("borderWidth"), borderColor: pick("borderColor"), glow: pick("glow"), glowAt: pick("glowAt") };
}

export function sectionGroups(blocks: Block[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let i = 0;
  while (i < blocks.length) {
    const key = sectionKey(blocks[i]);
    let j = i + 1;
    if (key) while (j < blocks.length && sectionKey(blocks[j]) === key) j++;
    groups.push({ start: i, end: j, style: key ? sectionStyle(blocks.slice(i, j)) : null });
    i = j;
  }
  return groups;
}

/** Indexes of the blocks in the same section as `index` (just itself outside a section). */
export function sectionOf(blocks: Block[], index: number): number[] {
  const g = sectionGroups(blocks).find((x) => index >= x.start && index < x.end);
  return g && g.style ? Array.from({ length: g.end - g.start }, (_, k) => g.start + k) : [index];
}

function hexRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Halfway colour between two hex colours (`t` = share of `b`). */
function blend(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function glowGradient(bg: string, glow: string, at: "bottom" | "corner" = "bottom"): string {
  const mid = blend(glow, bg, 0.45);
  return at === "corner"
    ? `radial-gradient(120% 70% at 100% 115%, ${glow} 0%, ${mid} 30%, ${bg} 65%)`
    : `radial-gradient(130% 90% at 50% 118%, ${glow} 0%, ${mid} 26%, ${bg} 62%)`;
}

/** CSS of a section's box (also used by the editor canvas). */
export function sectionBoxCss(s: BlockStyle, theme: Theme): Record<string, string | undefined> {
  const r = s.radius ?? 0;
  return {
    "background-color": s.bg,
    "background-image": s.bg && s.glow ? glowGradient(s.bg, s.glow, s.glowAt) : undefined,
    "border-radius": r ? `${r}px` : undefined,
    border: s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor || mix(theme.text, 0.15)}` : undefined,
    overflow: r ? "hidden" : undefined,
  };
}

function sectionTable(s: BlockStyle, theme: Theme, html: string, cls = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${cls ? ` class="${cls}"` : ""}><tr><td style="padding:0 ${s.inset ?? 0}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${s.bg ? ` bgcolor="${s.bg}"` : ""} style="${css(sectionBoxCss(s, theme))}"><tr><td>${html}</td></tr></table></td></tr></table>`;
}

/** Renders a single block. `canvas` adds placeholders and (if `editable`) inline-editable fields. */
export function renderBlock(block: Block, baseTheme: Theme, opts: { canvas?: boolean; editable?: boolean; inSection?: boolean } = {}): string {
  const s = block.style;
  const theme: Theme = s
    ? {
        ...baseTheme,
        headingFont: s.headingFont || baseTheme.headingFont,
        bodyFont: s.bodyFont || baseTheme.bodyFont,
        buttonFont: s.bodyFont ? "" : baseTheme.buttonFont,
        text: s.headingColor || baseTheme.text,
        body: s.textColor || baseTheme.body,
        accent: s.accent || baseTheme.accent,
      }
    : baseTheme;
  const ctx: Ctx = { theme, canvas: !!opts.canvas, editable: !!opts.editable };
  let html = inner(block, ctx);
  if (!html) return "";
  if (s?.textScale && s.textScale !== 100) {
    const k = s.textScale / 100;
    html = html.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (_m, n: string) => `font-size:${Math.max(8, Math.round(Number(n) * k))}px`);
  }
  const cls = [s?.hideMobile ? "hide-m" : "", s?.hideDesktop ? "hide-d" : ""].filter(Boolean).join(" ");
  // Inside a section, the section draws the box; the block keeps only its visibility.
  if (opts.inSection) return cls && !ctx.canvas ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${cls}"><tr><td>${html}</td></tr></table>` : html;
  const boxed = !!(s?.bg || s?.radius || s?.borderWidth);
  if (!boxed && !cls && !s?.inset) return html;
  const look: BlockStyle = { ...s, inset: s?.inset ?? 0 };
  if (ctx.canvas) return `<div style="padding:0 ${look.inset}px;"><div style="${css(sectionBoxCss(look, theme))}">${html}</div></div>`;
  return sectionTable(look, theme, html, cls);
}

/** Google Fonts used by a design (theme + block overrides). */
function usedFontKeys(design: Design): Set<string> {
  const t = design.theme;
  const keys = new Set<string>([t.headingFont, t.bodyFont, t.buttonFont].filter(Boolean));
  for (const b of design.blocks) {
    if ("font" in b && b.font) keys.add(b.font);
    if (b.style?.headingFont) keys.add(b.style.headingFont);
    if (b.style?.bodyFont) keys.add(b.style.bodyFont);
  }
  return keys;
}

export function usedWebFonts(design: Design): string[] {
  const custom = design.theme.customFonts ?? [];
  return [...new Set([...usedFontKeys(design)].map((k) => fontDef(k, custom)?.google).filter((g): g is string => !!g))];
}

const FONT_FORMATS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/** @font-face rules for uploaded fonts. `all` = every custom font (editor), else only those used. */
export function fontFaceCss(theme: Theme, keys?: Set<string>): string {
  return (theme.customFonts ?? [])
    .filter((f) => f.source === "upload" && f.url && (!keys || keys.has(f.key)))
    .map((f) => {
      const fmt = FONT_FORMATS[f.url!.split(".").pop()?.toLowerCase() ?? ""] ?? "woff2";
      return `@font-face { font-family: '${f.family.replace(/'/g, "")}'; src: url('${f.url!.replace(/'/g, "")}') format('${fmt}'); font-display: swap; }`;
    })
    .join("\n");
}

export function googleFontsHref(families: string[]): string | null {
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap` : null;
}

/** Full, standalone email document. Always contains an unsubscribe link. */
export function renderEmail(design: Design, preheader = ""): string {
  const { theme } = design;
  const body = sectionGroups(design.blocks)
    .map((g) => {
      const blocks = design.blocks.slice(g.start, g.end);
      if (!g.style) return blocks.map((b) => renderBlock(b, theme)).join("\n");
      return sectionTable(g.style, theme, blocks.map((b) => renderBlock(b, theme, { inSection: true })).join("\n"));
    })
    .join("\n");
  const hasFooter = design.blocks.some((b) => b.type === "footer");
  const muted = mutedColor(theme);
  const footer = hasFooter
    ? ""
    : row(`<div style="font-family:${fontStack(theme.bodyFont, "helvetica")};font-size:12px;color:${muted};text-align:center;"><a href="{{unsubscribe_url}}" style="color:${muted};">${t("Se désinscrire", "Unsubscribe")}</a></div>`, `24px ${theme.padX}px 32px`);
  const fonts = googleFontsHref(usedWebFonts(design));
  const faces = fontFaceCss(theme, usedFontKeys(design));
  const border = theme.borderWidth > 0 ? `border:${theme.borderWidth}px solid ${theme.borderColor};` : "";
  return `<!DOCTYPE html>
<html lang="${LANG}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
${fonts ? `<link href="${fonts}" rel="stylesheet">` : ""}
<style>
${faces}
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
  return RICH_FIELDS.has(`${block.type}.${path}`) || (block.type === "columns" && /^items\.\d+\.text$/.test(path)) || (block.type === "faq" && /^items\.\d+\.a$/.test(path));
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
      return block.alt || (block.src ? block.src.split("/").pop() ?? "" : t("Sans image", "No image"));
    case "social":
      return block.links.map((l) => SOCIAL_LABELS[l.network]).join(", ");
    case "spacer":
      return `${block.height} px`;
    case "html":
      return t("Code personnalisé", "Custom code");
    case "hero":
    case "imageText":
    case "event":
      return block.title;
    case "list":
      return block.items.map((i) => strip(i.text)).join(" · ");
    case "gallery":
      return t(`${block.images.length} images`, `${block.images.length} ${block.images.length === 1 ? "image" : "images"}`);
    case "buttons":
      return `${block.primary.label} · ${block.secondary.label}`;
    case "stats":
      return block.items.map((i) => i.value).join(" · ");
    case "review":
      return `${"★".repeat(block.rating)} ${block.author}`;
    case "faq":
      return block.items.map((i) => i.q).join(" · ");
    case "features":
      return block.items.map((i) => i.title).join(" · ");
    case "countdown":
      return formatUntil(block.until);
    case "survey":
      return block.question;
    case "apps":
      return "App Store · Google Play";
    case "menu":
      return block.links.map((l) => l.label).join(" · ");
    case "signature":
      return block.name;
    default:
      return "";
  }
}

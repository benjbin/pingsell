/**
 * Visual email builder — data model, presets and the email-safe HTML renderer.
 *
 * A design is a list of blocks plus a theme. Each block renders to a self-contained,
 * table-based HTML snippet with inline styles, so the same markup is used for the
 * on-canvas WYSIWYG view and for the final email (`renderEmail`).
 */

export type Align = "left" | "center" | "right";

export type Block =
  | { id: string; type: "logo"; text: string; imageUrl: string; align: Align }
  | { id: string; type: "heading"; text: string; size: "xl" | "lg" | "md"; align: Align }
  | { id: string; type: "text"; text: string; align: Align }
  | { id: string; type: "image"; src: string; alt: string; href: string }
  | { id: string; type: "button"; label: string; href: string; align: Align; full: boolean }
  | { id: string; type: "product"; imageUrl: string; title: string; price: string; oldPrice: string; href: string; cta: string }
  | { id: string; type: "promo"; code: string; caption: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; height: number }
  | { id: string; type: "footer"; text: string };

export type BlockType = Block["type"];

export interface Theme {
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  font: "sans" | "serif";
  radius: number;
}

export interface Design {
  version: 1;
  theme: Theme;
  blocks: Block[];
}

export const FONTS: Record<Theme["font"], { label: string; heading: string; body: string }> = {
  sans: {
    label: "Moderne",
    heading: "Helvetica, Arial, sans-serif",
    body: "Helvetica, Arial, sans-serif",
  },
  serif: {
    label: "Éditorial",
    heading: "Georgia, 'Times New Roman', serif",
    body: "Helvetica, Arial, sans-serif",
  },
};

export const DEFAULT_THEME: Theme = {
  background: "#F3F1EA",
  surface: "#FFFFFF",
  text: "#0E0E0C",
  accent: "#0E0E0C",
  accentText: "#FFFFFF",
  font: "serif",
  radius: 999,
};

export const THEME_SWATCHES: Array<{ name: string; theme: Partial<Theme> }> = [
  { name: "Encre", theme: { background: "#F3F1EA", surface: "#FFFFFF", text: "#0E0E0C", accent: "#0E0E0C", accentText: "#FFFFFF" } },
  { name: "Vermillon", theme: { background: "#FFF3EE", surface: "#FFFFFF", text: "#1A1A18", accent: "#FF4D1C", accentText: "#FFFFFF" } },
  { name: "Forêt", theme: { background: "#EEF2EC", surface: "#FFFFFF", text: "#16241B", accent: "#1F4D36", accentText: "#FFFFFF" } },
  { name: "Océan", theme: { background: "#EDF2F7", surface: "#FFFFFF", text: "#0F1E2E", accent: "#1D4ED8", accentText: "#FFFFFF" } },
  { name: "Nuit", theme: { background: "#0E0E0C", surface: "#181816", text: "#F3F1EA", accent: "#C9B48A", accentText: "#0E0E0C" } },
];

// --- Factories --------------------------------------------------------------

let counter = 0;
export function uid(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const BLOCK_LIBRARY: Array<{ type: BlockType; label: string; hint: string }> = [
  { type: "logo", label: "Logo", hint: "Nom ou image de marque" },
  { type: "heading", label: "Titre", hint: "Grand titre accrocheur" },
  { type: "text", label: "Texte", hint: "Paragraphe" },
  { type: "image", label: "Image", hint: "Visuel pleine largeur" },
  { type: "button", label: "Bouton", hint: "Appel à l'action" },
  { type: "product", label: "Produit", hint: "Photo, prix, lien" },
  { type: "promo", label: "Code promo", hint: "Code à copier" },
  { type: "divider", label: "Séparateur", hint: "Ligne fine" },
  { type: "spacer", label: "Espace", hint: "Respiration verticale" },
  { type: "footer", label: "Pied de page", hint: "Mentions + désinscription" },
];

export function createBlock(type: BlockType, brand = "Votre marque"): Block {
  const id = uid();
  switch (type) {
    case "logo":
      return { id, type, text: brand, imageUrl: "", align: "center" };
    case "heading":
      return { id, type, text: "Un titre qui donne envie", size: "lg", align: "left" };
    case "text":
      return { id, type, text: "Bonjour {{first_name|}},\n\nRacontez ici votre nouveauté, votre offre ou votre histoire. Restez court : une idée, une émotion, une action.", align: "left" };
    case "image":
      return { id, type, src: "", alt: "", href: "" };
    case "button":
      return { id, type, label: "Découvrir", href: "https://", align: "left", full: false };
    case "product":
      return { id, type, imageUrl: "", title: "Nom du produit", price: "49 €", oldPrice: "", href: "https://", cta: "Voir le produit" };
    case "promo":
      return { id, type, code: "BIENVENUE10", caption: "-10 % sur votre première commande" };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, height: 24 };
    case "footer":
      return { id, type, text: `${brand} · Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.` };
  }
}

export function cloneBlock(block: Block): Block {
  return { ...block, id: uid() } as Block;
}

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

export const PRESETS: Preset[] = [
  {
    key: "blank",
    name: "Page blanche",
    description: "Logo, titre, texte, bouton.",
    subject: "",
    preheader: "",
    build: (brand) => ({
      version: 1,
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
      version: 1,
      theme: T({ background: "#FFF3EE", accent: "#FF4D1C" }),
      blocks: [
        { ...createBlock("logo", brand) },
        { id: uid(), type: "heading", text: "-20 %\nsur tout.", size: "xl", align: "left" },
        { id: uid(), type: "text", text: "Bonjour {{first_name|}},\n\nCe week-end seulement, toute la boutique passe à -20 %. Les quantités sont limitées : vos favoris n'attendront pas.", align: "left" },
        { id: uid(), type: "promo", code: "SOLDES20", caption: "À saisir au moment du paiement · jusqu'à dimanche minuit" },
        { id: uid(), type: "product", imageUrl: "", title: "Pull en laine mérinos", price: "71,20 €", oldPrice: "89 €", href: "https://", cta: "J'en profite" },
        { id: uid(), type: "button", label: "Voir toute la boutique", href: "https://", align: "center", full: true },
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
      version: 1,
      theme: T({ background: "#0E0E0C", surface: "#181816", text: "#F3F1EA", accent: "#C9B48A", accentText: "#0E0E0C" }),
      blocks: [
        createBlock("logo", brand),
        createBlock("image"),
        { id: uid(), type: "heading", text: "La nouvelle collection est là.", size: "xl", align: "center" },
        { id: uid(), type: "text", text: "{{first_name|Bonjour}}, vous êtes parmi les premiers à la découvrir. Des pièces pensées pour durer, en quantités limitées.", align: "center" },
        { id: uid(), type: "button", label: "Découvrir la collection", href: "https://", align: "center", full: false },
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
      version: 1,
      theme: T({ background: "#EEF2EC", accent: "#1F4D36" }),
      blocks: [
        createBlock("logo", brand),
        { id: uid(), type: "heading", text: "Bienvenue dans la famille.", size: "xl", align: "left" },
        { id: uid(), type: "text", text: `Bonjour {{first_name|}},\n\nMerci de nous avoir rejoints ! Chez ${brand}, on aime les choses bien faites. Pour fêter votre arrivée, voici un petit cadeau :`, align: "left" },
        { id: uid(), type: "promo", code: "BIENVENUE10", caption: "-10 % sur votre première commande" },
        { id: uid(), type: "button", label: "Faire mon premier achat", href: "https://", align: "left", full: false },
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
      version: 1,
      theme: T(),
      blocks: [
        createBlock("logo", brand),
        { id: uid(), type: "heading", text: "Votre panier vous attend.", size: "lg", align: "left" },
        { id: uid(), type: "text", text: "Bonjour {{first_name|}},\n\nVous étiez à deux clics de craquer. On a mis votre sélection de côté, mais pas pour longtemps.", align: "left" },
        { id: uid(), type: "product", imageUrl: "", title: "Votre article", price: "59 €", oldPrice: "", href: "https://", cta: "Finaliser ma commande" },
        { id: uid(), type: "text", text: "Une question ? Répondez simplement à cet email, on vous répond dans la journée.", align: "left" },
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
      version: 1,
      theme: T({ background: "#EDF2F7", accent: "#1D4ED8", font: "serif" }),
      blocks: [
        createBlock("logo", brand),
        { id: uid(), type: "heading", text: "L'édito", size: "lg", align: "left" },
        { id: uid(), type: "text", text: "Bonjour {{first_name|}},\n\nCe mois-ci, on vous emmène dans les coulisses de l'atelier et on vous présente nos trois coups de cœur.", align: "left" },
        { id: uid(), type: "divider" },
        { id: uid(), type: "heading", text: "1. Dans l'atelier", size: "md", align: "left" },
        { id: uid(), type: "text", text: "Quelques lignes sur votre premier sujet.", align: "left" },
        { id: uid(), type: "heading", text: "2. Le coup de cœur", size: "md", align: "left" },
        { id: uid(), type: "text", text: "Quelques lignes sur votre deuxième sujet.", align: "left" },
        { id: uid(), type: "button", label: "Lire la suite", href: "https://", align: "left", full: false },
        createBlock("footer", brand),
      ],
    }),
  },
];

// --- Serialization ------------------------------------------------------------

export function parseDesign(raw: string | null | undefined): Design | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Design;
    if (d && d.version === 1 && Array.isArray(d.blocks) && d.theme) return { ...d, theme: { ...DEFAULT_THEME, ...d.theme } };
  } catch {
    /* invalid JSON → treated as no design */
  }
  return null;
}

export function serializeDesign(design: Design): string {
  return JSON.stringify(design);
}

// --- Rendering ------------------------------------------------------------------

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape and turn line breaks into <br>; **bold** becomes <strong>. Merge tags are left untouched. */
function richText(value: string): string {
  return esc(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function safeHref(href: string): string {
  const h = href.trim();
  if (!h || h === "https://") return "#";
  if (/^(https?:|mailto:|tel:|\{\{)/i.test(h)) return esc(h);
  return esc(`https://${h}`);
}

function mix(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const PAD = "0 40px";

function row(inner: string, padding = PAD): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:${padding};">${inner}</td></tr></table>`;
}

function buttonHtml(label: string, href: string, theme: Theme, full: boolean): string {
  const radius = Math.min(theme.radius, 999);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ""} style="border-collapse:separate;"><tr><td align="center" bgcolor="${theme.accent}" style="background:${theme.accent};border-radius:${radius}px;"><a href="${safeHref(href)}" target="_blank" style="display:${full ? "block" : "inline-block"};padding:15px 30px;font-family:${FONTS.sans.body};font-size:15px;font-weight:bold;letter-spacing:0.01em;color:${theme.accentText};text-decoration:none;border-radius:${radius}px;">${esc(label)}</a></td></tr></table>`;
}

/** Renders a single block as an email-safe snippet. `forCanvas` keeps empty placeholders visible. */
export function renderBlock(block: Block, theme: Theme, forCanvas = false): string {
  const f = FONTS[theme.font];
  const muted = mix(theme.text, 0.6);
  switch (block.type) {
    case "logo": {
      const inner = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.text)}" height="40" style="display:inline-block;height:40px;width:auto;border:0;">`
        : `<span style="font-family:${f.heading};font-size:24px;font-style:${theme.font === "serif" ? "italic" : "normal"};font-weight:${theme.font === "serif" ? "normal" : "bold"};letter-spacing:-0.01em;color:${theme.text};">${esc(block.text)}</span>`;
      return row(`<div style="text-align:${block.align};">${inner}</div>`, "32px 40px 24px");
    }
    case "heading": {
      const size = block.size === "xl" ? 48 : block.size === "lg" ? 34 : 22;
      return row(
        `<h1 style="margin:0;font-family:${f.heading};font-size:${size}px;line-height:1.05;font-weight:${theme.font === "serif" ? "normal" : "bold"};letter-spacing:-0.02em;color:${theme.text};text-align:${block.align};">${richText(block.text)}</h1>`,
        "12px 40px",
      );
    }
    case "text":
      return row(
        `<p style="margin:0;font-family:${f.body};font-size:16px;line-height:1.65;color:${mix(theme.text, 0.82)};text-align:${block.align};">${richText(block.text)}</p>`,
        "10px 40px",
      );
    case "image": {
      if (!block.src) {
        return forCanvas
          ? row(
              `<div style="height:220px;border:1.5px dashed ${mix(theme.text, 0.25)};border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:${f.body};font-size:13px;color:${muted};">Ajoutez l'URL d'une image</div>`,
              "12px 40px",
            )
          : "";
      }
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px;">`;
      return row(block.href ? `<a href="${safeHref(block.href)}" target="_blank">${img}</a>` : img, "12px 40px");
    }
    case "button":
      return row(`<div style="text-align:${block.align};">${block.full ? buttonHtml(block.label, block.href, theme, true) : `<div style="display:inline-block;">${buttonHtml(block.label, block.href, theme, false)}</div>`}</div>`, "18px 40px");
    case "product": {
      const img = block.imageUrl
        ? `<img src="${esc(block.imageUrl)}" alt="${esc(block.title)}" width="200" style="display:block;width:100%;max-width:200px;height:auto;border:0;border-radius:10px;">`
        : `<div style="width:100%;height:200px;border-radius:10px;background:${mix(theme.text, 0.06)};"></div>`;
      const old = block.oldPrice ? ` <span style="font-size:14px;text-decoration:line-through;color:${muted};">${esc(block.oldPrice)}</span>` : "";
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${mix(theme.text, 0.12)};border-radius:14px;"><tr>
<td width="200" valign="top" style="padding:16px;">${img}</td>
<td valign="middle" style="padding:16px 20px 16px 4px;font-family:${f.body};">
<p style="margin:0 0 6px;font-family:${f.heading};font-size:22px;line-height:1.2;color:${theme.text};">${esc(block.title)}</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:${theme.text};">${esc(block.price)}${old}</p>
${buttonHtml(block.cta, block.href, theme, false)}
</td></tr></table>`,
        "12px 40px",
      );
    }
    case "promo":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px dashed ${theme.accent};border-radius:14px;"><tr><td align="center" style="padding:22px 16px;font-family:${f.body};">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${muted};">Votre code</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:28px;font-weight:bold;letter-spacing:0.12em;color:${theme.text};">${esc(block.code)}</p>
<p style="margin:8px 0 0;font-size:13px;color:${muted};">${esc(block.caption)}</p>
</td></tr></table>`,
        "14px 40px",
      );
    case "divider":
      return row(`<div style="height:1px;line-height:1px;font-size:0;background:${mix(theme.text, 0.14)};">&nbsp;</div>`, "18px 40px");
    case "spacer":
      return `<div style="height:${Math.max(4, Math.min(160, block.height))}px;line-height:1px;font-size:0;">&nbsp;</div>`;
    case "footer":
      return row(
        `<div style="border-top:1px solid ${mix(theme.text, 0.12)};padding-top:24px;font-family:${f.body};font-size:12px;line-height:1.6;color:${muted};text-align:center;">${richText(block.text)}<br><a href="{{unsubscribe_url}}" style="color:${muted};text-decoration:underline;">Se désinscrire</a></div>`,
        "28px 40px 36px",
      );
  }
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
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; border-radius: 0 !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    h1 { font-size: 34px !important; }
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

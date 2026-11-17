/** Hero C — design tokens of the live demo (brand colours, font pairings, themes, email types). */
import { t } from "../i18n";

export const COLORS = [
  { id: "bleu", label: t("Bleu", "Blue"), hex: "#145cff" },
  { id: "corail", label: t("Corail", "Coral"), hex: "#ef4f5a" },
  { id: "emeraude", label: t("Émeraude", "Emerald"), hex: "#0c9b6c" },
  { id: "violet", label: t("Violet", "Purple"), hex: "#7438ea" },
  { id: "ocre", label: t("Ocre", "Ochre"), hex: "#c47d0e" },
] as const;
export type ColorId = (typeof COLORS)[number]["id"];

export type FontSpec = {
  id: string;
  label: string;
  heading: string;
  body: string;
  weight: number;
  upper: boolean;
  tracking: string;
  italicAccent?: boolean;
};

export const FONTS = [
  { id: "outfit", label: "Outfit", heading: "'Outfit', ui-sans-serif, system-ui, sans-serif", body: "'Manrope', ui-sans-serif, system-ui, sans-serif", weight: 800, upper: true, tracking: "-0.03em" },
  { id: "fraunces", label: "Fraunces", heading: "'Fraunces', Georgia, 'Times New Roman', serif", body: "'Manrope', ui-sans-serif, system-ui, sans-serif", weight: 600, upper: false, tracking: "-0.02em", italicAccent: true },
  { id: "manrope", label: "Manrope", heading: "'Manrope', ui-sans-serif, system-ui, sans-serif", body: "'Manrope', ui-sans-serif, system-ui, sans-serif", weight: 800, upper: false, tracking: "-0.035em" },
  { id: "mono", label: "Mono", heading: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace", body: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace", weight: 700, upper: true, tracking: "-0.02em" },
] as const satisfies readonly FontSpec[];
export type FontId = (typeof FONTS)[number]["id"];

export type ThemeSpec = {
  id: string;
  label: string;
  canvas: string;
  bg: string;
  text: string;
  muted: string;
  surface: string;
  line: string;
  swatch: string;
};

export const THEMES = [
  { id: "clair", label: t("Clair", "Light"), canvas: "#e9eef7", bg: "#ffffff", text: "#0b214a", muted: "#66738f", surface: "#f2f5fb", line: "rgba(11,33,74,0.09)", swatch: "#ffffff" },
  { id: "sombre", label: t("Sombre", "Dark"), canvas: "#040b1c", bg: "#0c1834", text: "#f2f5ff", muted: "#97a6c4", surface: "#15254a", line: "rgba(255,255,255,0.09)", swatch: "#0c1834" },
  { id: "chaud", label: t("Chaud", "Warm"), canvas: "#eadfce", bg: "#fff8ee", text: "#3a2517", muted: "#8a6e57", surface: "#f4e7d4", line: "rgba(58,37,23,0.11)", swatch: "#f4e7d4" },
] as const satisfies readonly ThemeSpec[];
export type ThemeId = (typeof THEMES)[number]["id"];

export const TYPES = [
  { id: "soldes", label: t("Soldes", "Sale"), short: t("Soldes", "Sale"), subject: t("−30 % sur tout l'hiver, jusqu'à dimanche", "30% off all winter, through Sunday") },
  { id: "nouveaute", label: t("Nouveauté", "New arrival"), short: t("Nouveauté", "New"), subject: t("La collection Printemps est arrivée", "The Spring collection has arrived") },
  { id: "panier", label: t("Panier abandonné", "Abandoned cart"), short: t("Panier", "Cart"), subject: t("Vous avez oublié quelque chose ?", "Did you forget something?") },
] as const;
export type TypeId = (typeof TYPES)[number]["id"];

export type Device = "ordinateur" | "mobile";

export type DemoState = { color: ColorId; font: FontId; theme: ThemeId; type: TypeId; device: Device };

export const INITIAL: DemoState = { color: "bleu", font: "outfit", theme: "clair", type: "soldes", device: "ordinateur" };

/** Autoplay script: each step "clicks" one control (the key matches the control's ref key). */
export type Step = { [K in keyof DemoState]: { group: K; value: DemoState[K] } }[keyof DemoState];

export const STEPS: Step[] = [
  { group: "color", value: "corail" },
  { group: "font", value: "fraunces" },
  { group: "theme", value: "chaud" },
  { group: "device", value: "mobile" },
  { group: "type", value: "nouveaute" },
  { group: "color", value: "emeraude" },
  { group: "theme", value: "sombre" },
  { group: "font", value: "mono" },
  { group: "device", value: "ordinateur" },
  { group: "type", value: "panier" },
  { group: "color", value: "violet" },
  { group: "font", value: "manrope" },
  { group: "theme", value: "clair" },
  { group: "type", value: "soldes" },
  { group: "color", value: "bleu" },
  { group: "font", value: "outfit" },
];

export const stepKey = (s: { group: string; value: string }) => `${s.group}:${s.value}`;

export const byId = <T extends { id: string }>(list: readonly T[], id: string): T => list.find((x) => x.id === id) ?? list[0];

/** Mixes a hex colour with white (amount 0–1) — used for soft tints of the brand colour. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

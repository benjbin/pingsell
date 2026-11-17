const numberFmt = new Intl.NumberFormat("fr-FR");
const currencyFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const currencyPreciseFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const pctFmt = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const relFmt = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export const formatNumber = (n: number | null | undefined) => numberFmt.format(n ?? 0);
export const formatCurrency = (n: number | null | undefined, precise = false) =>
  (precise ? currencyPreciseFmt : currencyFmt).format(n ?? 0);
export const formatPercent = (ratio: number | null | undefined) => pctFmt.format(ratio ?? 0);

function parse(d: string | null | undefined): Date | null {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const formatDate = (d: string | null | undefined) => {
  const date = parse(d);
  return date ? dateFmt.format(date) : "—";
};
export const formatDateTime = (d: string | null | undefined) => {
  const date = parse(d);
  return date ? dateTimeFmt.format(date) : "—";
};
export const formatShortDate = (d: string | null | undefined) => {
  const date = parse(d);
  return date ? shortDateFmt.format(date) : "";
};

export function formatRelative(d: string | null | undefined): string {
  const date = parse(d);
  if (!date) return "—";
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return relFmt.format(diffSec, "second");
  if (abs < 3600) return relFmt.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return relFmt.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return relFmt.format(Math.round(diffSec / 86400), "day");
  return dateFmt.format(date);
}

export function fullName(c: { first_name: string | null; last_name: string | null; email: string }): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email;
}

export function initials(c: { first_name: string | null; last_name: string | null; email: string }): string {
  const a = c.first_name?.[0] ?? "";
  const b = c.last_name?.[0] ?? "";
  return (a + b || c.email.slice(0, 2)).toUpperCase();
}

/** Converts an ISO date to the value expected by <input type="datetime-local">. */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus, ShieldAlert, XCircle, type LucideIcon } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../components/ui/primitives";
import { useTheme } from "../../lib/theme";
import { cx, formatNumber } from "../../lib/format";
import { t, LOCALE } from "../../lib/i18n";
import type { AdminDay, AdminHealth, AdminIntegration } from "../../lib/types";

/* -------------------------------------------------------------------------- */
/* Palette: same hues as the rest of the app (ink, brand blue, orange).       */
/* Green / amber / red stay reserved for health states.                       */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  light: { ink: "#0b214a", blue: "#145cff", orange: "#eb6834", grid: "#eef2f8", axis: "#66738f", track: "#eef2f8" },
  dark: { ink: "#c3cddf", blue: "#4d82ff", orange: "#d95926", grid: "#142a55", axis: "#8f9bb5", track: "#142a55" },
};

export type SeriesColor = "ink" | "blue" | "orange";

export function usePalette() {
  const { theme } = useTheme();
  return theme === "dark" ? { ...PALETTE.dark, dark: true } : { ...PALETTE.light, dark: false };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** Contract dates are UTC calendar days ("2026-11-19"): format them as such. */
const utcDay = (d: string) => new Date(`${d}T12:00:00Z`);
export const fmtDay = (d: string) => dayFmt.format(utcDay(d));
export const fmtLongDay = (d: string) => longDayFmt.format(utcDay(d));

/** "12,3 %" in French (non-breaking space), "12.3%" in English; "—" when the rate has no denominator. */
export function fmtRate(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || Number.isNaN(r)) return "—";
  const v = (r * 100).toLocaleString(LOCALE, { maximumFractionDigits: digits });
  return t(`${v} %`, `${v}%`);
}

/** Human-readable size: "1,4 Go" / "1.4 GB". */
export function fmtBytes(bytes: number | null | undefined): string {
  const units = t(["o", "Ko", "Mo", "Go", "To"], ["B", "KB", "MB", "GB", "TB"]);
  let v = Math.max(0, bytes ?? 0);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(LOCALE, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

/** Uptime: "3 j 4 h", "5 h 12 min", "42 s". */
export function fmtDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const dl = t("j", "d");
  if (d > 0) return `${d} ${dl} ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** Ratio helper: null when the denominator is 0 (same rule as the API). */
export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export const INTEGRATION_LABEL: Record<AdminIntegration, string> = {
  shopify: "Shopify",
  wordpress: "WordPress",
  prestashop: "PrestaShop",
  api: "API",
  tracking: t("Suivi de site", "Site tracking"),
  push: "Push",
};
export const INTEGRATIONS: AdminIntegration[] = ["shopify", "wordpress", "prestashop", "api", "tracking", "push"];

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  flush,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding (tables). */
  flush?: boolean;
}) {
  return (
    <Card className={cx("min-w-0 overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-900/10 px-5 py-4 sm:px-6 dark:border-white/10">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? "" : "p-5 sm:p-6"}>{children}</div>
    </Card>
  );
}

export const TH = "px-3 py-3 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
export const TD = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
export const THEAD = "text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:text-slate-400";

/** Horizontal scroll stays inside the card on narrow screens. */
export function TableScroll({ children, minWidth = 640, dim }: { children: ReactNode; minWidth?: number; dim?: boolean }) {
  return (
    <div className={cx("overflow-x-auto transition-opacity", dim && "opacity-60")}>
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6 dark:text-slate-400">{children}</p>;
}

/* -------------------------------------------------------------------------- */
/* Status: icon + label + colour, never colour alone                          */
/* -------------------------------------------------------------------------- */

export type Level = "ok" | "warn" | "bad";

const LEVEL: Record<Level, { icon: LucideIcon; label: string; cls: string }> = {
  ok: {
    icon: CheckCircle2,
    label: t("Normal", "Normal"),
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20",
  },
  warn: {
    icon: AlertTriangle,
    label: t("À surveiller", "Watch"),
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-400/20",
  },
  bad: {
    icon: XCircle,
    label: t("Critique", "Critical"),
    cls: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-400/20",
  },
};

export function StatusPill({ level, label }: { level: Level; label?: string }) {
  const s = LEVEL[level];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", s.cls)}>
      <s.icon className="size-3.5" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

const HEALTH: Record<AdminHealth, { level: Level; label: string; icon: LucideIcon }> = {
  ok: { level: "ok", label: t("Sain", "Healthy"), icon: CheckCircle2 },
  warning: { level: "warn", label: t("À surveiller", "Watch"), icon: AlertTriangle },
  risk: { level: "bad", label: t("À risque", "At risk"), icon: ShieldAlert },
};

export function HealthBadge({ health }: { health: AdminHealth }) {
  const h = HEALTH[health] ?? HEALTH.ok;
  const s = LEVEL[h.level];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", s.cls)}>
      <h.icon className="size-3.5" aria-hidden />
      {h.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Delta vs previous period                                                   */
/* -------------------------------------------------------------------------- */

export function Delta({
  cur,
  prev,
  kind,
  lowerIsBetter,
}: {
  cur: number | null;
  prev: number | null;
  kind: "count" | "rate";
  lowerIsBetter?: boolean;
}) {
  let label: string;
  let dir: -1 | 0 | 1;
  if (cur === null || prev === null) {
    dir = 0;
    label = "—";
  } else if (kind === "rate") {
    const d = Math.round((cur - prev) * 1000) / 10;
    dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    const pts = `${d > 0 ? "+" : ""}${d.toLocaleString(LOCALE)}`;
    label = t(`${pts} pt${Math.abs(d) >= 2 ? "s" : ""}`, `${pts} pt${Math.abs(d) === 1 ? "" : "s"}`);
  } else if (prev === 0) {
    dir = cur > 0 ? 1 : 0;
    label = cur > 0 ? t("Nouveau", "New") : "—";
  } else {
    const d = Math.round(((cur - prev) / prev) * 100);
    dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    label = t(`${d > 0 ? "+" : ""}${d} %`, `${d > 0 ? "+" : ""}${d}%`);
  }
  const good = dir === 0 ? null : (dir > 0) !== !!lowerIsBetter;
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
        good === null
          ? "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300"
          : good
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
      )}
      title={t("Par rapport à la période précédente", "Compared with the previous period")}
    >
      <Icon className="size-3" aria-hidden /> {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Daily line chart                                                           */
/* -------------------------------------------------------------------------- */

export interface DailySeries {
  key: keyof AdminDay;
  label: string;
  color: SeriesColor;
}

function DailyTooltip({
  active,
  payload,
  series,
  colors,
}: {
  active?: boolean;
  payload?: Array<{ payload: AdminDay }>;
  series: DailySeries[];
  colors: Record<SeriesColor, string>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg dark:border-white/10 dark:bg-slate-950">
      <p className="mb-1 font-semibold text-slate-900 dark:text-white">{fmtLongDay(p.date)}</p>
      {series.map((s) => (
        <p key={s.key} className="flex items-center gap-2 py-0.5">
          <span className="inline-block w-3 rounded" style={{ background: colors[s.color], height: 3 }} />
          <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
          <span className="ml-auto pl-3 font-semibold text-slate-900 tabular-nums dark:text-white">{formatNumber(Number(p[s.key]))}</span>
        </p>
      ))}
    </div>
  );
}

/** One y-axis, 2px lines, hover tooltip, legend only with ≥ 2 series, recessive grid. */
export function DailyChart({ data, series, height = 220 }: { data: AdminDay[]; series: DailySeries[]; height?: number }) {
  const c = usePalette();
  const colors: Record<SeriesColor, string> = { ink: c.ink, blue: c.blue, orange: c.orange };
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} width={44} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            cursor={{ stroke: c.axis, strokeOpacity: 0.35, strokeWidth: 1 }}
            content={<DailyTooltip series={series} colors={colors} />}
          />
          {series.length >= 2 && <Legend itemSorter={null} iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 12, paddingTop: 8, color: c.axis }} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={colors[s.color]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: colors[s.color] }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

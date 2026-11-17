import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  CalendarRange,
  Download,
  Info,
  Minus,
  Sparkles,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useTheme } from "../lib/theme";
import { cx, formatCurrency, formatNumber } from "../lib/format";
import { CONTACT_SOURCE, TRIGGERS } from "../lib/constants";
import type { Analytics, AnalyticsDay, AnalyticsKpis, AutomationTrigger, ContactSource } from "../lib/types";
import { Button, Card, ErrorState, Input, PageHeader, Segmented, Skeleton } from "../components/ui/primitives";

/* -------------------------------------------------------------------------- */
/* Palette (validated: categorical 3 slots, light on white, dark on navy)     */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  light: { s1: "#145cff", s2: "#eb6834", s3: "#1baf7a", other: "#c3cad8", prev: "#8a94ab", grid: "#eef2f8", axis: "#66738f", empty: "#f1f4f9" },
  dark: { s1: "#4d82ff", s2: "#d95926", s3: "#199e70", other: "#3a4c74", prev: "#8f9bb5", grid: "#142a55", axis: "#8f9bb5", empty: "#10285a" },
};
/** Sequential (one hue, light → dark) for the heatmap; dark mode steps brighten with magnitude. */
const RAMP = {
  light: ["#dce6ff", "#b9cdff", "#85a8ff", "#4d82ff", "#145cff", "#0e45c2", "#0b214a"],
  dark: ["#163a7a", "#1c4ea3", "#2563d6", "#3d7bff", "#6e9bff", "#a3c0ff", "#dce6ff"],
};

function usePalette() {
  const { theme } = useTheme();
  return theme === "dark" ? { ...PALETTE.dark, ramp: RAMP.dark, dark: true } : { ...PALETTE.light, ramp: RAMP.light, dark: false };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const local = (d: string) => new Date(`${d}T12:00:00`);
const fmtDay = (d: string) => dayFmt.format(local(d));
const fmtLongDay = (d: string) => longDayFmt.format(local(d));
const fmtPct = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

type Preset = "7" | "30" | "90" | "365" | "custom";

export function StatsPage() {
  const [preset, setPreset] = useState<Preset>("30");
  const today = iso(new Date());
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const query = preset === "custom" ? { from, to } : { days: Number(preset) };
  const stats = useAsync(() => api.stats.analytics(query), [preset, preset === "custom" ? from : "", preset === "custom" ? to : ""]);
  const data = stats.data;

  return (
    <>
      <PageHeader title="Statistiques" description="Ce que rapportent vos emails et vos notifications : ventes, engagement, audience et meilleurs moments d'envoi." />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented<Preset>
            value={preset}
            onChange={setPreset}
            options={[
              { value: "7", label: "7 jours" },
              { value: "30", label: "30 jours" },
              { value: "90", label: "90 jours" },
              { value: "365", label: "12 mois" },
              { value: "custom", label: "Dates", icon: CalendarRange },
            ]}
            className="max-w-full overflow-x-auto"
          />
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Du" className="h-9 w-auto" />
              <span className="text-sm text-slate-400">au</span>
              <Input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Au" className="h-9 w-auto" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Comparé au {fmtDay(data.range.previous.from)} – {fmtDay(data.range.previous.to)}
            </p>
          )}
          <Button variant="secondary" size="sm" icon={Download} disabled={!data} onClick={() => data && exportCsv(data)}>
            Exporter
          </Button>
        </div>
      </div>

      {stats.error ? (
        <ErrorState message={stats.error} onRetry={stats.reload} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className={cx("space-y-4 transition-opacity", stats.loading && "opacity-60")}>
          <KpiGrid k={data.kpis} p={data.previous} days={data.attribution_days} />
          <Evolution data={data} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Funnel k={data.kpis} />
            <RevenueSplit data={data} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Heatmap grid={data.heatmap} />
            <Audience data={data} />
          </div>
          <Tables data={data} />
        </div>
      )}
    </>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-[20px]" />
    </div>
  );
}

function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("min-w-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-900/10 px-5 py-4 sm:px-6 dark:border-white/10">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* KPIs                                                                       */
/* -------------------------------------------------------------------------- */

type Kind = "money" | "count" | "rate";

function Delta({ cur, prev, kind, lowerIsBetter, noBase }: { cur: number; prev: number; kind: Kind; lowerIsBetter?: boolean; noBase?: boolean }) {
  let label: string;
  let dir: -1 | 0 | 1;
  if (noBase) {
    // Nothing was sent in the previous period: a rate comparison would be meaningless.
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300" title="Pas d'envoi sur la période précédente">
        Nouveau
      </span>
    );
  }
  if (kind === "rate") {
    const d = Math.round((cur - prev) * 10) / 10;
    dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    label = `${d > 0 ? "+" : ""}${d.toLocaleString("fr-FR")} pt${Math.abs(d) >= 2 ? "s" : ""}`;
    if (prev === 0 && cur === 0) label = "—";
  } else if (prev === 0) {
    dir = cur > 0 ? 1 : 0;
    label = cur > 0 ? "Nouveau" : "—";
  } else {
    const d = Math.round(((cur - prev) / prev) * 100);
    dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    label = `${d > 0 ? "+" : ""}${d} %`;
  }
  const good = dir === 0 ? null : (dir > 0) !== !!lowerIsBetter;
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold",
        good === null ? "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300" : good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
      )}
      title={good === null ? "Stable" : good ? "En progrès" : "En recul"}
    >
      <Icon className="size-3" /> {label}
    </span>
  );
}

const fmtKind = (v: number, kind: Kind) => (kind === "money" ? formatCurrency(v) : kind === "rate" ? fmtPct(v) : formatNumber(v));

function KpiGrid({ k, p, days }: { k: AnalyticsKpis; p: AnalyticsKpis; days: number }) {
  const share = k.revenue_total > 0 ? Math.round((k.revenue_attributed / k.revenue_total) * 100) : 0;
  const tiles: Array<{ label: string; key: keyof AnalyticsKpis; kind: Kind; hint: string; lowerIsBetter?: boolean; base?: keyof AnalyticsKpis }> = [
    { label: "Commandes générées", key: "orders_attributed", kind: "count", hint: `Commandes attribuées à vos messages (${days} jours)` },
    { label: "Taux d'ouverture", key: "open_rate", kind: "rate", base: "emails_delivered", hint: `${formatNumber(k.emails_opened)} ouvertures sur ${formatNumber(k.emails_delivered)} emails délivrés` },
    { label: "Taux de clic", key: "click_rate", kind: "rate", base: "emails_delivered", hint: `${formatNumber(k.emails_clicked)} clics · ${fmtPct(k.click_to_open_rate)} des ouvreurs` },
    { label: "Chiffre d'affaires", key: "revenue_total", kind: "money", hint: `${formatNumber(k.orders_total)} commande${k.orders_total > 1 ? "s" : ""} au total` },
    { label: "Emails envoyés", key: "emails_sent", kind: "count", hint: `Taux de rejet ${fmtPct(k.bounce_rate)}` },
    { label: "Ouverture push", key: "push_open_rate", kind: "rate", base: "push_sent", hint: `${formatNumber(k.push_opened)} ouvertures sur ${formatNumber(k.push_sent)} notifications` },
    { label: "Nouveaux contacts", key: "new_contacts", kind: "count", hint: `Croissance nette ${k.net_growth >= 0 ? "+" : ""}${formatNumber(k.net_growth)}` },
    { label: "Désabonnements", key: "unsubscribe_rate", kind: "rate", base: "emails_delivered", lowerIsBetter: true, hint: `${formatNumber(k.unsubscribes)} désabonné${k.unsubscribes > 1 ? "s" : ""}` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <div className="relative overflow-hidden rounded-[20px] bg-slate-900 p-6 text-white col-span-2 xl:row-span-2 dark:bg-slate-950 dark:ring-1 dark:ring-white/10">
        <p className="font-display text-[10.5px] font-semibold tracking-[0.2em] text-white/60 uppercase">Revenu généré par Pingsell</p>
        <p className="mt-4 font-display text-[56px] leading-none font-extrabold tracking-[-0.03em] sm:text-[72px]">{formatCurrency(k.revenue_attributed)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/70">
          <Delta cur={k.revenue_attributed} prev={p.revenue_attributed} kind="money" />
          <span>vs période précédente</span>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">Part du chiffre d'affaires</p>
            <p className="mt-1 font-display text-2xl font-bold">{share}&nbsp;%</p>
            <p className="text-xs text-white/50">sur {formatCurrency(k.revenue_total)} au total</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">Par email envoyé</p>
            <p className="mt-1 font-display text-2xl font-bold">{formatCurrency(k.emails_sent ? k.revenue_attributed / k.emails_sent : 0, true)}</p>
            <p className="text-xs text-white/50">revenu moyen</p>
          </div>
        </div>
        <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/45">
          <Info className="mt-px size-3.5 shrink-0" /> Commandes passées dans les {days}&nbsp;jours après un email ouvert ou cliqué, ou une notification ouverte (dernier contact).
        </p>
      </div>
      {tiles.map((t) => (
        <div key={t.key} className="flex min-w-0 flex-col rounded-[20px] bg-slate-100/80 p-4 sm:p-5 dark:bg-white/5">
          <p className="font-display text-[10.5px] font-semibold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">{t.label}</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            <p className="font-display text-[24px] leading-none font-extrabold tracking-[-0.02em] text-slate-900 sm:text-[30px] dark:text-white">{fmtKind(k[t.key], t.kind)}</p>
            <Delta cur={k[t.key]} prev={p[t.key]} kind={t.kind} lowerIsBetter={t.lowerIsBetter} noBase={!!t.base && p[t.base] === 0 && k[t.base] > 0} />
          </div>
          <p className="mt-auto pt-3 text-xs text-slate-500 dark:text-slate-400">{t.hint}</p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Evolution (current vs previous period)                                     */
/* -------------------------------------------------------------------------- */

type MetricKey = "revenue_attributed" | "orders" | "emails_sent" | "opens" | "clicks" | "push_opens" | "new_contacts";
const METRICS: Array<{ value: MetricKey; label: string; money?: boolean }> = [
  { value: "revenue_attributed", label: "Revenu", money: true },
  { value: "orders", label: "Commandes" },
  { value: "emails_sent", label: "Envois" },
  { value: "opens", label: "Ouvertures" },
  { value: "clicks", label: "Clics" },
  { value: "push_opens", label: "Push ouverts" },
  { value: "new_contacts", label: "Contacts" },
];

function ChartTooltip({ active, payload, rows }: { active?: boolean; payload?: Array<{ payload: Record<string, number | string> }>; rows: (p: Record<string, number | string>) => Array<{ color: string; label: string; value: string; dashed?: boolean }> }) {
  if (!active || !payload?.length) return null;
  const items = rows(payload[0].payload);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg dark:border-white/10 dark:bg-slate-950">
      {items.map((r) => (
        <p key={r.label} className="flex items-center gap-2 py-0.5">
          <span className={cx("inline-block h-0.5 w-3 rounded", r.dashed && "border-t-2 border-dashed bg-transparent")} style={r.dashed ? { borderColor: r.color } : { background: r.color, height: 3 }} />
          <span className="text-slate-500 dark:text-slate-400">{r.label}</span>
          <span className="ml-auto pl-3 font-semibold text-slate-900 tabular-nums dark:text-white">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function Evolution({ data }: { data: Analytics }) {
  const c = usePalette();
  const [metric, setMetric] = useState<MetricKey>("revenue_attributed");
  const [compare, setCompare] = useState(true);
  const m = METRICS.find((x) => x.value === metric)!;
  const fmt = (v: number) => (m.money ? formatCurrency(v) : formatNumber(v));
  const rows = data.daily.map((d, i) => ({ date: d.date, cur: d[metric], prev: data.daily_previous[i]?.[metric] ?? 0, prevDate: data.daily_previous[i]?.date ?? "" }));
  const total = rows.reduce((s, r) => s + r.cur, 0);
  const prevTotal = rows.reduce((s, r) => s + r.prev, 0);
  const weekly = rows.length > 120;
  const series = weekly ? bucketWeeks(rows) : rows;

  return (
    <Panel
      title="Évolution"
      subtitle={
        <>
          {m.label} sur la période : <span className="font-semibold text-slate-900 dark:text-white">{fmt(total)}</span>
          {compare && <> · période précédente {fmt(prevTotal)}</>}
          {weekly && " · par semaine"}
        </>
      }
      action={<Segmented value={metric} onChange={setMetric} options={METRICS.map(({ value, label }) => ({ value, label }))} className="max-w-full overflow-x-auto" />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: c.s1 }} /> Cette période
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-3.5 accent-slate-900" />
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: c.prev }} /> Période précédente
        </label>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} width={m.money ? 64 : 40} tickFormatter={(v: number) => (m.money ? formatCurrency(v) : formatNumber(v))} />
            <Tooltip
              cursor={{ fill: c.dark ? "rgba(255,255,255,0.05)" : "rgba(11,33,74,0.05)" }}
              content={
                <ChartTooltip
                  rows={(p) => [
                    { color: c.s1, label: weekly ? `Semaine du ${fmtDay(String(p.date))}` : fmtLongDay(String(p.date)), value: fmt(Number(p.cur)) },
                    ...(compare && p.prevDate ? [{ color: c.prev, dashed: true, label: weekly ? `Semaine du ${fmtDay(String(p.prevDate))}` : fmtLongDay(String(p.prevDate)), value: fmt(Number(p.prev)) }] : []),
                  ]}
                />
              }
            />
            {/* Daily totals are discrete: bars, not a smoothed curve that invents values between days. */}
            <Bar dataKey="cur" fill={c.s1} radius={[4, 4, 0, 0]} maxBarSize={22} />
            {compare && <Line type="linear" dataKey="prev" stroke={c.prev} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: c.prev }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function bucketWeeks(rows: Array<{ date: string; cur: number; prev: number; prevDate: string }>) {
  const out: typeof rows = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    out.push({ date: chunk[0].date, prevDate: chunk[0].prevDate, cur: chunk.reduce((s, r) => s + r.cur, 0), prev: chunk.reduce((s, r) => s + r.prev, 0) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Funnel & revenue split                                                     */
/* -------------------------------------------------------------------------- */

function Funnel({ k }: { k: AnalyticsKpis }) {
  const c = usePalette();
  const steps = [
    { label: "Envoyés", value: k.emails_sent },
    { label: "Délivrés", value: k.emails_delivered },
    { label: "Ouverts", value: k.emails_opened },
    { label: "Cliqués", value: k.emails_clicked },
    { label: "Commandes", value: k.orders_attributed },
  ];
  const max = Math.max(1, steps[0].value);
  return (
    <Panel title="Entonnoir email" subtitle="Du message envoyé à la commande : où vous perdez vos clients.">
      <ol className="space-y-3.5">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].value : 0;
          return (
            <li key={s.label} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
              <span className="h-7 rounded-md bg-slate-100 dark:bg-white/5" title={`${s.label} : ${formatNumber(s.value)}`}>
                <span className="block h-full rounded-md" style={{ width: `${Math.max(s.value ? 1.5 : 0, (s.value / max) * 100)}%`, background: c.s1, opacity: 1 - i * 0.12 }} />
              </span>
              <span className="w-28 text-right tabular-nums">
                <span className="font-semibold text-slate-900 dark:text-white">{formatNumber(s.value)}</span>
                {i > 0 && <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{prev ? fmtPct(Math.round((s.value / prev) * 1000) / 10) : "—"}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Le pourcentage indique la part de l'étape précédente.</p>
    </Panel>
  );
}

function RevenueSplit({ data }: { data: Analytics }) {
  const c = usePalette();
  const r = data.revenue_split;
  const parts = [
    { label: "Campagnes email", value: r.campaigns, color: c.s1 },
    { label: "Automatisations", value: r.automations, color: c.s2 },
    { label: "Notifications push", value: r.push, color: c.s3 },
    { label: "Ventes sans contact récent", value: r.unattributed, color: c.other },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <Panel title="D'où vient le chiffre d'affaires" subtitle={`${formatCurrency(data.kpis.revenue_total)} de commandes sur la période`}>
      {total === 0 ? (
        <EmptyChart text="Aucune commande sur la période. Branchez Shopify ou envoyez vos commandes par l'API pour mesurer vos ventes." />
      ) : (
        <>
          <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label="Répartition du chiffre d'affaires">
            {parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="h-full first:rounded-l-md last:rounded-r-md" title={`${p.label} : ${formatCurrency(p.value)}`} />
              ))}
          </div>
          <ul className="mt-5 divide-y divide-slate-900/5 dark:divide-white/5">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">{p.label}</span>
                <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{formatCurrency(p.value)}</span>
                <span className="w-12 text-right text-xs text-slate-500 tabular-nums dark:text-slate-400">{Math.round((p.value / total) * 100)}&nbsp;%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">{text}</p>;
}

/* -------------------------------------------------------------------------- */
/* Heatmap: best time to send                                                 */
/* -------------------------------------------------------------------------- */

function Heatmap({ grid }: { grid: number[][] }) {
  const c = usePalette();
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(0, ...grid.flat());
  const best = useMemo(() => {
    let b = { d: 0, h: 0, n: 0 };
    grid.forEach((row, d) => row.forEach((n, h) => n > b.n && (b = { d, h, n })));
    return b;
  }, [grid]);
  const total = grid.flat().reduce((s, n) => s + n, 0);
  const color = (n: number) => (n === 0 ? c.empty : c.ramp[Math.min(c.ramp.length - 1, Math.floor((n / max) * c.ramp.length - 1e-9))]);
  const h = hover ? grid[hover.d][hover.h] : 0;

  return (
    <Panel
      title="Meilleurs moments d'ouverture"
      subtitle="Ouvertures d'emails par jour et par heure, à votre heure locale."
      action={
        best.n > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
            <Sparkles className="size-3.5" /> {WEEKDAYS[best.d]} vers {best.h}&nbsp;h
          </span>
        ) : undefined
      }
    >
      {total === 0 ? (
        <EmptyChart text="Pas encore d'ouvertures sur la période." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[2px] pb-1 text-[10px] text-slate-400">
                <span />
                {Array.from({ length: 24 }, (_, i) => (
                  <span key={i} className="text-center">
                    {i % 3 === 0 ? `${i}h` : ""}
                  </span>
                ))}
              </div>
              {grid.map((row, d) => (
                <div key={d} className="grid grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[2px] pb-[2px]">
                  <span className="pr-1 text-[11px] leading-6 text-slate-500 dark:text-slate-400">{WEEKDAYS[d].slice(0, 3)}</span>
                  {row.map((n, hr) => (
                    <span
                      key={hr}
                      onMouseEnter={() => setHover({ d, h: hr })}
                      onMouseLeave={() => setHover(null)}
                      className={cx("h-6 rounded-[4px] transition-shadow", hover?.d === d && hover?.h === hr && "ring-2 ring-slate-900 dark:ring-white")}
                      style={{ background: color(n) }}
                      aria-label={`${WEEKDAYS[d]} ${hr} h : ${n} ouverture${n > 1 ? "s" : ""}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <p className="min-h-4" aria-live="polite">
              {hover ? (
                <>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {WEEKDAYS[hover.d]} {hover.h}&nbsp;h – {hover.h + 1}&nbsp;h
                  </span>
                  &nbsp;: {formatNumber(h)} ouverture{h > 1 ? "s" : ""} ({Math.round((h / total) * 100)}&nbsp;%)
                </>
              ) : (
                <>Programmez vos campagnes juste avant le créneau le plus foncé.</>
              )}
            </p>
            <span className="flex items-center gap-1">
              Moins
              {c.ramp.map((col) => (
                <span key={col} className="size-3 rounded-[3px]" style={{ background: col }} />
              ))}
              Plus
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Audience                                                                   */
/* -------------------------------------------------------------------------- */

function Audience({ data }: { data: Analytics }) {
  const c = usePalette();
  const rows = data.daily.map((d) => ({ date: d.date, gain: d.new_contacts, loss: -d.unsubscribes }));
  const k = data.kpis;
  const maxSource = Math.max(1, ...data.sources.map((s) => s.contacts));
  return (
    <Panel title="Audience" subtitle={`Croissance nette : ${k.net_growth >= 0 ? "+" : ""}${formatNumber(k.net_growth)} contact${Math.abs(k.net_growth) > 1 ? "s" : ""}`}>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: c.s1 }} /> Nouveaux ({formatNumber(k.new_contacts)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: c.s2 }} /> Désabonnés ({formatNumber(k.unsubscribes)})
        </span>
      </div>
      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <ReferenceLine y={0} stroke={c.axis} strokeOpacity={0.5} />
            <Tooltip
              cursor={{ fill: c.dark ? "rgba(255,255,255,0.05)" : "rgba(11,33,74,0.05)" }}
              content={
                <ChartTooltip
                  rows={(p) => [
                    { color: c.s1, label: `${fmtLongDay(String(p.date))} · nouveaux`, value: formatNumber(Number(p.gain)) },
                    { color: c.s2, label: "Désabonnés", value: formatNumber(-Number(p.loss)) },
                  ]}
                />
              }
            />
            <Bar dataKey="gain" stackId="a" fill={c.s1} radius={[3, 3, 0, 0]} />
            <Bar dataKey="loss" stackId="a" fill={c.s2} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <h4 className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">Nouveaux contacts par source</h4>
      {data.sources.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Aucun nouveau contact sur la période.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.sources.map((s) => (
            <li key={s.source} className="grid grid-cols-[80px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
              <span className="truncate text-slate-600 dark:text-slate-300">{CONTACT_SOURCE[s.source as ContactSource] ?? s.source}</span>
              <span className="h-2 rounded-full bg-slate-100 dark:bg-white/5">
                <span className="block h-full rounded-full" style={{ width: `${(s.contacts / maxSource) * 100}%`, background: c.s1 }} />
              </span>
              <span className="text-right font-semibold text-slate-900 tabular-nums dark:text-white">{formatNumber(s.contacts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

type Tab = "campaigns" | "automations" | "push" | "links";

interface Col<T> {
  key: string;
  label: string;
  value: (r: T) => number | string;
  render?: (r: T) => ReactNode;
  num?: boolean;
}

function SortTable<T extends { id?: string }>({ rows, cols, initial, empty }: { rows: T[]; cols: Array<Col<T>>; initial: string; empty: string }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = cols.find((x) => x.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
    return sort.desc ? -d : d;
  });
  if (!rows.length) return <EmptyChart text={empty} />;
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-900/10 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
            {cols.map((c, i) => (
              <th key={c.key} className={cx("px-3 py-2.5 font-semibold first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", c.num ? "text-right" : "text-left")} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : i > 0 }))}
                  className={cx("inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white", sort.key === c.key && "text-slate-900 dark:text-white")}
                >
                  {c.label}
                  <ArrowUpDown className="size-3 opacity-50" />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, ri) => (
            <tr key={r.id ?? ri} className="border-b border-slate-900/5 last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5">
              {cols.map((c) => (
                <td key={c.key} className={cx("px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", c.num ? "text-right tabular-nums" : "text-left")}>
                  {c.render ? c.render(r) : c.num ? formatNumber(Number(c.value(r))) : String(c.value(r))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const nameCell = (title: string, sub: string, to?: string) => (
  <span className="block max-w-[280px]">
    {to ? (
      <Link to={to} className="block truncate font-semibold text-slate-900 hover:text-brand-600 dark:text-white">
        {title}
      </Link>
    ) : (
      <span className="block truncate font-semibold text-slate-900 dark:text-white">{title}</span>
    )}
    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>
  </span>
);

function Tables({ data }: { data: Analytics }) {
  const [tab, setTab] = useState<Tab>("campaigns");
  const pctCol = <T,>(key: string, label: string, get: (r: T) => number): Col<T> => ({ key, label, num: true, value: get, render: (r) => fmtPct(get(r)) });
  const moneyCol = <T,>(get: (r: T) => number): Col<T> => ({ key: "revenue", label: "Revenu", num: true, value: get, render: (r) => <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(get(r))}</span> });
  type C = Analytics["campaigns"][number];
  type A = Analytics["automations"][number];
  type P = Analytics["push_campaigns"][number];
  type L = Analytics["top_links"][number];

  return (
    <Panel
      title="Performance détaillée"
      subtitle="Cliquez sur un en-tête pour trier."
      action={
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "campaigns", label: `Campagnes (${data.campaigns.length})` },
            { value: "automations", label: `Automatisations (${data.automations.length})` },
            { value: "push", label: `Push (${data.push_campaigns.length})` },
            { value: "links", label: "Liens" },
          ]}
          className="max-w-full overflow-x-auto"
        />
      }
    >
      {tab === "campaigns" && (
        <SortTable<C>
          rows={data.campaigns}
          initial="date"
          empty="Aucune campagne email envoyée sur la période."
          cols={[
            { key: "date", label: "Campagne", value: (r) => r.sent_at, render: (r) => nameCell(r.name, `${fmtDay(r.sent_at.slice(0, 10))} · ${r.subject.replace(/\{\{\s*\w+\|?([^}]*)\}\}/g, (_, d: string) => d || "…")}`, `/campagnes/${r.id}/rapport`) },
            { key: "sent", label: "Envoyés", num: true, value: (r) => r.sent },
            pctCol<C>("open", "Ouverture", (r) => r.open_rate),
            pctCol<C>("click", "Clic", (r) => r.click_rate),
            pctCol<C>("unsub", "Désabo.", (r) => r.unsubscribe_rate),
            { key: "orders", label: "Commandes", num: true, value: (r) => r.orders },
            moneyCol<C>((r) => r.revenue),
          ]}
        />
      )}
      {tab === "automations" && (
        <SortTable<A>
          rows={data.automations}
          initial="revenue"
          empty="Aucune automatisation active sur la période."
          cols={[
            { key: "name", label: "Automatisation", value: (r) => r.name, render: (r) => nameCell(r.name, TRIGGERS[r.trigger as AutomationTrigger]?.label ?? r.trigger, `/automatisations/${r.id}`) },
            { key: "entered", label: "Entrées", num: true, value: (r) => r.entered },
            { key: "sent", label: "Emails", num: true, value: (r) => r.emails_sent },
            pctCol<A>("open", "Ouverture", (r) => r.open_rate),
            pctCol<A>("click", "Clic", (r) => r.click_rate),
            { key: "push", label: "Push", num: true, value: (r) => r.push_sent },
            { key: "orders", label: "Commandes", num: true, value: (r) => r.orders },
            moneyCol<A>((r) => r.revenue),
          ]}
        />
      )}
      {tab === "push" && (
        <SortTable<P>
          rows={data.push_campaigns}
          initial="date"
          empty="Aucune notification push envoyée sur la période."
          cols={[
            { key: "date", label: "Notification", value: (r) => r.sent_at ?? "", render: (r) => nameCell(r.name, `${r.sent_at ? fmtDay(r.sent_at.slice(0, 10)) : ""} · ${r.title}`) },
            { key: "sent", label: "Envoyées", num: true, value: (r) => r.sent },
            pctCol<P>("open", "Ouverture", (r) => r.open_rate),
            { key: "orders", label: "Commandes", num: true, value: (r) => r.orders },
            moneyCol<P>((r) => r.revenue),
          ]}
        />
      )}
      {tab === "links" && (
        <SortTable<L & { id: string }>
          rows={data.top_links.map((l) => ({ ...l, id: l.url }))}
          initial="clicks"
          empty="Aucun clic sur la période."
          cols={[
            {
              key: "url",
              label: "Lien",
              value: (r) => r.url,
              render: (r) => (
                <a href={r.url} target="_blank" rel="noreferrer" className="block max-w-[420px] truncate font-medium text-brand-600 hover:underline dark:text-brand-300">
                  {r.url}
                </a>
              ),
            },
            { key: "clicks", label: "Clics", num: true, value: (r) => r.clicks },
            { key: "contacts", label: "Contacts uniques", num: true, value: (r) => r.contacts },
          ]}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

function exportCsv(data: Analytics) {
  const cols: Array<[keyof AnalyticsDay, string]> = [
    ["date", "Date"],
    ["emails_sent", "Emails envoyés"],
    ["opens", "Ouvertures"],
    ["clicks", "Clics"],
    ["push_sent", "Push envoyés"],
    ["push_opens", "Push ouverts"],
    ["orders", "Commandes"],
    ["revenue", "Chiffre d'affaires (€)"],
    ["revenue_attributed", "Revenu attribué (€)"],
    ["new_contacts", "Nouveaux contacts"],
    ["unsubscribes", "Désabonnements"],
  ];
  const lines = [cols.map((c) => c[1]).join(";"), ...data.daily.map((d) => cols.map(([k]) => String(d[k]).replace(".", ",")).join(";"))];
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pingsell-statistiques-${data.range.from}-${data.range.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

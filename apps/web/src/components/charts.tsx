import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "../lib/theme";
import { formatNumber } from "../lib/format";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

/** Ink, signal vermilion, sand. "sent" flips to paper in dark mode (see useSeriesColor). */
export const SERIES_COLORS = {
  sent: "#0b214a",
  opened: "#145cff",
  clicked: "#4d82ff",
};

/** Navy series would vanish on the navy dark background: lift it to light grey-blue. */
function themed(color: string, dark: boolean): string {
  return dark && color === SERIES_COLORS.sent ? "#c3cddf" : color;
}

/** Multi-series area chart, themed for light/dark. */
export function TimeAreaChart({
  data,
  xKey,
  series,
  formatX,
  height = 280,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: SeriesDef[];
  formatX?: (v: string) => string;
  height?: number;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const grid = dark ? "#142a55" : "#eef2f8";
  const axis = dark ? "#8f9bb5" : "#66738f";

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={themed(s.color, dark)} stopOpacity={0.18} />
                <stop offset="100%" stopColor={themed(s.color, dark)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={(v: string) => (formatX ? formatX(v) : v)}
            tick={{ fill: axis, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} width={48} />
          <Tooltip
            labelFormatter={(v) => (formatX ? formatX(String(v)) : String(v))}
            formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
              background: dark ? "#0f172a" : "#ffffff",
              boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
              fontSize: 12,
            }}
            labelStyle={{ color: dark ? "#e2e8f0" : "#0f172a", fontWeight: 600, marginBottom: 4 }}
          />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={themed(s.color, dark)}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

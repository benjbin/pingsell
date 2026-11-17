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
  sent: "#0e0e0c",
  opened: "#ff4d1c",
  clicked: "#b59a62",
};

function themed(color: string, dark: boolean): string {
  return dark && color.toLowerCase() === "#0e0e0c" ? "#efede6" : color;
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
  const grid = dark ? "#282723" : "#e3e0d6";
  const axis = dark ? "#79746a" : "#a29d90";

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={themed(s.color, dark)} stopOpacity={s.key === "sent" ? 0.06 : 0.18} />
                <stop offset="100%" stopColor={themed(s.color, dark)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={(v: string) => (formatX ? formatX(v) : v)}
            tick={{ fill: axis, fontSize: 10.5, fontFamily: "Geist Mono, monospace" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis tick={{ fill: axis, fontSize: 10.5, fontFamily: "Geist Mono, monospace" }} axisLine={false} tickLine={false} allowDecimals={false} width={48} />
          <Tooltip
            labelFormatter={(v) => (formatX ? formatX(String(v)) : String(v))}
            formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
            cursor={{ stroke: dark ? "#3f3d38" : "#cfcabd", strokeDasharray: "2 3" }}
            contentStyle={{
              borderRadius: 14,
              border: "none",
              background: dark ? "#efede6" : "#0e0e0c",
              color: dark ? "#0e0e0c" : "#efede6",
              boxShadow: "0 12px 32px rgba(14,14,12,0.25)",
              fontSize: 12,
              fontFamily: "Geist Mono, monospace",
              padding: "10px 12px",
            }}
            itemStyle={{ color: dark ? "#0e0e0c" : "#efede6", padding: 0 }}
            labelStyle={{ color: dark ? "#79746a" : "#a29d90", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 10 }}
          />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 12, fontFamily: "Geist Mono, monospace", textTransform: "uppercase", letterSpacing: "0.1em" }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={themed(s.color, dark)}
              strokeWidth={s.key === "opened" ? 2.25 : 1.5}
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

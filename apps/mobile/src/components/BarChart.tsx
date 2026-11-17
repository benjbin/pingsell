import { StyleSheet, Text, View } from 'react-native';

import { spacing, useColors } from '@/lib/theme';

export interface BarDatum {
  label: string;
  /** Background (total) value, e.g. sent. */
  primary: number;
  /** Foreground value drawn inside the bar, e.g. opened. */
  secondary?: number;
}

/**
 * Dependency-free bar chart built with plain Views.
 * Each column shows `primary` as a soft bar and `secondary` as a solid bar overlaid from the bottom.
 */
export function BarChart({
  data,
  height = 140,
  primaryLabel,
  secondaryLabel,
  labelEvery,
}: {
  data: BarDatum[];
  height?: number;
  primaryLabel: string;
  secondaryLabel?: string;
  /** Show an x-axis label every N bars (auto by default). */
  labelEvery?: number;
}) {
  const c = useColors();
  const max = Math.max(1, ...data.map((d) => Math.max(d.primary, d.secondary ?? 0)));
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 6));
  const gap = data.length > 20 ? 2 : 4;

  return (
    <View>
      <View style={styles.legend}>
        <LegendDot color={c.accentSoft} border={c.accentText} label={primaryLabel} />
        {secondaryLabel ? <LegendDot color={c.accent} label={secondaryLabel} /> : null}
        <Text style={[styles.max, { color: c.textSubtle }]}>max {max}</Text>
      </View>
      <View
        style={[styles.plot, { height, gap, borderBottomColor: c.border }]}
        accessibilityRole="image"
        accessibilityLabel={`Graphique : ${primaryLabel}${secondaryLabel ? ` et ${secondaryLabel}` : ''}`}
      >
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={styles.column}>
            <View
              style={[
                styles.bar,
                { height: `${(d.primary / max) * 100}%`, backgroundColor: c.accentSoft, minHeight: d.primary > 0 ? 2 : 0 },
              ]}
            >
              {d.secondary !== undefined && d.primary > 0 ? (
                <View
                  style={[
                    styles.inner,
                    {
                      height: `${Math.min(100, (d.secondary / Math.max(d.primary, 1)) * 100)}%`,
                      backgroundColor: c.accent,
                    },
                  ]}
                />
              ) : null}
            </View>
            {d.secondary !== undefined && d.primary === 0 && d.secondary > 0 ? (
              <View style={[styles.bar, { height: `${(d.secondary / max) * 100}%`, backgroundColor: c.accent }]} />
            ) : null}
          </View>
        ))}
      </View>
      <View style={[styles.axis, { gap }]}>
        {data.map((d, i) => (
          <View key={`${d.label}-axis-${i}`} style={styles.column}>
            {i % every === 0 ? (
              <Text style={[styles.axisLabel, { color: c.textSubtle }]} numberOfLines={1}>
                {d.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function LegendDot({ color, label, border }: { color: string; label: string; border?: string }) {
  const c = useColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color, borderColor: border ?? color }]} />
      <Text style={[styles.legendText, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1 },
  legendText: { fontSize: 12 },
  max: { marginLeft: 'auto', fontSize: 11 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: StyleSheet.hairlineWidth },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end', overflow: 'visible' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  inner: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  axis: { flexDirection: 'row', marginTop: 6, height: 14 },
  axisLabel: { fontSize: 10, width: 40, overflow: 'visible' },
});

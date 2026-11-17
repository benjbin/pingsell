import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { Tone } from '@/lib/format';
import { t } from '@/lib/i18n';
import { radius, spacing, useColors, type Palette } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function toneColors(c: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'accent':
      return { fg: c.accentText, bg: c.accentSoft };
    case 'success':
      return { fg: c.success, bg: c.successSoft };
    case 'warning':
      return { fg: c.warning, bg: c.warningSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft };
    case 'info':
      return { fg: c.info, bg: c.infoSoft };
    default:
      return { fg: c.textMuted, bg: c.surfaceMuted };
  }
}

/** Scrollable screen body with pull-to-refresh. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[styles.screenContent, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accentText} colors={[c.accent]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{children}</Text>
      {right}
    </View>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: IconName;
}) {
  const c = useColors();
  return (
    <Card style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: c.accentSoft }]}>
        <Ionicons name={icon} size={16} color={c.accentText} />
      </View>
      <Text style={[styles.kpiLabel, { color: c.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.kpiValue, { color: c.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={[styles.kpiHint, { color: c.textSubtle }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useColors();
  const { fg, bg } = toneColors(c, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const isDisabled = disabled || loading;
  const palette =
    variant === 'primary'
      ? { bg: c.accent, fg: c.onAccent, border: c.accent }
      : variant === 'danger'
        ? { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft }
        : { bg: c.surface, fg: c.text, border: c.border };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <Text style={[styles.buttonText, { color: palette.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function LoadingState() {
  const c = useColors();
  return (
    <View style={[styles.center, { backgroundColor: c.background }]}>
      <ActivityIndicator size="large" color={c.accentText} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.center, { backgroundColor: c.background }]}>
      <Ionicons name="cloud-offline-outline" size={40} color={c.textSubtle} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{t('Oups, chargement impossible', "Oops, couldn't load this")}</Text>
      <Text style={[styles.stateText, { color: c.textMuted }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button label={t('Réessayer', 'Try again')} icon="refresh" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={c.textSubtle} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      {text ? <Text style={[styles.stateText, { color: c.textMuted }]}>{text}</Text> : null}
    </View>
  );
}

/** Label / value row used in detail cards. */
export function InfoRow({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.infoRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <Text style={[styles.infoLabel, { color: c.textMuted }]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.infoValue, { color: c.text }]} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

/** Compact stat (value + label), used in grids. */
export function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  kpi: { flexBasis: '47%', flexGrow: 1, gap: 4 },
  kpiIcon: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiLabel: { fontSize: 13, fontWeight: '500' },
  kpiValue: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  kpiHint: { fontSize: 12 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm },
  stateTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: spacing.sm },
  stateText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.lg },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  stat: { flexBasis: '30%', flexGrow: 1, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 12 },
});

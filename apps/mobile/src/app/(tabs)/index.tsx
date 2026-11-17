import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BarChart } from '@/components/BarChart';
import { Card, ErrorState, KpiCard, LoadingState, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { formatCurrency, formatNumber, formatPercent, formatShortDay } from '@/lib/format';
import { radius, spacing, useColors } from '@/lib/theme';
import { useApiQuery } from '@/lib/useApi';

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

export default function HomeScreen() {
  const c = useColors();
  const { account, setAccount } = useAuth();
  const [days, setDays] = useState<Period>(30);

  const { data, error, loading, refreshing, refresh } = useApiQuery(
    async (api) => {
      const [overview, me] = await Promise.all([api.statsOverview(days), api.me()]);
      setAccount(me.account);
      return { overview, me };
    },
    [days],
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const o = data.overview;
  const series = o.timeseries.slice(-Math.min(days, 30));
  const name = account?.name ?? data.me.account.name;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: 4 }}>
        <Text style={[styles.hello, { color: c.textMuted }]}>{t('Bonjour,', 'Hello,')}</Text>
        <Text style={[styles.account, { color: c.text }]}>{name}</Text>
      </View>

      <View style={[styles.segmented, { backgroundColor: c.surfaceMuted }]}>
        {PERIODS.map((p) => {
          const active = p === days;
          return (
            <Pressable
              key={p}
              onPress={() => setDays(p)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.segment, active && { backgroundColor: c.surface }]}
            >
              <Text style={[styles.segmentText, { color: active ? c.text : c.textMuted }]}>{t(`${p} jours`, `${p} days`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid}>
        <KpiCard
          icon="people-outline"
          label={t('Contacts abonnés', 'Subscribed contacts')}
          value={formatNumber(o.contacts_subscribed)}
          hint={t(
            `${formatNumber(o.contacts_total)} au total · +${formatNumber(o.contacts_new)}`,
            `${formatNumber(o.contacts_total)} total · +${formatNumber(o.contacts_new)}`,
          )}
        />
        <KpiCard
          icon="send-outline"
          label={t('Emails envoyés', 'Emails sent')}
          value={formatNumber(o.emails_sent)}
          hint={t(
            `${formatNumber(o.campaigns_sent)} campagne${o.campaigns_sent > 1 ? 's' : ''}`,
            `${formatNumber(o.campaigns_sent)} campaign${o.campaigns_sent === 1 ? '' : 's'}`,
          )}
        />
        <KpiCard icon="mail-open-outline" label={t("Taux d'ouverture", 'Open rate')} value={formatPercent(o.open_rate)} />
        <KpiCard icon="hand-left-outline" label={t('Taux de clic', 'Click rate')} value={formatPercent(o.click_rate)} />
        <KpiCard icon="bag-handle-outline" label={t('Revenu Shopify', 'Shopify revenue')} value={formatCurrency(o.revenue_shopify)} />
        <KpiCard icon="exit-outline" label={t('Désabonnements', 'Unsubscribes')} value={formatPercent(o.unsubscribe_rate, 2)} />
      </View>

      <SectionTitle>{t('Activité d’envoi', 'Sending activity')}</SectionTitle>
      <Card>
        {series.length ? (
          <BarChart
            data={series.map((p) => ({ label: formatShortDay(p.date), primary: p.sent, secondary: p.opened }))}
            primaryLabel={t('Envoyés', 'Sent')}
            secondaryLabel={t('Ouverts', 'Opened')}
          />
        ) : (
          <Text style={{ color: c.textMuted }}>{t('Aucun envoi sur la période.', 'No sends in this period.')}</Text>
        )}
        {days > 30 ? (
          <Text style={[styles.note, { color: c.textSubtle }]}>{t('Graphique limité aux 30 derniers jours.', 'Chart limited to the last 30 days.')}</Text>
        ) : null}
      </Card>

      <SectionTitle>{t('Utilisation ce mois-ci', 'Usage this month')}</SectionTitle>
      <Card style={styles.usage}>
        <UsageItem label={t('Emails envoyés', 'Emails sent')} value={formatNumber(data.me.usage.emails_sent_month)} />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <UsageItem label="Contacts" value={formatNumber(data.me.usage.contacts)} />
      </Card>
    </Screen>
  );
}

function UsageItem({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: 15 },
  account: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segmentText: { fontSize: 14, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  note: { fontSize: 12, marginTop: spacing.md },
  usage: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});

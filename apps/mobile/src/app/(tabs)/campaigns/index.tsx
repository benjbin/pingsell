import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { campaignStatusLabel, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { radius, spacing, useColors } from '@/lib/theme';
import type { Campaign, CampaignStatus } from '@/lib/types';
import { useApiQuery } from '@/lib/useApi';

type Filter = 'all' | CampaignStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'draft', label: 'Brouillons' },
  { key: 'scheduled', label: 'Programmées' },
  { key: 'sending', label: 'En cours' },
  { key: 'sent', label: 'Envoyées' },
];

export default function CampaignsScreen() {
  const c = useColors();
  const [filter, setFilter] = useState<Filter>('all');
  // Refetch on focus so stats are fresh when coming back from a detail screen (e.g. after a send).
  const { data, error, loading, refreshing, refresh } = useApiQuery(
    (api) => api.listCampaigns(filter === 'all' ? undefined : filter),
    [filter],
    { refetchOnFocus: true },
  );

  const campaigns = useMemo(
    () =>
      [...(data?.data ?? [])].sort((a, b) =>
        (b.sent_at ?? b.scheduled_at ?? b.updated_at).localeCompare(a.sent_at ?? a.scheduled_at ?? a.updated_at),
      ),
    [data],
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={campaigns}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accentText} />}
      ListHeaderComponent={
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  { backgroundColor: active ? c.accent : c.surface, borderColor: active ? c.accent : c.border },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? c.onAccent : c.textMuted }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      }
      ListEmptyComponent={
        <EmptyState
          icon="paper-plane-outline"
          title="Aucune campagne"
          text="Créez vos campagnes depuis le back-office web, elles apparaîtront ici."
        />
      }
      renderItem={({ item }) => <CampaignRow campaign={item} />}
    />
  );
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const c = useColors();
  const status = campaignStatusLabel[campaign.status];
  const stats = campaign.stats;
  const date =
    campaign.status === 'sent'
      ? `Envoyée le ${formatDate(campaign.sent_at)}`
      : campaign.status === 'scheduled'
        ? `Prévue le ${formatDate(campaign.scheduled_at)}`
        : `Modifiée le ${formatDate(campaign.updated_at)}`;

  return (
    <Pressable
      onPress={() => router.push(`/campaigns/${campaign.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.rowHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {campaign.name}
          </Text>
          <Text style={[styles.subject, { color: c.textMuted }]} numberOfLines={1}>
            {campaign.subject}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
      </View>
      <View style={styles.meta}>
        <Badge label={status.label} tone={status.tone} />
        <Text style={[styles.date, { color: c.textSubtle }]}>{date}</Text>
      </View>
      {stats && stats.sent > 0 ? (
        <View style={[styles.stats, { borderTopColor: c.border }]}>
          <MiniStat label="Envoyés" value={formatNumber(stats.sent)} />
          <MiniStat label="Ouverture" value={formatPercent(stats.open_rate)} />
          <MiniStat label="Clics" value={formatPercent(stats.click_rate)} />
        </View>
      ) : null}
    </Pressable>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  filters: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  row: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 16, fontWeight: '700' },
  subject: { fontSize: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { fontSize: 12 },
  stats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
});

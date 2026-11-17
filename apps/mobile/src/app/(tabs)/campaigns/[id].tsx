import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BarChart } from '@/components/BarChart';
import { Badge, Button, Card, ErrorState, InfoRow, LoadingState, Screen, SectionTitle, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { confirmAsync, notify } from '@/lib/dialogs';
import { campaignStatusLabel, formatDateTime, formatNumber, formatPercent, plural } from '@/lib/format';
import { spacing, useColors } from '@/lib/theme';
import type { CampaignStats } from '@/lib/types';
import { useApiQuery } from '@/lib/useApi';

const POLL_MS = 3000;

export default function CampaignDetailScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, account } = useAuth();
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);

  const { data, error, loading, refreshing, refresh, reload } = useApiQuery(
    async (client) => {
      const [campaign, stats, segments] = await Promise.all([
        client.getCampaign(id),
        client.getCampaignStats(id).catch((): CampaignStats | null => null),
        client.listSegments().catch(() => null),
      ]);
      const segment = campaign.segment_id ? segments?.data.find((s) => s.id === campaign.segment_id) : undefined;
      return { campaign, stats, segmentName: segment?.name ?? null };
    },
    [id],
  );

  const status = data?.campaign.status;

  // While the worker is sending, poll so status and stats update live.
  useEffect(() => {
    if (status !== 'sending') return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, reload]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const { campaign, stats, segmentName } = data;
  const statusInfo = campaignStatusLabel[campaign.status];
  const canSend = campaign.status === 'draft' || campaign.status === 'scheduled';

  async function sendTest() {
    setTesting(true);
    try {
      const to = account?.email ?? (await api.me()).account.email;
      await api.sendTestCampaign(campaign.id, to);
      notify('Test envoyé', `Un email de test a été envoyé à ${to}.`);
    } catch (e) {
      notify('Échec du test', e instanceof Error ? e.message : "L'envoi du test a échoué.");
    } finally {
      setTesting(false);
    }
  }

  async function sendNow() {
    setSending(true);
    try {
      const count = await api.countRecipients(campaign.segment_id);
      if (count === 0) {
        notify('Aucun destinataire', "Aucun contact abonné ne correspond à l'audience de cette campagne.");
        return;
      }
      const audience = campaign.segment_id ? `du segment « ${segmentName ?? 'sélectionné'} »` : 'abonnés';
      const ok = await confirmAsync(
        'Envoyer maintenant ?',
        `« ${campaign.name} » va être envoyée à ${plural(count, 'contact')} ${audience}. Cette action est irréversible.`,
        `Envoyer à ${formatNumber(count)}`,
        { destructive: true },
      );
      if (!ok) return;
      await api.sendCampaign(campaign.id);
      await reload();
      notify('Envoi lancé', `La campagne part vers ${plural(count, 'destinataire')}.`);
    } catch (e) {
      notify("Échec de l'envoi", e instanceof Error ? e.message : "L'envoi a échoué.");
    } finally {
      setSending(false);
    }
  }

  const timeline = stats?.timeline ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: campaign.name }} />

      <View style={{ gap: spacing.sm }}>
        <Badge label={statusInfo.label} tone={statusInfo.tone} />
        <Text style={[styles.title, { color: c.text }]}>{campaign.name}</Text>
        <Text style={[styles.subject, { color: c.textMuted }]}>{campaign.subject}</Text>
      </View>

      {stats ? (
        <>
          <SectionTitle>Statistiques</SectionTitle>
          <Card style={styles.statsGrid}>
            <Stat label="Destinataires" value={formatNumber(stats.recipients)} />
            <Stat label="Envoyés" value={formatNumber(stats.sent)} />
            <Stat label="Échecs" value={formatNumber(stats.failed)} />
            <Stat label="Ouvertures" value={formatNumber(stats.opened)} />
            <Stat label="Clics" value={formatNumber(stats.clicked)} />
            <Stat label="Désabonnés" value={formatNumber(stats.unsubscribed)} />
          </Card>
          <View style={styles.rates}>
            <RateCard label="Taux d'ouverture" rate={stats.open_rate} />
            <RateCard label="Taux de clic" rate={stats.click_rate} />
          </View>
          {timeline.length ? (
            <Card>
              <Text style={[styles.cardTitle, { color: c.text }]}>Engagement par heure</Text>
              <BarChart
                data={timeline.slice(-24).map((p) => ({
                  label: formatHour(p.hour),
                  primary: p.opens,
                  secondary: p.clicks,
                }))}
                primaryLabel="Ouvertures"
                secondaryLabel="Clics"
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionTitle>Détails</SectionTitle>
      <Card style={{ paddingVertical: 0 }}>
        <InfoRow label="Objet" value={campaign.subject} />
        {campaign.preheader ? <InfoRow label="Pré-en-tête" value={campaign.preheader} /> : null}
        <InfoRow
          label="Expéditeur"
          value={[campaign.from_name, campaign.from_email ? `<${campaign.from_email}>` : null].filter(Boolean).join(' ') || '—'}
        />
        <InfoRow label="Audience" value={campaign.segment_id ? (segmentName ?? 'Segment') : 'Tous les abonnés'} />
        {campaign.scheduled_at ? <InfoRow label="Programmée" value={formatDateTime(campaign.scheduled_at)} /> : null}
        {campaign.sent_at ? <InfoRow label="Envoyée" value={formatDateTime(campaign.sent_at)} /> : null}
        <InfoRow label="Créée" value={formatDateTime(campaign.created_at)} last />
      </Card>

      <SectionTitle>Actions</SectionTitle>
      <View style={{ gap: spacing.md }}>
        <Button
          label={account?.email ? `Envoyer un test à ${account.email}` : 'Envoyer un test à mon email'}
          icon="flask-outline"
          variant="secondary"
          onPress={sendTest}
          loading={testing}
        />
        {canSend ? (
          <Button label="Envoyer maintenant" icon="send" onPress={sendNow} loading={sending} />
        ) : (
          <Text style={[styles.note, { color: c.textSubtle }]}>
            {campaign.status === 'sending'
              ? 'Envoi en cours… les statistiques se mettent à jour automatiquement.'
              : 'Cette campagne a déjà été envoyée.'}
          </Text>
        )}
      </View>
    </Screen>
  );
}

function RateCard({ label, rate }: { label: string; rate: number }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(1, rate || 0));
  return (
    <Card style={{ flex: 1, gap: spacing.sm }}>
      <Text style={{ color: c.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>{formatPercent(rate)}</Text>
      <View style={[styles.track, { backgroundColor: c.surfaceMuted }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.accent }]} />
      </View>
    </Card>
  );
}

function formatHour(hour: string): string {
  const d = new Date(hour);
  if (Number.isNaN(d.getTime())) return hour.slice(11, 13) ? `${hour.slice(11, 13)}h` : hour;
  return `${d.getHours()}h`;
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subject: { fontSize: 15, lineHeight: 21 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg, columnGap: spacing.md },
  rates: { flexDirection: 'row', gap: spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: spacing.md },
  note: { fontSize: 13, textAlign: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});

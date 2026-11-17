import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BarChart } from '@/components/BarChart';
import { Badge, Button, Card, ErrorState, InfoRow, LoadingState, Screen, SectionTitle, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { confirmAsync, notify } from '@/lib/dialogs';
import { campaignStatusLabel, formatDateTime, formatNumber, formatPercent, plural } from '@/lib/format';
import { LOCALE, t } from '@/lib/i18n';
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
      notify(t('Test envoyé', 'Test sent'), t(`Un email de test a été envoyé à ${to}.`, `A test email was sent to ${to}.`));
    } catch (e) {
      notify(
        t('Échec du test', 'Test failed'),
        e instanceof Error ? e.message : t("L'envoi du test a échoué.", "Couldn't send the test."),
      );
    } finally {
      setTesting(false);
    }
  }

  async function sendNow() {
    setSending(true);
    try {
      const count = await api.countRecipients(campaign.segment_id);
      if (count === 0) {
        notify(
          t('Aucun destinataire', 'No recipients'),
          t(
            "Aucun contact abonné ne correspond à l'audience de cette campagne.",
            'No subscribed contacts match this campaign’s audience.',
          ),
        );
        return;
      }
      const audience = campaign.segment_id ? `du segment « ${segmentName ?? 'sélectionné'} »` : 'abonnés';
      const audienceEn = campaign.segment_id
        ? `${plural(count, 'contact')} in the ${segmentName ? `“${segmentName}” segment` : 'selected segment'}`
        : `${plural(count, 'subscribed contact')}`;
      const ok = await confirmAsync(
        t('Envoyer maintenant ?', 'Send now?'),
        t(
          `« ${campaign.name} » va être envoyée à ${plural(count, 'contact')} ${audience}. Cette action est irréversible.`,
          `“${campaign.name}” will be sent to ${audienceEn}. This can’t be undone.`,
        ),
        t(`Envoyer à ${formatNumber(count)}`, `Send to ${formatNumber(count)}`),
        { destructive: true },
      );
      if (!ok) return;
      await api.sendCampaign(campaign.id);
      await reload();
      notify(
        t('Envoi lancé', 'Sending started'),
        t(
          `La campagne part vers ${plural(count, 'destinataire')}.`,
          `Your campaign is on its way to ${plural(count, 'recipient')}.`,
        ),
      );
    } catch (e) {
      notify(
        t("Échec de l'envoi", 'Send failed'),
        e instanceof Error ? e.message : t("L'envoi a échoué.", "Couldn't send the campaign."),
      );
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
          <SectionTitle>{t('Statistiques', 'Stats')}</SectionTitle>
          <Card style={styles.statsGrid}>
            <Stat label={t('Destinataires', 'Recipients')} value={formatNumber(stats.recipients)} />
            <Stat label={t('Envoyés', 'Sent')} value={formatNumber(stats.sent)} />
            <Stat label={t('Échecs', 'Failed')} value={formatNumber(stats.failed)} />
            <Stat label={t('Ouvertures', 'Opens')} value={formatNumber(stats.opened)} />
            <Stat label={t('Clics', 'Clicks')} value={formatNumber(stats.clicked)} />
            <Stat label={t('Désabonnés', 'Unsubscribed')} value={formatNumber(stats.unsubscribed)} />
          </Card>
          <View style={styles.rates}>
            <RateCard label={t("Taux d'ouverture", 'Open rate')} rate={stats.open_rate} />
            <RateCard label={t('Taux de clic', 'Click rate')} rate={stats.click_rate} />
          </View>
          {timeline.length ? (
            <Card>
              <Text style={[styles.cardTitle, { color: c.text }]}>{t('Engagement par heure', 'Engagement by hour')}</Text>
              <BarChart
                data={timeline.slice(-24).map((p) => ({
                  label: formatHour(p.hour),
                  primary: p.opens,
                  secondary: p.clicks,
                }))}
                primaryLabel={t('Ouvertures', 'Opens')}
                secondaryLabel={t('Clics', 'Clicks')}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionTitle>{t('Détails', 'Details')}</SectionTitle>
      <Card style={{ paddingVertical: 0 }}>
        <InfoRow label={t('Objet', 'Subject')} value={campaign.subject} />
        {campaign.preheader ? <InfoRow label={t('Pré-en-tête', 'Preheader')} value={campaign.preheader} /> : null}
        <InfoRow
          label={t('Expéditeur', 'From')}
          value={[campaign.from_name, campaign.from_email ? `<${campaign.from_email}>` : null].filter(Boolean).join(' ') || '—'}
        />
        <InfoRow
          label={t('Audience', 'Audience')}
          value={campaign.segment_id ? (segmentName ?? t('Segment', 'Segment')) : t('Tous les abonnés', 'All subscribers')}
        />
        {campaign.scheduled_at ? <InfoRow label={t('Programmée', 'Scheduled')} value={formatDateTime(campaign.scheduled_at)} /> : null}
        {campaign.sent_at ? <InfoRow label={t('Envoyée', 'Sent')} value={formatDateTime(campaign.sent_at)} /> : null}
        <InfoRow label={t('Créée', 'Created')} value={formatDateTime(campaign.created_at)} last />
      </Card>

      <SectionTitle>{t('Actions', 'Actions')}</SectionTitle>
      <View style={{ gap: spacing.md }}>
        <Button
          label={
            account?.email
              ? t(`Envoyer un test à ${account.email}`, `Send a test to ${account.email}`)
              : t('Envoyer un test à mon email', 'Send a test to my email')
          }
          icon="flask-outline"
          variant="secondary"
          onPress={sendTest}
          loading={testing}
        />
        {canSend ? (
          <Button label={t('Envoyer maintenant', 'Send now')} icon="send" onPress={sendNow} loading={sending} />
        ) : (
          <Text style={[styles.note, { color: c.textSubtle }]}>
            {campaign.status === 'sending'
              ? t(
                  'Envoi en cours… les statistiques se mettent à jour automatiquement.',
                  'Sending… stats update automatically.',
                )
              : t('Cette campagne a déjà été envoyée.', 'This campaign has already been sent.')}
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
  if (Number.isNaN(d.getTime())) return hour.slice(11, 13) ? t(`${hour.slice(11, 13)}h`, `${hour.slice(11, 13)}:00`) : hour;
  return t(`${d.getHours()}h`, d.toLocaleTimeString(LOCALE, { hour: 'numeric' }));
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

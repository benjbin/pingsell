import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Card, EmptyState, ErrorState, InfoRow, LoadingState, Screen, SectionTitle, Stat, type IconName } from '@/components/ui';
import {
  contactDisplayName,
  contactStatusLabel,
  eventLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  initials,
  messageStatusLabel,
  sourceLabel,
} from '@/lib/format';
import { t } from '@/lib/i18n';
import { radius, spacing, useColors } from '@/lib/theme';
import type { ContactEvent, Message } from '@/lib/types';
import { useApiQuery } from '@/lib/useApi';

export default function ContactDetailScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refreshing, refresh } = useApiQuery((api) => api.getContact(id), [id]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const contact = data;
  const status = contactStatusLabel[contact.status] ?? { label: contact.status, tone: 'neutral' as const };
  const name = contactDisplayName(contact);
  const attributes = Object.entries(contact.attributes ?? {}).filter(([, v]) => v !== null && v !== '');

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: name }} />

      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.avatarText, { color: c.accentText }]}>{initials(contact)}</Text>
        </View>
        <Text style={[styles.name, { color: c.text }]}>{name}</Text>
        {name !== contact.email ? <Text style={{ color: c.textMuted }}>{contact.email}</Text> : null}
        <Badge label={status.label} tone={status.tone} />
      </View>

      <Card style={styles.statsGrid}>
        <Stat label={t('Dépensé', 'Spent')} value={formatCurrency(contact.total_spent)} />
        <Stat label={t('Commandes', 'Orders')} value={formatNumber(contact.orders_count)} />
        <Stat label={t('Dernière cmd', 'Last order')} value={contact.last_order_at ? formatDate(contact.last_order_at) : '—'} />
      </Card>

      <SectionTitle>Tags</SectionTitle>
      {contact.tags.length ? (
        <View style={styles.tags}>
          {contact.tags.map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: c.accentSoft }]}>
              <Ionicons name="pricetag" size={12} color={c.accentText} />
              <Text style={[styles.tagText, { color: c.accentText }]}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: c.textMuted }}>{t('Aucun tag.', 'No tags.')}</Text>
      )}

      <SectionTitle>{t('Informations', 'Details')}</SectionTitle>
      <Card style={{ paddingVertical: 0 }}>
        <InfoRow label="Email" value={contact.email} />
        <InfoRow label={t('Téléphone', 'Phone')} value={contact.phone || '—'} />
        <InfoRow label="Source" value={sourceLabel[contact.source] ?? contact.source} />
        {attributes.map(([key, value]) => (
          <InfoRow key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />
        ))}
        <InfoRow label={t('Ajouté le', 'Added on')} value={formatDate(contact.created_at)} last />
      </Card>

      <SectionTitle>{t('Activité récente', 'Recent activity')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        {contact.events.length ? (
          contact.events.map((event, i) => (
            <EventRow key={event.id} event={event} last={i === contact.events.length - 1} />
          ))
        ) : (
          <EmptyState icon="pulse-outline" title={t('Aucune activité', 'No activity')} />
        )}
      </Card>

      <SectionTitle>{t('Emails reçus', 'Emails received')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        {contact.messages.length ? (
          contact.messages.map((m, i) => <MessageRow key={m.id} message={m} last={i === contact.messages.length - 1} />)
        ) : (
          <EmptyState icon="mail-outline" title={t('Aucun email envoyé', 'No emails sent')} />
        )}
      </Card>
    </Screen>
  );
}

function describeEvent(event: ContactEvent): string | null {
  const d = event.data ?? {};
  const pick = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : null);
  switch (event.type) {
    case 'tag_added':
      return pick('tag');
    case 'click':
      return pick('url');
    case 'order': {
      const total = d.total ?? d.total_price ?? d.amount;
      return total !== undefined && total !== null ? formatCurrency(Number(total)) : pick('order_id');
    }
    case 'open':
    case 'unsubscribe':
      return pick('subject') ?? pick('campaign_name');
    default:
      return null;
  }
}

function EventRow({ event, last }: { event: ContactEvent; last: boolean }) {
  const c = useColors();
  const meta = eventLabel[event.type] ?? { label: event.type, icon: 'ellipse-outline' };
  const detail = describeEvent(event);
  return (
    <View style={[styles.timelineRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <View style={[styles.eventIcon, { backgroundColor: c.surfaceMuted }]}>
        <Ionicons name={meta.icon as IconName} size={16} color={c.accentText} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '600' }}>{meta.label}</Text>
        {detail ? (
          <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: c.textSubtle, fontSize: 12 }}>{formatDateTime(event.created_at)}</Text>
    </View>
  );
}

function MessageRow({ message, last }: { message: Message; last: boolean }) {
  const c = useColors();
  const engagement = message.clicked_at
    ? t('Cliqué', 'Clicked')
    : message.opened_at
      ? t('Ouvert', 'Opened')
      : messageStatusLabel[message.status];
  return (
    <View style={[styles.timelineRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
          {message.subject}
        </Text>
        <Text style={{ color: c.textSubtle, fontSize: 12 }}>{formatDateTime(message.sent_at ?? message.created_at)}</Text>
      </View>
      <Badge
        label={engagement}
        tone={message.clicked_at || message.opened_at ? 'accent' : message.status === 'sent' ? 'neutral' : 'warning'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm },
  avatar: { width: 72, height: 72, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  statsGrid: { flexDirection: 'row', gap: spacing.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { fontSize: 13, fontWeight: '600' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  eventIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Badge, EmptyState, ErrorState } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { contactDisplayName, contactStatusLabel, formatCurrency, formatNumber, initials } from '@/lib/format';
import { t } from '@/lib/i18n';
import { radius, spacing, useColors } from '@/lib/theme';
import type { Contact, ContactStatus } from '@/lib/types';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type StatusFilter = 'all' | ContactStatus;
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: t('Tous', 'All') },
  { key: 'subscribed', label: t('Abonnés', 'Subscribed') },
  { key: 'unsubscribed', label: t('Désabonnés', 'Unsubscribed') },
  { key: 'bounced', label: t('Rebonds', 'Bounced') },
];

export default function ContactsScreen() {
  const c = useColors();
  const { api } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Debounce the search field.
  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setLoading(true);
      setSearch(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  /** Fetches one page; callers set the matching spinner flag beforehand. Only the latest request applies. */
  const load = useCallback(
    (nextPage: number): Promise<void> => {
      const id = ++requestId.current;
      const isLatest = () => id === requestId.current;
      const settle = () => {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      };
      return api
        .listContacts({
          search: search || undefined,
          status: status === 'all' ? undefined : status,
          page: nextPage,
          limit: PAGE_SIZE,
        })
        .then(
          (res) => {
            if (!isLatest()) return;
            setItems((prev) =>
              nextPage === 1 ? res.data : [...prev, ...res.data.filter((n) => !prev.some((p) => p.id === n.id))],
            );
            setTotal(res.total);
            setPage(nextPage);
            setError(null);
            settle();
          },
          (e: unknown) => {
            if (!isLatest()) return;
            setError(e instanceof Error ? e.message : t('Une erreur est survenue', 'Something went wrong'));
            settle();
          },
        );
    },
    [api, search, status],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const hasMore = items.length < total;

  function changeStatus(next: StatusFilter) {
    if (next === status) return;
    setLoading(true);
    setStatus(next);
  }

  function retry() {
    setLoading(true);
    void load(1);
  }

  function refresh() {
    setRefreshing(true);
    void load(1);
  }

  function loadMore() {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    void load(page + 1);
  }


  if (error && !items.length && !loading) return <ErrorState message={error} onRetry={retry} />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accentText} />
      }
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Ionicons name="search" size={18} color={c.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('Rechercher un nom ou un email', 'Search by name or email')}
              placeholderTextColor={c.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={[styles.searchInput, { color: c.text }]}
            />
          </View>
          <View style={styles.filters}>
            {STATUS_FILTERS.map((f) => {
              const active = f.key === status;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => changeStatus(f.key)}
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
          </View>
          <Text style={[styles.count, { color: c.textMuted }]}>
            {loading
              ? t('Chargement…', 'Loading…')
              : t(
                  `${formatNumber(total)} contact${total > 1 ? 's' : ''}`,
                  `${formatNumber(total)} contact${total === 1 ? '' : 's'}`,
                )}
          </Text>
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxl }} color={c.accentText} />
        ) : (
          <EmptyState
            icon="people-outline"
            title={t('Aucun contact', 'No contacts')}
            text={
              search
                ? t(`Aucun résultat pour « ${search} ».`, `No results for “${search}”.`)
                : t('Importez des contacts ou connectez Shopify.', 'Import contacts or connect Shopify.')
            }
          />
        )
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={c.accentText} /> : undefined}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }) => <ContactRow contact={item} />}
    />
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  const c = useColors();
  const status = contactStatusLabel[contact.status] ?? { label: contact.status, tone: 'neutral' as const };
  const name = contactDisplayName(contact);
  return (
    <Pressable
      onPress={() => router.push(`/contacts/${contact.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: c.accentSoft }]}>
        <Text style={[styles.avatarText, { color: c.accentText }]}>{initials(contact)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        {name !== contact.email ? (
          <Text style={[styles.email, { color: c.textMuted }]} numberOfLines={1}>
            {contact.email}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Badge label={status.label} tone={status.tone} />
          {contact.total_spent > 0 ? (
            <Text style={[styles.spent, { color: c.textSubtle }]}>{formatCurrency(contact.total_spent)}</Text>
          ) : null}
          {contact.tags.length ? (
            <Text style={[styles.spent, { color: c.textSubtle }]} numberOfLines={1}>
              #{contact.tags.slice(0, 2).join(' #')}
              {contact.tags.length > 2 ? ` +${contact.tags.length - 2}` : ''}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  count: { fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '600' },
  email: { fontSize: 13 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4, flexWrap: 'wrap' },
  spent: { fontSize: 12, flexShrink: 1 },
});

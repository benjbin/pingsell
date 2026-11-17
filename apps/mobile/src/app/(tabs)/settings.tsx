import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Card, ErrorState, InfoRow, LoadingState, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { radius, spacing, useColors } from '@/lib/theme';
import { useApiQuery } from '@/lib/useApi';

export default function SettingsScreen() {
  const c = useColors();
  const { apiUrl, signOut } = useAuth();
  const { data, error, loading, refreshing, refresh } = useApiQuery((api) => api.me());

  function confirmLogout() {
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Se déconnecter', 'Voulez-vous vraiment vous déconnecter de Pingsell ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  if (loading && !data) return <LoadingState />;
  if (error && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ErrorState message={error} onRetry={refresh} />
        <View style={{ padding: spacing.lg }}>
          <Button label="Se déconnecter" variant="danger" icon="log-out-outline" onPress={confirmLogout} />
        </View>
      </View>
    );
  }
  if (!data) return null;

  const { account, usage } = data;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.avatarText, { color: c.accentText }]}>{account.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]}>{account.name}</Text>
          <Text style={{ color: c.textMuted }}>{account.email}</Text>
        </View>
      </Card>

      <SectionTitle>Compte</SectionTitle>
      <Card style={styles.list}>
        <InfoRow label="Nom" value={account.name} />
        <InfoRow label="Email" value={account.email} />
        <InfoRow label="Membre depuis" value={formatDate(account.created_at)} last />
      </Card>

      <SectionTitle>Utilisation</SectionTitle>
      <Card style={styles.usage}>
        <UsageTile icon="send-outline" label="Emails envoyés ce mois" value={formatNumber(usage.emails_sent_month)} />
        <UsageTile icon="people-outline" label="Contacts" value={formatNumber(usage.contacts)} />
      </Card>
      <Text style={[styles.note, { color: c.textSubtle }]}>
        La facturation Pingsell est basée sur le volume d’emails envoyés.
      </Text>

      <SectionTitle>Application</SectionTitle>
      <Card style={styles.list}>
        <InfoRow label="Serveur API" value={apiUrl} />
        <InfoRow label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} last />
      </Card>

      <Button label="Se déconnecter" variant="danger" icon="log-out-outline" onPress={confirmLogout} />
    </Screen>
  );
}

function UsageTile({ icon, label, value }: { icon: 'send-outline' | 'people-outline'; label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Ionicons name={icon} size={18} color={c.accentText} />
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: c.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700' },
  list: { paddingVertical: 0 },
  usage: { flexDirection: 'row', gap: spacing.lg },
  note: { fontSize: 12, marginTop: -spacing.sm },
});

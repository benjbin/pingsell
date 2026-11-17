import { Stack } from 'expo-router';

import { t } from '@/lib/i18n';
import { useColors } from '@/lib/theme';

export default function CampagnesStackLayout() {
  const c = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
        headerTintColor: c.accentText,
        headerTitleStyle: { color: c.text, fontWeight: '700' },
        headerBackTitle: t('Retour', 'Back'),
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('Campagnes', 'Campaigns') }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}

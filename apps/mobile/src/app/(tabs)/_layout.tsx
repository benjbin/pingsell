import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';

import type { IconName } from '@/components/ui';
import { useColors } from '@/lib/theme';

function tabIcon(active: IconName, inactive: IconName) {
  return function TabIcon({ color, size, focused }: { color: unknown; size: number; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={typeof color === 'string' ? color : undefined} />;
  };
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: tabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: 'Campagnes',
          headerShown: false,
          tabBarIcon: tabIcon('paper-plane', 'paper-plane-outline'),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          headerShown: false,
          tabBarIcon: tabIcon('people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Réglages',
          tabBarIcon: tabIcon('settings', 'settings-outline'),
        }}
      />
    </Tabs>
  );
}

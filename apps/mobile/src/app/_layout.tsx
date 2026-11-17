import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { LoadingState } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const c = useColors();

  const navTheme = useMemo<Theme>(() => {
    const base = c.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.accentText,
        background: c.background,
        card: c.surface,
        text: c.text,
        border: c.border,
      },
    };
  }, [c]);

  if (status === 'loading') return <LoadingState />;

  const signedIn = status === 'signedIn';
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

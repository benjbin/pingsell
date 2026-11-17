import { useColorScheme } from 'react-native';

export interface Palette {
  scheme: 'light' | 'dark';
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
}

/** Thème SaaS : neutres slate, accent bleu #2563EB (même système que le back-office). */
const light: Palette = {
  scheme: 'light',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  border: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#94A3B8',
  accent: '#2563EB',
  accentSoft: '#DBEAFE',
  accentText: '#1D4ED8',
  onAccent: '#FFFFFF',
  success: '#047857',
  successSoft: '#D1FAE5',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  info: '#0369A1',
  infoSoft: '#E0F2FE',
};

const dark: Palette = {
  scheme: 'dark',
  background: '#0B1220',
  surface: '#0F172A',
  surfaceMuted: '#1E293B',
  border: '#1E293B',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  accent: '#3B82F6',
  accentSoft: '#172554',
  accentText: '#60A5FA',
  onAccent: '#FFFFFF',
  success: '#34D399',
  successSoft: '#064E3B',
  warning: '#FBBF24',
  warningSoft: '#451A03',
  danger: '#F87171',
  dangerSoft: '#450A0A',
  info: '#38BDF8',
  infoSoft: '#0C4A6E',
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

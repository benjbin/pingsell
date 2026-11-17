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

/** DA Neokrome : bleu nuit #0B214A, bleu électrique #145CFF (même système que le back-office). */
const light: Palette = {
  scheme: 'light',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F8',
  border: '#DDE4F0',
  text: '#0B214A',
  textMuted: '#4A5878',
  textSubtle: '#8F9BB5',
  accent: '#145CFF',
  accentSoft: '#DCE6FF',
  accentText: '#0A3FCC',
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
  background: '#071733',
  surface: '#0B214A',
  surfaceMuted: '#102B5C',
  border: '#142A55',
  text: '#FFFFFF',
  textMuted: '#C3CDDF',
  textSubtle: '#8F9BB5',
  accent: '#145CFF',
  accentSoft: '#0C2C80',
  accentText: '#85A8FF',
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

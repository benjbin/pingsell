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

/** « Encre & Signal » : papier crème, noir d'encre, accent vermillon (même système que le back-office). */
const light: Palette = {
  scheme: 'light',
  background: '#F3F1EA',
  surface: '#FFFFFF',
  surfaceMuted: '#EFEDE6',
  border: '#E3E0D6',
  text: '#0E0E0C',
  textMuted: '#5B5850',
  textSubtle: '#A29D90',
  accent: '#FF4D1C',
  accentSoft: '#FFE3D8',
  accentText: '#E83C0B',
  onAccent: '#FFFFFF',
  success: '#047857',
  successSoft: '#D1FAE5',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  info: '#0E0E0C',
  infoSoft: '#EFEDE6',
};

const dark: Palette = {
  scheme: 'dark',
  background: '#0E0E0C',
  surface: '#181816',
  surfaceMuted: '#282723',
  border: '#282723',
  text: '#F3F1EA',
  textMuted: '#A29D90',
  textSubtle: '#79746A',
  accent: '#FF4D1C',
  accentSoft: '#421005',
  accentText: '#FF7148',
  onAccent: '#FFFFFF',
  success: '#34D399',
  successSoft: '#064E3B',
  warning: '#FBBF24',
  warningSoft: '#451A03',
  danger: '#F87171',
  dangerSoft: '#450A0A',
  info: '#F3F1EA',
  infoSoft: '#282723',
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

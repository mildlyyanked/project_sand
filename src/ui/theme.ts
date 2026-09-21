import { Platform, useColorScheme } from 'react-native';

export const dark = {
  bg: '#0E0F12',
  surface: '#16181D',
  surface2: '#1F2229',
  border: '#2A2E37',
  text: '#E8E6E1',
  dim: '#9A9CA5',
  faint: '#5F626B',
  accent: '#D8A657',
  accentText: '#1A1405',
  danger: '#E06C75',
  ok: '#8FB573',
  warn: '#E5C07B',
  info: '#61AFEF',
};
export const light: typeof dark = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  surface2: '#EFECE5',
  border: '#DDD9D0',
  text: '#1C1B18',
  dim: '#5E5C56',
  faint: '#9A978F',
  accent: '#A8721E',
  accentText: '#FFFFFF',
  danger: '#B3261E',
  ok: '#4E7A2E',
  warn: '#8A6A12',
  info: '#2B6CB0',
};
export type Theme = typeof dark;

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' });
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'light' ? light : dark;
}

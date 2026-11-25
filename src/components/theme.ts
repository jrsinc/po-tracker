import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  warning: string;
  success: string;
  chip: string;
  chipActive: string;
  inputBg: string;
}

const light: Theme = {
  dark: false,
  bg: '#F6F7F9',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#5B6472',
  border: '#E2E5EA',
  primary: '#1F6FEB',
  primaryText: '#FFFFFF',
  danger: '#C62828',
  warning: '#9A5B00',
  success: '#1A7F37',
  chip: '#EEF2F7',
  chipActive: '#DBE8FD',
  inputBg: '#FFFFFF',
};

const dark: Theme = {
  dark: true,
  bg: '#0D1117',
  card: '#161B22',
  text: '#E6EDF3',
  muted: '#9AA4AF',
  border: '#30363D',
  primary: '#4493F8',
  primaryText: '#0D1117',
  danger: '#FF7B72',
  warning: '#E3B341',
  success: '#56D364',
  chip: '#21262D',
  chipActive: '#1F3A5F',
  inputBg: '#0D1117',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

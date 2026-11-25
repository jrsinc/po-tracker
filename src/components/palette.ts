import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Theme } from './theme';

/** Colours that carry meaning: status pills, section bands, dates. Light and dark variants. */

export interface Swatch {
  fg: string;
  bg: string;
}

type IconName = ComponentProps<typeof Ionicons>['name'];

const STATUS_LIGHT: Record<string, Swatch> = {
  active: { fg: '#0B5CAD', bg: '#DCEBFF' },
  'ready to ship': { fg: '#6B3FA0', bg: '#EEE3FB' },
  stored: { fg: '#8A5300', bg: '#FFEFC7' },
  completed: { fg: '#146C2E', bg: '#D7F5DF' },
  cancelled: { fg: '#B42318', bg: '#FDE2DF' },
};
const STATUS_DARK: Record<string, Swatch> = {
  active: { fg: '#79B8FF', bg: '#0F2B4D' },
  'ready to ship': { fg: '#D2A8FF', bg: '#2E1F4A' },
  stored: { fg: '#F2CC60', bg: '#3D2E00' },
  completed: { fg: '#7EE787', bg: '#0F3320' },
  cancelled: { fg: '#FFA198', bg: '#4A1715' },
};

/** Colour for a Status value. Unknown values get a neutral grey. */
export function statusSwatch(status: string, t: Theme): Swatch {
  const map = t.dark ? STATUS_DARK : STATUS_LIGHT;
  return map[status.trim().toLowerCase()] ?? { fg: t.muted, bg: t.chip };
}

/** Section band colours and icons on the PO detail screen, by schema group key. */
const GROUPS: Record<string, { light: string; dark: string; icon: IconName }> = {
  order: { light: '#1F6FEB', dark: '#1F4E8C', icon: 'clipboard-outline' },
  customer: { light: '#0E7C86', dark: '#0B5960', icon: 'business-outline' },
  sales: { light: '#5B4BC4', dark: '#3F3488', icon: 'receipt-outline' },
  vendor: { light: '#B5562A', dark: '#7D3B1D', icon: 'storefront-outline' },
  invoice: { light: '#1A7F37', dark: '#145A28', icon: 'cash-outline' },
  product: { light: '#8E3FA6', dark: '#612B72', icon: 'medkit-outline' },
  receiving: { light: '#0B7A5C', dark: '#085641', icon: 'download-outline' },
  dispatch: { light: '#C2410C', dark: '#8A2E08', icon: 'paper-plane-outline' },
  costs: { light: '#4B5563', dark: '#374151', icon: 'calculator-outline' },
  other: { light: '#4B5563', dark: '#374151', icon: 'ellipsis-horizontal-circle-outline' },
};

export function groupStyle(key: string, t: Theme): { band: string; icon: IconName } {
  const g = GROUPS[key] ?? GROUPS.other!;
  return { band: t.dark ? g.dark : g.light, icon: g.icon };
}

/** Accent for date values. */
export function dateColor(t: Theme): string {
  return t.dark ? '#79B8FF' : '#0B5CAD';
}

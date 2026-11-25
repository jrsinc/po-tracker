import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import type { AppServices } from './appServices';

const WEB_INTERVAL_MS = 5 * 60_000;
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Sync triggers: app start, regaining connectivity, returning to the foreground, a timer on
 * web (no background tasks there), and shortly after each local save when online.
 * Pull-to-refresh and "Sync now" call services.runCycle('manual') directly.
 */
export function startSyncCoordinator(services: AppServices): () => void {
  let wasOnline: boolean | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubNet = NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    services.setOnline(online);
    if (online && wasOnline === false) void services.runCycle('reconnect');
    wasOnline = online;
  });

  const appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void services.runCycle('foreground');
  });

  const interval = Platform.OS === 'web' ? setInterval(() => void services.runCycle('timer'), WEB_INTERVAL_MS) : null;

  void services.runCycle('start');

  return () => {
    unsubNet();
    appSub.remove();
    if (interval) clearInterval(interval);
    if (saveTimer) clearTimeout(saveTimer);
  };
}

let pendingSave: ReturnType<typeof setTimeout> | null = null;

/** Call after a local edit: refreshes screens now and syncs shortly after if online. */
export function afterLocalChange(services: AppServices): void {
  services.notifyDataChanged();
  void services.refreshStatus();
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    if (services.status.online) void services.runCycle('local-save');
  }, SAVE_DEBOUNCE_MS);
}

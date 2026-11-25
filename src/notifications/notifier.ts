import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import type { Notice } from './rules';

/** Native local notifications (no push server: alerts are generated on the device). */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

let initialised = false;

export async function initNotifications(): Promise<void> {
  if (initialised) return;
  initialised = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('po-alerts', {
      name: 'PO alerts',
      importance: AndroidImportance.DEFAULT,
    });
  }
}

export async function getPermission(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  await initNotifications();
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: false },
  });
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function showNotice(n: Notice): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body,
      data: n.itemLocalId ? { itemLocalId: n.itemLocalId } : {},
    },
    trigger: Platform.OS === 'android' ? { channelId: 'po-alerts' } : null,
  });
}

/** Calls back with the PO id when the user taps an alert. Returns an unsubscribe function. */
export function onNoticeOpened(cb: (itemLocalId: string | null) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const id = r.notification.request.content.data?.itemLocalId;
    cb(typeof id === 'string' ? id : null);
  });
  return () => sub.remove();
}

import type { Notice } from './rules';

/**
 * Web: browser notifications while the tab is open (browsers do not run this app in the
 * background without a server-sent push, which the SharePoint-only design does not use).
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;
let openHandler: ((itemLocalId: string | null) => void) | null = null;

export async function initNotifications(): Promise<void> {}

export async function getPermission(): Promise<PermissionState> {
  if (!supported()) return 'unsupported';
  const p = Notification.permission;
  return p === 'default' ? 'undetermined' : p;
}

export async function requestPermission(): Promise<PermissionState> {
  if (!supported()) return 'unsupported';
  const p = await Notification.requestPermission();
  return p === 'default' ? 'undetermined' : p;
}

export async function showNotice(n: Notice): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const note = new Notification(n.title, { body: n.body, tag: n.key });
  note.onclick = () => {
    window.focus();
    openHandler?.(n.itemLocalId ?? null);
    note.close();
  };
}

export function onNoticeOpened(cb: (itemLocalId: string | null) => void): () => void {
  openHandler = cb;
  return () => {
    if (openHandler === cb) openHandler = null;
  };
}

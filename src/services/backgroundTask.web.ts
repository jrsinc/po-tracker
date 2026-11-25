/**
 * Web has no background task API for this app. While the tab is open, the app syncs on a timer
 * instead (see SyncCoordinator); these stubs keep the shared code platform-neutral.
 */
export const BACKGROUND_SYNC_TASK = 'potracker-background-sync';

export async function registerBackgroundSync(): Promise<boolean> {
  return false;
}

export async function unregisterBackgroundSync(): Promise<void> {}

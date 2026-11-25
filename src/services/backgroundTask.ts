import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { getServices } from './appServices';

/**
 * Periodic background sync (iOS BGTaskScheduler / Android WorkManager). The OS decides when it
 * runs (minimum 15 minutes, often less frequent). It syncs records, sends queued uploads and
 * raises local notifications. This module must be imported at app start-up (root layout).
 */
export const BACKGROUND_SYNC_TASK = 'potracker-background-sync';

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const services = await getServices();
    if (!(await services.isSignedIn())) return BackgroundTask.BackgroundTaskResult.Success;
    await services.runCycle('background');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(intervalMinutes = 30): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: Math.max(15, intervalMinutes) });
  return true;
}

export async function unregisterBackgroundSync(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}

import { Platform } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';

/**
 * Keeps the process alive while work is in flight. Android freezes backgrounded
 * apps and drops their sockets; a foreground service with a visible notification
 * is the sanctioned way to keep a stream open when the writer switches apps.
 */
const CHANNEL = 'sand-work';
const NOTIFICATION_ID = 'sand-active';
let active = 0;
let release: (() => void) | null = null;
let label = 'Working';
let registered = false;

function ensureRegistered() {
  if (registered || Platform.OS !== 'android') return;
  registered = true;
  notifee.registerForegroundService(() => new Promise<void>((resolve) => { release = resolve; }));
}

async function show() {
  await notifee.createChannel({ id: CHANNEL, name: 'Background writing', importance: AndroidImportance.LOW, vibration: false });
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: 'Sand',
    body: label,
    android: { channelId: CHANNEL, asForegroundService: true, ongoing: true, onlyAlertOnce: true, pressAction: { id: 'default' }, progress: { indeterminate: true } },
  });
}

/** Request notification permission once; the service still runs without it, only silently. */
export async function askNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.requestPermission();
  } catch {}
}

/** Run a task under the foreground service. Nested calls share one notification. */
export async function runInForeground<T>(what: string, task: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'android') return task();
  ensureRegistered();
  active++;
  label = what;
  try {
    if (active === 1) await show().catch(() => {});
    else await notifee.displayNotification({ id: NOTIFICATION_ID, title: 'Sand', body: label, android: { channelId: CHANNEL, asForegroundService: true, ongoing: true, onlyAlertOnce: true, progress: { indeterminate: true } } }).catch(() => {});
    return await task();
  } finally {
    active--;
    if (active === 0) {
      release?.();
      release = null;
      await notifee.stopForegroundService().catch(() => {});
      await notifee.cancelNotification(NOTIFICATION_ID).catch(() => {});
    }
  }
}

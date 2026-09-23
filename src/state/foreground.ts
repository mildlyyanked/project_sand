// Web and other platforms: no process freezing to work around, nothing to do.
export async function askNotificationPermission(): Promise<void> {}
export async function runInForeground<T>(_what: string, task: () => Promise<T>): Promise<T> {
  return task();
}

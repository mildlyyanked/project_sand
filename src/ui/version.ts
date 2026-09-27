import Constants from 'expo-constants';

/** "0.7.3 · build 15 · b80e185", from the config CI stamped at build time. */
export function appVersion(): string {
  const c = Constants.expoConfig;
  const extra = (c?.extra ?? {}) as { commit?: string };
  const parts = [c?.version ? `Sand ${c.version}` : 'Sand (dev)', c?.android?.versionCode ? `build ${c.android.versionCode}` : '', extra.commit ? extra.commit.slice(0, 7) : ''];
  return parts.filter(Boolean).join(' · ');
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'openrouter_api_key';

export async function loadApiKey(): Promise<string> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  }
  return (await SecureStore.getItemAsync(KEY)) ?? '';
}

export async function saveApiKey(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value) globalThis.localStorage?.setItem(KEY, value);
      else globalThis.localStorage?.removeItem(KEY);
    } catch {}
    return;
  }
  if (value) await SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(KEY);
}

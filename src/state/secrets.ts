import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'openrouter_api_key';
const IMAGE_KEY = 'image_api_key';

export async function loadSecret(name: string): Promise<string> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(name) ?? '';
    } catch {
      return '';
    }
  }
  return (await SecureStore.getItemAsync(name)) ?? '';
}

export async function saveSecret(name: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value) globalThis.localStorage?.setItem(name, value);
      else globalThis.localStorage?.removeItem(name);
    } catch {}
    return;
  }
  if (value) await SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(name);
}

export const loadApiKey = () => loadSecret(KEY);
export const saveApiKey = (value: string) => saveSecret(KEY, value);
export const loadImageKey = () => loadSecret(IMAGE_KEY);
export const saveImageKey = (value: string) => saveSecret(IMAGE_KEY, value);

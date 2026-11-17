import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small key/value wrapper: expo-secure-store on iOS/Android (Keychain / Keystore),
 * localStorage on web where SecureStore is unavailable.
 */

function webStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return webStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      webStorage()?.setItem(key, value);
    } catch {
      // stockage indisponible (navigation privée) : on ignore
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      webStorage()?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const STORAGE_KEYS = {
  token: 'missive.token',
  apiUrl: 'missive.apiUrl',
  email: 'missive.lastEmail',
} as const;

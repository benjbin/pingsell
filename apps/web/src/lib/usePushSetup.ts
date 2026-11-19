import { useEffect, useState } from "react";
import { api, getToken } from "./api";
import type { PushConfig } from "./types";

/** What is in place for push notifications, step by step (shared by the sidebar badge and the push page guide). */
export interface PushSetup {
  /** Firebase, APNs or Expo key saved. */
  key: boolean;
  /** Phones registered by the app (the SDK is in the app). */
  devices: number;
  /** Devices tied to a contact (needed for segments, tags and automations). */
  linked: number;
}

export const pushSetupOf = (c: PushConfig): PushSetup => ({
  key: c.fcm.configured || c.apns.configured || c.expo.configured,
  devices: c.devices.total,
  linked: c.devices.linked,
});

export const pushSetupDone = (s: PushSetup) => s.key && s.devices > 0 && s.linked > 0;

let cache: { token: string | null; value?: PushSetup; promise: Promise<PushSetup | undefined> } | null = null;
const listeners = new Set<(s: PushSetup | undefined) => void>();

function load() {
  const token = getToken();
  if (!cache || cache.token !== token) {
    const entry: NonNullable<typeof cache> = { token, promise: Promise.resolve(undefined) };
    entry.promise = api.push
      .config()
      .then(pushSetupOf)
      .catch(() => undefined)
      .then((s) => {
        if (s) entry.value = s;
        return s;
      });
    cache = entry;
  }
  return cache;
}

/** Called by the push page whenever it (re)loads its config, so the sidebar badge follows without a reload. */
export function publishPushSetup(c: PushConfig) {
  const s = pushSetupOf(c);
  cache = { token: getToken(), value: s, promise: Promise.resolve(s) };
  listeners.forEach((fn) => fn(s));
}

/** `undefined` while checking (or if it could not be read). */
export function usePushSetup(): PushSetup | undefined {
  const [setup, setSetup] = useState<PushSetup | undefined>(() => load().value);
  useEffect(() => {
    let alive = true;
    void load().promise.then((s) => alive && setSetup(s));
    listeners.add(setSetup);
    return () => {
      alive = false;
      listeners.delete(setSetup);
    };
  }, []);
  return setup;
}

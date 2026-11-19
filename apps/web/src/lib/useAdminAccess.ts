import { useEffect, useState } from "react";
import { api, getToken } from "./api";

// /admin/access is asked once per session token and cached: the sidebar and the /admin route share it.
let cache: { token: string | null; promise: Promise<boolean>; value?: boolean } | null = null;

function load(): { promise: Promise<boolean>; value?: boolean } {
  const token = getToken();
  if (!cache || cache.token !== token) {
    const entry: { token: string | null; promise: Promise<boolean>; value?: boolean } = {
      token,
      promise: Promise.resolve(false),
    };
    entry.promise = api.admin
      .access()
      .then((r) => r.admin === true)
      .catch(() => false)
      .then((admin) => {
        entry.value = admin;
        return admin;
      });
    cache = entry;
  }
  return cache;
}

/** `undefined` while checking, then whether the signed-in user is a platform admin. */
export function useAdminAccess(): boolean | undefined {
  const [admin, setAdmin] = useState<boolean | undefined>(() => load().value);
  useEffect(() => {
    let alive = true;
    void load().promise.then((v) => alive && setAdmin(v));
    return () => {
      alive = false;
    };
  }, []);
  return admin;
}

/** Asks (and caches) whether the user who just signed in is a platform admin. */
export function checkAdminAccess(): Promise<boolean> {
  return load().promise;
}

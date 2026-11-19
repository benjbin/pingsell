// "Connect to Pingsell" button of the WordPress and PrestaShop plugins: the plugin sends the merchant
// to /connecter/boutique with its platform, shop URL, return URL and a random state. Pure helpers
// (no React, no DOM besides sessionStorage) so they can be tested on their own.

import { safeReturnPath } from "./shopifyClaim";
import type { StorePlatform } from "./types";

export const STORE_CONNECT_PATH = "/connecter/boutique";
const PENDING_KEY = "ps_store_connect";

export const STORE_PLATFORMS: readonly StorePlatform[] = ["wordpress", "prestashop"];

export const PLATFORM_LABELS: Record<StorePlatform, string> = {
  wordpress: "WordPress",
  prestashop: "PrestaShop",
};

export interface StoreConnectRequest {
  platform: StorePlatform;
  /** Public URL of the shop, as sent by the plugin. */
  site: string;
  siteHost: string;
  /** Plugin admin page the merchant goes back to. */
  returnUrl: string;
  returnHost: string;
  state: string;
}

export type StoreConnectError = "platform" | "site" | "return_url" | "state" | "host_mismatch";

export type ParsedStoreConnect = { ok: true; request: StoreConnectRequest } | { ok: false; error: StoreConnectError };

/** http(s) URL with a host, or null. */
export function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url;
}

/** Validates the query string sent by the plugin (same rules as the API, which checks again). */
export function parseStoreConnectParams(input: URLSearchParams | string): ParsedStoreConnect {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const platform = params.get("platform") ?? "";
  if (!(STORE_PLATFORMS as readonly string[]).includes(platform)) return { ok: false, error: "platform" };
  const site = parseHttpUrl(params.get("site"));
  if (!site) return { ok: false, error: "site" };
  const returnUrl = parseHttpUrl(params.get("return_url"));
  if (!returnUrl) return { ok: false, error: "return_url" };
  const state = params.get("state") ?? "";
  if (state.length < 16 || state.length > 128) return { ok: false, error: "state" };
  if (returnUrl.hostname.toLowerCase() !== site.hostname.toLowerCase()) return { ok: false, error: "host_mismatch" };
  return {
    ok: true,
    request: {
      platform: platform as StorePlatform,
      site: params.get("site")!.trim(),
      siteHost: site.hostname.toLowerCase(),
      returnUrl: params.get("return_url")!.trim(),
      returnHost: returnUrl.hostname.toLowerCase(),
      state,
    },
  };
}

/** Where "Cancel" sends the merchant: back to the plugin with access_denied. Null if return_url isn't http(s). */
export function cancelRedirectUrl(returnUrl: string, state: string): string | null {
  const url = parseHttpUrl(returnUrl);
  if (!url) return null;
  url.searchParams.set("pingsell_error", "access_denied");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Same page with the original query, used as the return target of the login / sign-up round trip. */
export function storeConnectPath(search: string): string {
  const q = search.startsWith("?") ? search.slice(1) : search;
  return q ? `${STORE_CONNECT_PATH}?${q}` : STORE_CONNECT_PATH;
}

/** Only a relative path to this page is accepted back from storage. */
export function isStoreConnectPath(path: unknown): path is string {
  const safe = safeReturnPath(path);
  return !!safe && (safe === STORE_CONNECT_PATH || safe.startsWith(`${STORE_CONNECT_PATH}?`));
}

// Kept in sessionStorage so it survives the sign-up (which goes through the welcome flow).
export function savePendingStoreConnect(path: string) {
  if (!isStoreConnectPath(path)) return;
  try {
    sessionStorage.setItem(PENDING_KEY, path);
  } catch {
    /* private mode */
  }
}

export function clearPendingStoreConnect() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Page that finishes linking the shop, or null when none is pending. */
export function pendingStoreConnectPath(): string | null {
  let path: string | null = null;
  try {
    path = sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  return isStoreConnectPath(path) ? path : null;
}

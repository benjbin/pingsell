// One-time claim token handed over by the API after a Shopify install whose shop isn't linked to
// a Pingsell account yet. Kept in sessionStorage so it survives the login / sign-up round trip.

const CLAIM_KEY = "ps_shopify_claim";
export const SHOPIFY_CONNECT_PATH = "/shopify/connecter";

export function getPendingClaim(): string | null {
  try {
    return sessionStorage.getItem(CLAIM_KEY) || null;
  } catch {
    return null;
  }
}

export function savePendingClaim(claim: string) {
  try {
    sessionStorage.setItem(CLAIM_KEY, claim);
  } catch {
    /* private mode */
  }
}

export function clearPendingClaim() {
  try {
    sessionStorage.removeItem(CLAIM_KEY);
  } catch {
    /* ignore */
  }
}

/** Page that finishes attaching the shop, or null when no claim is pending. */
export function pendingClaimPath(): string | null {
  const claim = getPendingClaim();
  return claim ? `${SHOPIFY_CONNECT_PATH}?claim=${encodeURIComponent(claim)}` : null;
}

/** Only same-origin, relative paths ("/x", never "//host" or "/\host") are accepted as a return target. */
export function safeReturnPath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(path)) return null;
  return path;
}

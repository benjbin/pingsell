// État de santé du processus, lu par GET /health.
// Le worker appelle markWorkerTick() à chaque tour ; un worker qui ne tourne plus se voit dans /health.

let lastWorkerTick: number | undefined;

/** À appeler par le worker d'envoi à chaque tour (début ou fin de tick). */
export function markWorkerTick(at = Date.now()): void {
  lastWorkerTick = at;
}

/** Millisecondes depuis le dernier tour du worker, null s'il n'a encore jamais tourné. */
export function workerTickAgeMs(at = Date.now()): number | null {
  return lastWorkerTick === undefined ? null : Math.max(0, at - lastWorkerTick);
}

/** Au-delà, /health signale le worker comme figé (sans renvoyer d'erreur : le HTTP, lui, répond). */
export const WORKER_STALE_MS = 5 * 60_000;

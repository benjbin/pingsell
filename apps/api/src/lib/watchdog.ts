// Chien de garde : si la boucle d'événements reste bloquée (requête SQLite synchrone sans fin, boucle CPU…),
// l'API ne répond plus du tout mais le processus reste vivant, et Docker (restart: unless-stopped) ne redémarre
// jamais un conteneur simplement « unhealthy ». Un worker_thread, qui lui continue de tourner, surveille un
// battement posé par le fil principal chaque seconde ; sans battement depuis `timeoutMs`, il tue le processus
// (SIGKILL, le seul signal qui agit pendant que le fil principal est bloqué) et Docker le redémarre.
// Avec `init: true` (compose) ou tini (Dockerfile), node n'est pas le PID 1 : le SIGKILL n'est pas ignoré.
import { Worker } from 'node:worker_threads';

// JavaScript pur passé en eval : indépendant de tsx.
const WATCHDOG_CODE = `
const { workerData } = require('node:worker_threads');
const { writeSync } = require('node:fs');
const beat = new Int32Array(workerData.sab);
const timeoutMs = workerData.timeoutMs;
let last = Atomics.load(beat, 0);
let lastChange = performance.now();
setInterval(() => {
  const value = Atomics.load(beat, 0);
  const t = performance.now();
  if (value !== last) { last = value; lastChange = t; return; }
  const blocked = t - lastChange;
  if (blocked < timeoutMs) return;
  try {
    writeSync(2, JSON.stringify({ level: 60, time: Date.now(), pid: process.pid,
      msg: '[watchdog] boucle d\\'événements bloquée depuis ' + Math.round(blocked / 1000) + ' s : arrêt forcé du processus pour que Docker le redémarre' }) + '\\n');
  } catch {}
  process.kill(process.pid, 'SIGKILL');
}, Math.max(250, Math.min(5000, Math.floor(timeoutMs / 4))));
`;

export interface Watchdog {
  stop(): Promise<void>;
}

/** Démarre le chien de garde. `timeoutMs` <= 0 : désactivé. */
export function startWatchdog(timeoutMs: number): Watchdog {
  if (!(timeoutMs > 0)) return { stop: async () => undefined };
  const sab = new SharedArrayBuffer(4);
  const beat = new Int32Array(sab);
  const heartbeat = setInterval(() => Atomics.add(beat, 0, 1), 1000);
  heartbeat.unref();
  const worker = new Worker(WATCHDOG_CODE, { eval: true, workerData: { sab, timeoutMs } });
  worker.unref(); // ne retient pas le processus à l'arrêt
  worker.on('error', (err: unknown) => console.error(`[watchdog] ${err instanceof Error ? err.message : String(err)}`));
  return {
    async stop() {
      clearInterval(heartbeat);
      await worker.terminate();
    },
  };
}

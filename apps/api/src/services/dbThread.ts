// Travaux SQLite longs hors du fil principal : chaque appel ouvre sa propre connexion dans un worker_thread,
// fait une seule opération puis se ferme. Le fil principal (qui sert le HTTP) n'est jamais bloqué.
//
// Le code du thread est du JavaScript pur passé en `eval` : il ne dépend ni de tsx ni des chemins du projet,
// et marche pareil avec `node --import tsx`, `tsx watch` ou un futur build compilé.
import { Worker } from 'node:worker_threads';

const THREAD_CODE = `
const { workerData, parentPort } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { path, op, dest } = workerData;
let db;
try {
  db = new DatabaseSync(path, { readOnly: op === 'vacuum-into' });
  db.exec('PRAGMA busy_timeout = 5000');
  // Même fonction que openDatabase() : un index ou une vue qui l'utilise doit pouvoir être recopié par VACUUM INTO.
  db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));
  let result = null;
  if (op === 'vacuum-into') db.prepare('VACUUM INTO ?').run(dest);
  else if (op === 'checkpoint-passive') result = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
  else throw new Error('opération inconnue : ' + op);
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
} finally {
  try { db && db.close(); } catch {}
}
`;

export type DbThreadOp = { op: 'vacuum-into'; dest: string } | { op: 'checkpoint-passive' };

const running = new Set<Worker>();

/** Lance `op` sur la base `path` dans un thread à part. Résout avec le résultat de l'opération. */
export function runInDbThread(path: string, job: DbThreadOp): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(THREAD_CODE, { eval: true, workerData: { path, ...job } });
    running.add(worker);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      running.delete(worker);
      fn();
    };
    worker.once('message', (msg: { ok: boolean; result?: Record<string, unknown> | null; error?: string }) =>
      done(() => (msg.ok ? resolve(msg.result ?? null) : reject(new Error(msg.error ?? 'échec du thread SQLite')))),
    );
    worker.once('error', (err) => done(() => reject(err)));
    worker.once('exit', (code) => done(() => reject(new Error(`thread SQLite arrêté (code ${code})`))));
  });
}

/** Nombre de threads SQLite en cours (sauvegarde, checkpoint). */
export const dbThreadsRunning = (): number => running.size;

/**
 * À l'arrêt : demande l'arrêt des threads en cours (une sauvegarde interrompue est simplement refaite plus tard).
 * Attention : un thread au milieu d'un VACUUM INTO ne s'arrête qu'à la fin de la requête, et process.exit()
 * l'attend. Pour sortir tout de suite, server.ts tue le processus (SIGKILL) si des threads tournent encore.
 */
export function stopDbThreads(): void {
  for (const w of running) void w.terminate().catch(() => undefined);
}

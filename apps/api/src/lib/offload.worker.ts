import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { TASKS } from './offloadTasks.js';

/** Read worker (see offload.ts): one read-only connection, tasks run one after the other. */
const db = new DatabaseSync(String(workerData.path), { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA query_only = 1;');
db.exec('PRAGMA cache_size = -32768;'); // 32 MB per worker
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

const tasks = TASKS as unknown as Record<string, (db: DatabaseSync, ...args: unknown[]) => unknown>;

parentPort!.on('message', (msg: { id: number; name: string; args: unknown[] }) => {
  try {
    const task = tasks[msg.name];
    if (!task) throw new Error(`Unknown offload task: ${msg.name}`);
    parentPort!.postMessage({ id: msg.id, result: task(db, ...msg.args) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    parentPort!.postMessage({ id: msg.id, error: { message: e?.message ?? String(err), statusCode: e?.statusCode } });
  }
});
parentPort!.postMessage({ ready: true });

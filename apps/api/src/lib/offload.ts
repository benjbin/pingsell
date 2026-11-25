import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from '../db.js';
import { HttpError } from './http.js';
import type { TaskArgs, TaskName, TaskResult } from './offloadTasks.js';

/**
 * Heavy READ-ONLY queries (statistics, counts over millions of rows, platform admin) run in worker
 * threads, each with its own read-only connection to the same SQLite file (WAL: readers never block
 * the writer). Every node:sqlite call is synchronous, so a 2-second aggregate on the main thread is a
 * 2-second outage of the whole API; in a worker it only delays the page that asked for it.
 *
 * Falls back to running the task in-process when the database has no file (`:memory:`), when
 * OFFLOAD_WORKERS=0, or when workers cannot start (the result is the same, only slower to serve).
 */

interface Job {
  name: string;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  jobs: Map<number, Job>;
}

const WORKER_COUNT = Math.max(0, Math.min(4, Number.parseInt(process.env.OFFLOAD_WORKERS ?? '2', 10) || 0));
const WORKER_URL = new URL(`./offload.worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url);

class Pool {
  private slots: Slot[] = [];
  private nextId = 1;
  private failures = 0;
  disabled = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly path: string,
  ) {}

  run(name: string, args: unknown[]): Promise<unknown> {
    if (this.disabled) return runLocal(this.db, name, args);
    return new Promise((resolve, reject) => {
      const slot = this.pick();
      if (!slot) {
        runLocal(this.db, name, args).then(resolve, reject);
        return;
      }
      const id = this.nextId++;
      slot.jobs.set(id, { name, args, resolve, reject });
      // A busy worker keeps the process alive; an idle one does not (scripts, tests).
      slot.worker.ref();
      slot.worker.postMessage({ id, name, args });
    });
  }

  private pick(): Slot | undefined {
    while (this.slots.length < WORKER_COUNT) {
      const slot = this.spawn();
      if (!slot) break;
      this.slots.push(slot);
    }
    let best: Slot | undefined;
    for (const s of this.slots) if (!best || s.jobs.size < best.jobs.size) best = s;
    return best;
  }

  private spawn(): Slot | undefined {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_URL, { workerData: { path: this.path } });
    } catch {
      this.fail();
      return undefined;
    }
    const slot: Slot = { worker, ready: false, jobs: new Map() };
    worker.unref();
    worker.on('message', (msg: { ready?: boolean; id?: number; result?: unknown; error?: { message: string; statusCode?: number } }) => {
      if (msg.ready) {
        slot.ready = true;
        this.failures = 0;
        return;
      }
      const job = msg.id !== undefined ? slot.jobs.get(msg.id) : undefined;
      if (!job) return;
      slot.jobs.delete(msg.id!);
      if (!slot.jobs.size) worker.unref();
      if (msg.error) job.reject(msg.error.statusCode ? new HttpError(msg.error.statusCode, msg.error.message) : new Error(msg.error.message));
      else job.resolve(msg.result);
    });
    const drop = () => {
      this.slots = this.slots.filter((s) => s !== slot);
      if (!slot.ready) this.fail();
      // Jobs of a dead worker are not lost: they run here instead.
      for (const job of slot.jobs.values()) runLocal(this.db, job.name, job.args).then(job.resolve, job.reject);
      slot.jobs.clear();
    };
    worker.on('error', (err) => {
      console.error('[offload] worker error:', err);
      drop();
    });
    worker.on('exit', drop);
    return slot;
  }

  private fail() {
    this.failures++;
    if (this.failures >= 3) {
      this.disabled = true;
      console.error('[offload] read workers unavailable: heavy queries run on the main thread');
    }
  }
}

const pools = new WeakMap<DatabaseSync, Pool | null>();

function poolFor(db: DatabaseSync): Pool | null {
  if (pools.has(db)) return pools.get(db)!;
  let path: string | null = null;
  try {
    path = WORKER_COUNT > 0 ? db.location() : null;
  } catch {
    path = null;
  }
  const pool = path ? new Pool(db, path) : null;
  pools.set(db, pool);
  return pool;
}

async function runLocal(db: DatabaseSync, name: string, args: unknown[]): Promise<unknown> {
  const { TASKS } = await import('./offloadTasks.js');
  const task = (TASKS as unknown as Record<string, (db: DatabaseSync, ...a: unknown[]) => unknown>)[name];
  if (!task) throw new Error(`Unknown offload task: ${name}`);
  return task(db, ...args);
}

/** Runs a read-only task (see offloadTasks.ts) off the main thread. */
export function offload<K extends TaskName>(db: DatabaseSync, name: K, ...args: TaskArgs<K>): Promise<TaskResult<K>> {
  const pool = poolFor(db);
  return (pool ? pool.run(name, args) : runLocal(db, name, args)) as Promise<TaskResult<K>>;
}

/* ───────────── Small result cache (stale-while-revalidate) ───────────── */

interface Entry {
  value?: unknown;
  at: number;
  stale: boolean;
  pending?: Promise<unknown>;
}

const cache = new Map<string, Entry>();
const CACHE_MAX = 2000;

/**
 * Cached `compute()`: a value younger than `freshMs` is served as is; an older one (up to `maxStaleMs`)
 * is served at once while a single refresh runs in the background; otherwise the caller waits.
 */
export async function memo<T>(key: string, freshMs: number, maxStaleMs: number, compute: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  const age = entry ? Date.now() - entry.at : Infinity;
  const hasValue = !!entry && 'value' in entry;
  if (hasValue && !entry!.stale && age < freshMs) return entry!.value as T;
  const refresh = () => {
    if (entry?.pending) return entry.pending as Promise<T>;
    const e: Entry = entry ?? { at: 0, stale: true };
    const p = compute().then(
      (value) => {
        cache.delete(key); // re-insert: Map order = age order, for eviction
        cache.set(key, { value, at: Date.now(), stale: false });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return value;
      },
      (err) => {
        e.pending = undefined;
        throw err;
      },
    );
    e.pending = p;
    if (!entry) cache.set(key, e);
    return p;
  };
  if (hasValue && age < maxStaleMs) {
    refresh().catch((err) => console.error(`[memo] refresh of ${key} failed:`, err));
    return entry!.value as T;
  }
  return refresh();
}

/** Marks cached values whose key starts with `prefix` as stale (served once more while refreshed). */
export function memoInvalidate(prefix: string): void {
  for (const [key, entry] of cache) if (key.startsWith(prefix)) entry.stale = true;
}

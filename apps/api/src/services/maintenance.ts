import { all, get, run, transaction, type DatabaseSync } from '../db.js';
import { offload } from '../lib/offload.js';

/**
 * Query planner statistics (sqlite_stat1), so the planner keeps picking the right (covering) indexes as
 * tables grow to millions of rows. `optimizeDatabase()` is meant to be called by the worker about once an hour.
 *
 * Not `PRAGMA optimize` / `ANALYZE`: whatever `analysis_limit` says, analysing an index counts its rows with
 * a full scan, inside a write transaction, on the calling thread — 27 s (4.6 s for one index) on a cold
 * 1.4 M-message database: the API would freeze and other writers would hit SQLITE_BUSY. Here the same figures
 * are computed by a read worker (lib/offload.ts), off the main thread and without any lock, then written to
 * sqlite_stat1 in one tiny transaction and loaded with `ANALYZE sqlite_schema` (which only re-reads the table).
 */

export interface IndexStat {
  tbl: string;
  idx: string;
  stat: string;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Read-worker task: sqlite_stat1 rows (« rows avg-rows-per-key-prefix… ») of the indexes of `tables`.
 * Indexes on expressions are skipped (the planner keeps its defaults for them).
 */
export function indexStats(db: DatabaseSync, tables: string[]): IndexStat[] {
  const out: IndexStat[] = [];
  for (const tbl of tables) {
    for (const { name, sql } of all<{ name: string; sql: string | null }>(db, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", tbl)) {
      const keys = all<{ cid: number; name: string | null; key: number }>(db, `PRAGMA index_xinfo(${q(name)})`).filter((c) => c.key === 1);
      if (!keys.length || keys.some((c) => c.cid < 0 || !c.name)) continue;
      const where = sql?.match(/\)\s+WHERE\s+([\s\S]+)$/i)?.[1];
      const from = `FROM ${q(tbl)} INDEXED BY ${q(name)}${where ? ` WHERE ${where}` : ''}`;
      const rows = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n ${from}`)?.n ?? 0);
      if (!rows) continue;
      const avgs: number[] = [];
      for (let k = 1; k <= keys.length; k++) {
        const cols = keys.slice(0, k).map((c) => q(c.name!)).join(', ');
        const distinct = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM (SELECT DISTINCT ${cols} ${from})`)?.n ?? 1);
        avgs.push(Math.max(1, Math.ceil(rows / Math.max(1, distinct))));
      }
      out.push({ tbl, idx: name, stat: [rows, ...avgs].join(' ') });
    }
  }
  return out;
}

/** Table → MAX(rowid) when its statistics were last computed (in memory: recomputed after a restart). */
const lastSeen = new Map<string, { maxRowid: number; at: number }>();
const DAY_MS = 86_400_000;

/**
 * Refreshes the statistics of the tables that grew by more than 10 % (MAX(rowid), O(1)) or were not
 * analysed for a day. Main-thread cost: a few milliseconds; the counting runs in a read worker.
 */
export async function optimizeDatabase(db: DatabaseSync): Promise<{ tables: number; indexes: number; main_thread_ms: number; total_ms: number }> {
  const started = performance.now();
  let mainMs = 0;
  let t = performance.now();
  const candidates = all<{ name: string }>(
    db,
    `SELECT t.name FROM sqlite_master t
      WHERE t.type = 'table' AND t.name NOT LIKE 'sqlite_%' AND t.sql NOT LIKE 'CREATE VIRTUAL TABLE%'
        AND t.sql NOT LIKE '%WITHOUT ROWID%'
        AND EXISTS (SELECT 1 FROM sqlite_master i WHERE i.type = 'index' AND i.tbl_name = t.name)`,
  ).map((r) => r.name);
  const due: Array<{ name: string; maxRowid: number }> = [];
  for (const name of candidates) {
    const maxRowid = Number(get<{ m: number | null }>(db, `SELECT MAX(rowid) AS m FROM ${q(name)}`)?.m ?? 0);
    const prev = lastSeen.get(name);
    if (!prev || maxRowid > prev.maxRowid * 1.1 + 100 || Date.now() - prev.at > DAY_MS) due.push({ name, maxRowid });
  }
  mainMs += performance.now() - t;
  if (!due.length) return { tables: 0, indexes: 0, main_thread_ms: Math.round(mainMs), total_ms: Math.round(performance.now() - started) };

  const stats = await offload(db, 'indexStats', due.map((d) => d.name));

  t = performance.now();
  // sqlite_stat1 only exists after a first ANALYZE: analysing the one-row state table creates it for free.
  if (!get(db, "SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'")) db.exec('ANALYZE contacts_fts_state');
  transaction(db, () => {
    for (const s of stats) {
      run(db, 'DELETE FROM sqlite_stat1 WHERE tbl = ? AND idx = ?', s.tbl, s.idx);
      run(db, 'INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)', s.tbl, s.idx, s.stat);
    }
  });
  db.exec('ANALYZE sqlite_schema'); // reloads the statistics into the planner, reads nothing else
  for (const d of due) lastSeen.set(d.name, { maxRowid: d.maxRowid, at: Date.now() });
  mainMs += performance.now() - t;
  return { tables: due.length, indexes: stats.length, main_thread_ms: Math.round(mainMs), total_ms: Math.round(performance.now() - started) };
}

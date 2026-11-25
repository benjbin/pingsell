import { all, get, type DatabaseSync, type Row, type SQLInputValue } from '../db.js';
import { analytics } from '../services/analytics.js';
import { automationSources, monthlyUsage, overviewStats } from '../services/stats.js';
import { segmentCounts } from '../services/segments.js';
import { tagCounts } from '../services/contacts.js';
import { indexStats } from '../services/maintenance.js';
import { adminAccountDetail, adminAccountRows, adminDeliverability, adminOverview, adminTimeseries } from '../routes/admin.js';

/**
 * Read-only tasks that may run in a read worker (lib/offload.ts). Each one receives the connection
 * first, then structured-cloneable arguments, and returns a structured-cloneable value. Never write here:
 * the worker's connection is read-only.
 */
export const TASKS = {
  all: (db: DatabaseSync, sql: string, params: SQLInputValue[] = []) => all<Row>(db, sql, ...params),
  get: (db: DatabaseSync, sql: string, params: SQLInputValue[] = []) => get<Row>(db, sql, ...params) ?? null,
  analytics,
  overviewStats,
  monthlyUsage,
  automationSources,
  segmentCounts,
  tagCounts,
  indexStats,
  adminOverview,
  adminTimeseries,
  adminAccountRows,
  adminAccountDetail,
  adminDeliverability,
};

type Tasks = typeof TASKS;
export type TaskName = keyof Tasks;
type Rest<F> = F extends (db: DatabaseSync, ...args: infer A) => unknown ? A : never;
export type TaskArgs<K extends TaskName> = Rest<Tasks[K]>;
export type TaskResult<K extends TaskName> = Awaited<ReturnType<Tasks[K]>>;

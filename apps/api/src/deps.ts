import type { preHandlerHookHandler } from 'fastify';
import type { AppConfig } from './config.js';
import type { DatabaseSync } from './db.js';
import type { EmailProvider } from './services/mailer.js';

/** Shared dependencies handed to every route module. */
export interface Deps {
  db: DatabaseSync;
  config: AppConfig;
  provider: EmailProvider;
  requireAuth: preHandlerHookHandler;
  /** Wakes the background worker up (no-op when the worker is not running). */
  kickWorker: () => void;
}

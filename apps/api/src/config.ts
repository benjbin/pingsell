import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the api package (apps/api), independent of the current working directory. */
export const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = resolve(API_ROOT, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function str(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function optional(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export type EmailProviderName = 'log' | 'ses';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  publicUrl: string;
  webUrls: string[];
  isProduction: boolean;
  emailProvider: EmailProviderName;
  awsRegion: string;
  defaultFromEmail: string;
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  worker: {
    intervalMs: number;
    batchSize: number;
    ratePerSecond: number;
  };
}

function loadConfig(): AppConfig {
  const dbPath = str('DATABASE_PATH', './missive.db');
  const provider = str('EMAIL_PROVIDER', 'log').toLowerCase();
  return {
    port: int('PORT', 4000),
    host: str('HOST', '0.0.0.0'),
    databasePath: dbPath === ':memory:' || isAbsolute(dbPath) ? dbPath : resolve(API_ROOT, dbPath),
    publicUrl: str('PUBLIC_URL', 'http://localhost:4000').replace(/\/+$/, ''),
    webUrls: str('WEB_URL', 'http://localhost:5173')
      .split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    isProduction: process.env.NODE_ENV === 'production',
    emailProvider: provider === 'ses' ? 'ses' : 'log',
    awsRegion: str('AWS_REGION', 'eu-west-3'),
    defaultFromEmail: str('MAIL_FROM_EMAIL', 'bonjour@missive.local'),
    shopifyApiKey: optional('SHOPIFY_API_KEY'),
    shopifyApiSecret: optional('SHOPIFY_API_SECRET'),
    worker: {
      intervalMs: int('WORKER_INTERVAL_MS', 2000),
      batchSize: int('SEND_BATCH_SIZE', 50),
      ratePerSecond: int('SEND_RATE_PER_SECOND', 14),
    },
  };
}

export const config: AppConfig = loadConfig();

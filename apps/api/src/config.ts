import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { BackupConfig } from './services/backup.js';
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

export type EmailProviderName = 'log' | 'ses' | 'smtp';

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
  /**
   * Self-hosted sending (EMAIL_PROVIDER=smtp): the API hands messages to our own MTA
   * (apps/mta, Postfix + OpenDKIM), which delivers them straight to the recipients' servers.
   */
  smtp: {
    host: string;
    port: number;
    /** Domain we send from and receive bounces on (SPF / DKIM / DMARC live here). */
    mailDomain: string;
    /** Shared secret the MTA sends with every bounce / complaint it forwards to the API. */
    webhookSecret?: string;
  };
  /** IP warm-up: daily email cap that grows from `initial` by `growth` per day since `startDate`. */
  warmup?: { startDate: string; initial: number; growth: number; max: number };
  /**
   * Campaign emails under the warm-up cap are spread over this daily window (local time of `timeZone`)
   * instead of leaving in one burst; automation and transactional emails are not held by it.
   */
  sendWindow: { startHour: number; endHour: number; timeZone: string };
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  /**
   * Shopify App Pricing (plans sold on the App Store, billed by Shopify). The plan of a store is read from the
   * Partner API; unset = billing off, every store is on the free plan.
   */
  shopifyBilling?: { orgId: string; token: string; appId: string; appHandle: string };
  push: {
    /** 'live' (default) = real FCM / APNs / Expo calls, 'log' = nothing leaves the machine (local tests). */
    mode: 'log' | 'live';
    fcmUrl: string;
    apnsProductionUrl: string;
    apnsSandboxUrl: string;
    expoUrl: string;
  };
  worker: {
    intervalMs: number;
    batchSize: number;
    ratePerSecond: number;
  };
  /** Sauvegardes chiffrées de la base (off sans BACKUP_ENCRYPTION_KEY). */
  backup: BackupConfig;
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
    emailProvider: provider === 'ses' || provider === 'smtp' ? provider : 'log',
    awsRegion: str('AWS_REGION', 'eu-west-3'),
    defaultFromEmail: str('MAIL_FROM_EMAIL', `bonjour@${str('MAIL_DOMAIN', 'pingsell.local')}`),
    smtp: {
      host: str('SMTP_HOST', 'mta'),
      port: int('SMTP_PORT', 2525),
      mailDomain: str('MAIL_DOMAIN', 'pingsell.local').toLowerCase(),
      webhookSecret: optional('MTA_WEBHOOK_SECRET'),
    },
    warmup: optional('MAIL_WARMUP_START')
      ? {
          startDate: str('MAIL_WARMUP_START', ''),
          initial: int('MAIL_WARMUP_INITIAL', 200),
          growth: Number.parseFloat(process.env.MAIL_WARMUP_GROWTH ?? '') || 1.4,
          max: int('MAIL_WARMUP_MAX', 100_000),
        }
      : undefined,
    shopifyApiKey: optional('SHOPIFY_API_KEY'),
    shopifyApiSecret: optional('SHOPIFY_API_SECRET'),
    shopifyBilling:
      optional('SHOPIFY_PARTNER_ORG_ID') && optional('SHOPIFY_PARTNER_API_TOKEN') && optional('SHOPIFY_APP_ID')
        ? {
            orgId: str('SHOPIFY_PARTNER_ORG_ID', ''),
            token: str('SHOPIFY_PARTNER_API_TOKEN', ''),
            appId: str('SHOPIFY_APP_ID', '').replace(/^gid:\/\/shopify\/App\//, ''),
            appHandle: str('SHOPIFY_APP_HANDLE', 'pingsell'),
          }
        : undefined,
    push: {
      mode: str('PUSH_MODE', 'live').toLowerCase() === 'log' ? 'log' : 'live',
      fcmUrl: str('PUSH_FCM_URL', 'https://fcm.googleapis.com').replace(/\/+$/, ''),
      apnsProductionUrl: str('PUSH_APNS_URL', 'https://api.push.apple.com').replace(/\/+$/, ''),
      apnsSandboxUrl: str('PUSH_APNS_SANDBOX_URL', 'https://api.sandbox.push.apple.com').replace(/\/+$/, ''),
      expoUrl: str('PUSH_EXPO_URL', 'https://exp.host/--/api/v2/push/send'),
    },
    sendWindow: {
      startHour: int('SEND_WINDOW_START_HOUR', 8),
      endHour: int('SEND_WINDOW_END_HOUR', 21),
      timeZone: str('SEND_WINDOW_TZ', 'Europe/Paris'),
    },
    backup: {
      dir: str('BACKUP_DIR', '') || (dbPath === ':memory:' ? resolve(API_ROOT, 'backups') : join(dirname(isAbsolute(dbPath) ? dbPath : resolve(API_ROOT, dbPath)), 'backups')),
      key: optional('BACKUP_ENCRYPTION_KEY'),
      keep: int('BACKUP_KEEP', 3),
      intervalHours: int('BACKUP_INTERVAL_HOURS', 24),
      s3:
        optional('BACKUP_S3_ENDPOINT') && optional('BACKUP_S3_BUCKET') && optional('BACKUP_S3_ACCESS_KEY_ID') && optional('BACKUP_S3_SECRET_ACCESS_KEY')
          ? {
              endpoint: str('BACKUP_S3_ENDPOINT', ''),
              region: str('BACKUP_S3_REGION', 'us-east-1'),
              bucket: str('BACKUP_S3_BUCKET', ''),
              accessKeyId: str('BACKUP_S3_ACCESS_KEY_ID', ''),
              secretAccessKey: str('BACKUP_S3_SECRET_ACCESS_KEY', ''),
              prefix: str('BACKUP_S3_PREFIX', 'pingsell/'),
            }
          : undefined,
    },
    worker: {
      intervalMs: int('WORKER_INTERVAL_MS', 2000),
      batchSize: int('SEND_BATCH_SIZE', 50),
      ratePerSecond: int('SEND_RATE_PER_SECOND', 14),
    },
  };
}

export const config: AppConfig = loadConfig();

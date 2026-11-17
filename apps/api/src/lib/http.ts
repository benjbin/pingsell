import { z } from 'zod';
import { t } from '../i18n.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = t('Ressource introuvable', 'Resource not found')) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const forbidden = (message = t('Action réservée aux administrateurs du compte', 'Only account admins can do this')) => new HttpError(403, message);
export const unauthorized = (message = t('Authentification requise', 'Authentication required')) => new HttpError(401, message);

/** Formats a zod error into a short, human-readable message (current language). */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return t('Requête invalide', 'Invalid request');
  const field = issue.path.join('.');
  return t(
    `Requête invalide — ${field ? `${field} : ` : ''}${issue.message}`,
    `Invalid request — ${field ? `${field}: ` : ''}${issue.message}`,
  );
}

/** Validates `input` against `schema`, throwing a 400 HttpError on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw badRequest(formatZodError(result.error));
  return result.data;
}

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export function pagination(query: unknown): Pagination {
  const q = (query ?? {}) as Record<string, unknown>;
  const page = clampInt(q.page, 1, 1, 1_000_000);
  const limit = clampInt(q.limit, 50, 1, 200);
  return { page, limit, offset: (page - 1) * limit };
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export function listResponse<T>(data: T[], total: number, p: Pagination): ListResponse<T> {
  return { data, total, page: p.page, limit: p.limit };
}

export function queryString(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Localized zod message, resolved when the issue is raised (schemas are built at module load,
 * before any request language is known): `z.string().min(1, zmsg('Requis', 'Required'))`.
 */
export const zmsg = (fr: string, en: string) => ({ error: () => t(fr, en) });

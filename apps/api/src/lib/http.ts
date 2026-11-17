import { z } from 'zod';

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
export const notFound = (message = 'Ressource introuvable') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const forbidden = (message = 'Action réservée aux administrateurs du compte') => new HttpError(403, message);
export const unauthorized = (message = 'Authentification requise') => new HttpError(401, message);

/** Formats a zod error into a short, human-readable French message. */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Requête invalide';
  const path = issue.path.length ? `${issue.path.join('.')} : ` : '';
  return `Requête invalide — ${path}${issue.message}`;
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

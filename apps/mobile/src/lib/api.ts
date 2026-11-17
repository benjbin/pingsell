import type {
  AuthResponse,
  Campaign,
  CampaignStats,
  CampaignStatus,
  Contact,
  ContactDetail,
  ContactListParams,
  MeResponse,
  Paginated,
  Segment,
  StatsOverview,
} from './types';
import { LANG, t } from './i18n';

export const DEFAULT_API_URL = 'http://localhost:4000';
const API_PREFIX = '/api/v1';
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Normalise a user-typed base URL: trims, adds http:// if missing, drops trailing slashes and /api/v1. */
export function normalizeApiUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return DEFAULT_API_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  if (url.endsWith(API_PREFIX)) url = url.slice(0, -API_PREFIX.length);
  return url;
}

type Query = Record<string, string | number | undefined | null>;

function buildQuery(query?: Query): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  /** Called when the API answers 401 on an authenticated request. */
  onUnauthorized?: () => void;
}

/** Typed client for the Pingsell REST API (SPEC.md). */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly onUnauthorized?: () => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = normalizeApiUrl(options.baseUrl);
    this.token = options.token ?? null;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; query?: Query } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${API_PREFIX}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': LANG };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        t(
          `Impossible de joindre l'API (${this.baseUrl}). Vérifiez l'adresse et que le serveur est démarré.`,
          `Can't reach the API (${this.baseUrl}). Check the address and make sure the server is running.`,
        ),
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && this.token) this.onUnauthorized?.();
      const message =
        payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : t(`Erreur ${response.status}`, `Error ${response.status}`);
      throw new ApiError(message, response.status);
    }
    return payload as T;
  }

  // Auth
  login(email: string, password: string): Promise<AuthResponse> {
    return this.request('POST', '/auth/login', { body: { email, password } });
  }

  me(): Promise<MeResponse> {
    return this.request('GET', '/me');
  }

  // Stats
  statsOverview(days = 30): Promise<StatsOverview> {
    return this.request('GET', '/stats/overview', { query: { days } });
  }

  // Campaigns
  listCampaigns(status?: CampaignStatus): Promise<Paginated<Campaign>> {
    return this.request('GET', '/campaigns', { query: { status, limit: 200 } });
  }

  getCampaign(id: string): Promise<Campaign> {
    return this.request('GET', `/campaigns/${encodeURIComponent(id)}`);
  }

  getCampaignStats(id: string): Promise<CampaignStats> {
    return this.request('GET', `/campaigns/${encodeURIComponent(id)}/stats`);
  }

  sendTestCampaign(id: string, to: string): Promise<unknown> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/test`, { body: { to } });
  }

  sendCampaign(id: string): Promise<unknown> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/send`, { body: {} });
  }

  // Contacts
  listContacts(params: ContactListParams = {}): Promise<Paginated<Contact>> {
    return this.request('GET', '/contacts', { query: { ...params } });
  }

  async getContact(id: string): Promise<ContactDetail> {
    const raw = await this.request<ContactDetail | { contact: Contact; events?: ContactDetail['events']; messages?: ContactDetail['messages'] }>(
      'GET',
      `/contacts/${encodeURIComponent(id)}`,
    );
    // Accept both `{...contact, events, messages}` and `{ contact, events, messages }`.
    if ('contact' in raw && raw.contact) {
      return { ...raw.contact, events: raw.events ?? [], messages: raw.messages ?? [] };
    }
    const detail = raw as ContactDetail;
    return { ...detail, events: detail.events ?? [], messages: detail.messages ?? [] };
  }

  // Segments
  listSegments(): Promise<Paginated<Segment>> {
    return this.request('GET', '/segments', { query: { limit: 200 } });
  }

  /**
   * Number of contacts a campaign would reach right now:
   * subscribed contacts, optionally restricted to the campaign segment.
   */
  async countRecipients(segmentId: string | null): Promise<number> {
    const res = await this.listContacts({
      status: 'subscribed',
      segment_id: segmentId ?? undefined,
      limit: 1,
    });
    return res.total;
  }
}

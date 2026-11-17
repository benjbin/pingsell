// Typed client for the Missive REST API (see SPEC.md, base /api/v1).
import type {
  ApiKey,
  Asset,
  AuthResponse,
  Automation,
  AutomationInput,
  Campaign,
  CampaignInput,
  CampaignStats,
  CampaignStatus,
  Contact,
  ContactDetail,
  ContactInput,
  GeneratedEmail,
  GenerateEmailInput,
  ImportResult,
  Integration,
  MeResponse,
  Message,
  Paginated,
  SavedTemplate,
  Segment,
  SegmentPreview,
  SegmentRules,
  ShopifySyncResult,
  StatsOverview,
  TagCount,
} from "./types";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:4000";
const BASE = `${API_URL}/api/v1`;
const TOKEN_KEY = "missive_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Subscribe to 401 responses (used by the auth provider to log out). */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Impossible de joindre l'API (${API_URL}). Vérifiez qu'elle est démarrée.`);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedListeners.forEach((fn) => fn());
    const message =
      json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return json as T;
}

/** Single-resource endpoints may answer `T` or `{ data: T }`; normalise to `T`. */
function one<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && !("id" in payload) && "data" in payload) {
    const data = (payload as { data: unknown }).data;
    if (data && typeof data === "object" && !Array.isArray(data)) return data as T;
  }
  return payload as T;
}

/** Contact detail may be `{...contact, events, messages}` or `{ contact, events, messages }`. */
function toContactDetail(payload: unknown): ContactDetail {
  const p = one<Record<string, unknown>>(payload);
  if (p && typeof p === "object" && "contact" in p && p.contact && typeof p.contact === "object") {
    return {
      ...(p.contact as Contact),
      events: (p.events as ContactDetail["events"]) ?? [],
      messages: (p.messages as ContactDetail["messages"]) ?? [],
    };
  }
  const c = p as unknown as ContactDetail;
  return { ...c, events: c.events ?? [], messages: c.messages ?? [] };
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T = void>(path: string) => request<T>("DELETE", path);
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);

export interface ContactQuery {
  search?: string;
  tag?: string;
  status?: string;
  segment_id?: string;
  page?: number;
  limit?: number;
}

export const api = {
  auth: {
    register: (input: { name: string; email: string; password: string }) => post<AuthResponse>("/auth/register", input),
    login: (input: { email: string; password: string }) => post<AuthResponse>("/auth/login", input),
  },
  me: () => get<MeResponse>("/me"),

  apiKeys: {
    list: () => get<{ data: ApiKey[] } | ApiKey[]>("/api-keys").then((r) => (Array.isArray(r) ? r : r.data)),
    create: (label: string) => post<unknown>("/api-keys", { label }).then((r) => one<ApiKey>(r)),
    revoke: (id: string) => del(`/api-keys/${id}`),
  },

  contacts: {
    list: (q: ContactQuery = {}) => get<Paginated<Contact>>("/contacts", { ...q }),
    get: (id: string) => get<unknown>(`/contacts/${id}`).then(toContactDetail),
    create: (input: ContactInput) => post<unknown>("/contacts", input).then((r) => one<Contact>(r)),
    update: (id: string, input: Partial<ContactInput>) => patch<unknown>(`/contacts/${id}`, input).then((r) => one<Contact>(r)),
    remove: (id: string) => del(`/contacts/${id}`),
    tags: (id: string, change: { add?: string[]; remove?: string[] }) =>
      post<unknown>(`/contacts/${id}/tags`, change).then((r) => one<Contact>(r)),
    importContacts: (payload: { contacts: ContactInput[] } | { csv: string }) => post<ImportResult>("/contacts/import", payload),
  },
  tags: () => get<{ data: TagCount[] }>("/tags").then((r) => r.data),

  segments: {
    list: () => get<{ data: Segment[] } | Paginated<Segment>>("/segments").then((r) => r.data),
    get: (id: string) => get<unknown>(`/segments/${id}`).then((r) => one<Segment>(r)),
    create: (input: { name: string; rules: SegmentRules }) => post<unknown>("/segments", input).then((r) => one<Segment>(r)),
    update: (id: string, input: Partial<{ name: string; rules: SegmentRules }>) =>
      patch<unknown>(`/segments/${id}`, input).then((r) => one<Segment>(r)),
    remove: (id: string) => del(`/segments/${id}`),
    preview: (rules: SegmentRules) => post<SegmentPreview>("/segments/preview", { rules }),
  },

  campaigns: {
    list: (status?: CampaignStatus) =>
      get<{ data: Campaign[] } | Paginated<Campaign>>("/campaigns", { status }).then((r) => r.data),
    get: (id: string) => get<unknown>(`/campaigns/${id}`).then((r) => one<Campaign>(r)),
    create: (input: CampaignInput) => post<unknown>("/campaigns", input).then((r) => one<Campaign>(r)),
    update: (id: string, input: Partial<CampaignInput>) => patch<unknown>(`/campaigns/${id}`, input).then((r) => one<Campaign>(r)),
    remove: (id: string) => del(`/campaigns/${id}`),
    sendTest: (id: string, to: string) => post<unknown>(`/campaigns/${id}/test`, { to }),
    send: (id: string) => post<unknown>(`/campaigns/${id}/send`),
    schedule: (id: string, scheduled_at: string) => post<unknown>(`/campaigns/${id}/schedule`, { scheduled_at }),
    unschedule: (id: string) => post<unknown>(`/campaigns/${id}/unschedule`),
    stats: (id: string) => get<CampaignStats>(`/campaigns/${id}/stats`),
  },

  automations: {
    list: () => get<{ data: Automation[] } | Paginated<Automation>>("/automations").then((r) => r.data),
    get: (id: string) => get<unknown>(`/automations/${id}`).then((r) => one<Automation>(r)),
    create: (input: AutomationInput) => post<unknown>("/automations", input).then((r) => one<Automation>(r)),
    update: (id: string, input: Partial<AutomationInput>) => patch<unknown>(`/automations/${id}`, input).then((r) => one<Automation>(r)),
    remove: (id: string) => del(`/automations/${id}`),
    activate: (id: string) => post<unknown>(`/automations/${id}/activate`),
    pause: (id: string) => post<unknown>(`/automations/${id}/pause`),
  },

  stats: {
    overview: (days = 30) => get<StatsOverview>("/stats/overview", { days }),
  },

  ai: {
    generateEmail: (input: GenerateEmailInput) => post<GeneratedEmail>("/templates/generate-email", input),
  },

  assets: {
    list: () => get<{ data: Asset[] }>("/assets").then((r) => r.data),
    upload: (input: { filename: string; data: string; width?: number; height?: number }) => post<Asset>("/assets", input),
    remove: (id: string) => del(`/assets/${id}`),
  },

  brandKit: {
    get: () => get<{ brand_kit: string | null }>("/brand-kit").then((r) => r.brand_kit),
    save: (brandKit: string | null) => put<{ brand_kit: string | null }>("/brand-kit", { brand_kit: brandKit }),
  },

  emailTemplates: {
    list: () => get<{ data: SavedTemplate[] }>("/email-templates").then((r) => r.data),
    create: (input: { name: string; design: string }) => post<SavedTemplate>("/email-templates", input),
    remove: (id: string) => del(`/email-templates/${id}`),
  },

  outbox: (limit = 20) =>
    get<{ data: Message[] } | Message[]>("/outbox", { limit }).then((r) => (Array.isArray(r) ? r : r.data)),

  integrations: {
    list: () => get<{ data: Integration[] }>("/integrations").then((r) => r.data),
    shopify: {
      connect: (input: { shop_domain: string; access_token: string }) => post<unknown>("/integrations/shopify/connect", input),
      sync: () => post<ShopifySyncResult>("/integrations/shopify/sync"),
      disconnect: () => del("/integrations/shopify"),
      simulate: (input: { type: "order" | "cart_abandoned"; email: string }) =>
        post<unknown>("/integrations/shopify/simulate", input),
    },
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Une erreur inattendue est survenue.";
}

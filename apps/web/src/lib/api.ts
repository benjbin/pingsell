// Typed client for the Pingsell REST API (see SPEC.md, base /api/v1).
import { LANG, t } from "./i18n";
import type {
  InboundSettings,
  Analytics,
  ApiKey,
  SendingDomainResponse,
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
  Account,
  Invitation,
  InvitationInfo,
  TeamResponse,
  User,
  Message,
  Paginated,
  SavedTemplate,
  Segment,
  SegmentPreview,
  SegmentRules,
  ShopifySyncResult,
  StatsOverview,
  TagCount,
  PushCampaign,
  PushCampaignInput,
  PushConfig,
  PushConfigInput,
  PushPrompt,
  PushContent,
  PushDevice,
  PushAudience,
  PushChannel,
} from "./types";

// Set: that API origin. Otherwise local dev talks to the API on :4000, and a production build
// uses its own origin (the app's nginx proxies /api to the API container).
const envApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, "");
export const API_URL: string = envApiUrl || (import.meta.env.DEV ? "http://localhost:4000" : window.location.origin);
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
  const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": LANG };
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
    throw new ApiError(0, t(`Impossible de joindre l'API (${API_URL}). Vérifiez qu'elle est démarrée.`, `Can't reach the API (${API_URL}). Make sure it's running.`));
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
        : t(`Erreur ${res.status}`, `Error ${res.status}`);
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
    forgotPassword: (email: string) => post<void>("/auth/forgot-password", { email }),
    checkResetToken: (token: string) => get<{ email: string }>(`/auth/reset-password/${encodeURIComponent(token)}`),
    resetPassword: (token: string, password: string) => post<AuthResponse>("/auth/reset-password", { token, password }),
  },
  me: () => get<MeResponse>("/me"),

  profile: {
    update: (input: { name?: string; email?: string }) => patch<{ user: User }>("/me/profile", input).then((r) => r.user),
    changePassword: (input: { current: string; next: string }) => post<void>("/me/password", input),
  },
  account: {
    rename: (name: string) => patch<{ account: Account }>("/account", { name }).then((r) => r.account),
    /** Owner only, permanent: deletes the account and all its data. */
    remove: (password: string) => post<void>("/account/delete", { password }),
  },
  team: {
    get: () => get<TeamResponse>("/team"),
    invite: (input: { email: string; role: "admin" | "editor" }) => post<{ invitation: Invitation; email_sent: boolean }>("/team/invitations", input),
    cancelInvite: (id: string) => del(`/team/invitations/${id}`),
    setRole: (id: string, role: "admin" | "editor") => patch<{ member: User }>(`/team/members/${id}`, { role }).then((r) => r.member),
    remove: (id: string) => del(`/team/members/${id}`),
  },
  invitations: {
    get: (token: string) => get<InvitationInfo>(`/invitations/${encodeURIComponent(token)}`),
    accept: (token: string, input: { name: string; password: string }) => post<AuthResponse>(`/invitations/${encodeURIComponent(token)}/accept`, input),
  },

  sendingDomain: {
    get: () => get<SendingDomainResponse>("/sending-domain"),
    create: (domain: string) => post<SendingDomainResponse>("/sending-domain", { domain }),
    verify: () => post<SendingDomainResponse>("/sending-domain/verify"),
    setFrom: (from_email: string | null) => put<SendingDomainResponse>("/sending-domain/from", { from_email }),
    remove: () => del("/sending-domain"),
  },

  inbound: {
    get: () => get<InboundSettings>("/inbound"),
    rotate: (kind: "webhook" | "form") => post<InboundSettings>(`/inbound/${kind}/rotate`),
    setOrigins: (allowed_origins: string[]) => patch<InboundSettings>("/inbound/form", { allowed_origins }),
    setTracking: (input: { enabled?: boolean; require_consent?: boolean }) => patch<InboundSettings>("/inbound/tracking", input),
  },

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
    eventNames: () => get<{ data: Array<{ name: string; count: number; last_at: string }> }>("/automations/event-names").then((r) => r.data),
  },

  push: {
    config: () => get<PushConfig>("/push/config"),
    saveConfig: (input: PushConfigInput) => put<PushConfig>("/push/config", input),
    rotateAppKey: () => post<PushConfig>("/push/config/rotate-app-key"),
    setIdentityRequired: (required: boolean) => put<PushConfig>("/push/config/identity", { required }),
    rotateIdentitySecret: () => post<PushConfig>("/push/config/rotate-identity-secret"),
    savePrompt: (prompt: PushPrompt) => put<PushConfig>("/push/config/prompt", prompt),
    devices: (page = 1, limit = 50) => get<Paginated<PushDevice>>("/push/devices", { page, limit }),
    removeDevice: (id: string) => del(`/push/devices/${id}`),
    test: (deviceId: string, content: PushContent, channels: PushChannel[]) =>
      post<{ ok: boolean }>("/push/test", { device_id: deviceId, ...content, channels }),
    audienceCount: (audience: PushAudience) => post<{ devices: number }>("/push/audience-count", { audience }),
    campaigns: () => get<Paginated<PushCampaign>>("/push/campaigns", { limit: 100 }).then((r) => r.data),
    campaign: (id: string) => get<PushCampaign>(`/push/campaigns/${id}`),
    createCampaign: (input: PushCampaignInput) => post<PushCampaign>("/push/campaigns", input),
    updateCampaign: (id: string, input: Partial<PushCampaignInput>) => patch<PushCampaign>(`/push/campaigns/${id}`, input),
    removeCampaign: (id: string) => del(`/push/campaigns/${id}`),
    sendCampaign: (id: string) => post<PushCampaign>(`/push/campaigns/${id}/send`),
  },

  stats: {
    overview: (days = 30) => get<StatsOverview>("/stats/overview", { days }),
    analytics: (q: { days?: number; from?: string; to?: string }) =>
      get<Analytics>("/stats/analytics", { ...q, tz: new Date().getTimezoneOffset() }),
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
      status: () =>
        get<{ integration: Integration | null; oauth_available: boolean; sync_running: boolean }>("/integrations/shopify"),
      /** OAuth install page of the shop ("1 clic"), when the Shopify app keys are configured on the server. */
      installUrl: (shop: string) => get<{ url: string }>("/integrations/shopify/install", { shop, format: "json" }).then((r) => r.url),
      connect: (input: { shop_domain: string; access_token: string }) => post<unknown>("/integrations/shopify/connect", input),
      sync: () => post<ShopifySyncResult>("/integrations/shopify/sync"),
      disconnect: () => del("/integrations/shopify"),
      simulate: (input: { type: "order" | "order_fulfilled" | "cart_abandoned"; email: string }) =>
        post<unknown>("/integrations/shopify/simulate", input),
    },
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return t("Une erreur inattendue est survenue.", "An unexpected error occurred.");
}

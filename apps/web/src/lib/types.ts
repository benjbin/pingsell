// Types mirroring the SPEC.md data model and REST contract.

export interface Account {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Usage {
  emails_sent_month: number;
  contacts: number;
}

export type Role = "owner" | "admin" | "editor";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
  last_seen_at: string | null;
}

export interface MeResponse {
  account: Account;
  /** null when authenticated with an API key. */
  user: User | null;
  usage: Usage;
}

export interface AuthResponse {
  token: string;
  account: Account;
  user: User;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  expired: boolean;
  /** Shareable link (null for editors). */
  link: string | null;
}

export interface TeamResponse {
  members: User[];
  invitations: Invitation[];
  can_manage: boolean;
}

export interface InvitationInfo {
  email: string;
  role: Exclude<Role, "owner">;
  account_name: string;
  invited_by: string | null;
  email_taken: boolean;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DnsRecord {
  type: "TXT";
  host: string;
  value: string;
  required: boolean;
  ok: boolean;
}

export interface SendingDomain {
  id: string;
  domain: string;
  status: "pending" | "verified";
  from_email: string | null;
  last_error: "dkim_missing" | "dkim_mismatch" | "dns_error" | null;
  last_checked_at: string | null;
  verified_at: string | null;
  created_at: string;
  records: DnsRecord[];
  /** DNS host guessed from the domain's name servers (to open the right guide). */
  dns_provider?: string | null;
}

export interface SendingDomainResponse {
  domain: SendingDomain | null;
  default_from_email?: string;
  from_email: string;
}

export interface ApiKey {
  id: string;
  label: string;
  /** Full key — only returned once at creation. List endpoints may return a masked value. */
  key?: string;
  /** Masked preview, e.g. "msv_3fkC…4D21". */
  key_preview?: string;
  created_at: string;
  last_used_at: string | null;
}

export type ContactStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";
export type ContactSource = "manual" | "import" | "shopify" | "api";

export interface Contact {
  id: string;
  account_id?: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  status: ContactStatus;
  source: ContactSource;
  external_id: string | null;
  total_spent: number;
  orders_count: number;
  last_order_at: string | null;
  /** Last page seen on the site (site tracking). */
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  status?: ContactStatus;
}

export type EventType =
  | "open"
  | "click"
  | "unsubscribe"
  | "bounce"
  | "order"
  | "cart_abandoned"
  | "tag_added"
  | "contact_created"
  | "event";

export interface ContactEvent {
  id: string;
  contact_id: string;
  type: EventType;
  data: Record<string, unknown> | null;
  created_at: string;
}

export type MessageStatus = "queued" | "sent" | "failed" | "bounced";

export interface Message {
  id: string;
  campaign_id: string | null;
  automation_id: string | null;
  contact_id: string;
  to_email: string;
  subject: string;
  html?: string;
  status: MessageStatus;
  provider_id: string | null;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
}

export interface SiteProduct {
  name: string;
  url: string;
  image?: string;
  price?: number;
  currency?: string;
  sku?: string;
}

export interface ContactDetail extends Contact {
  events: ContactEvent[];
  messages: Message[];
  /** Pages and products seen on the merchant's site. */
  site?: { total: number; visits: Array<{ url: string; path: string; title: string | null; product: SiteProduct | null; created_at: string }> };
}

export interface ImportErrorDetail {
  row?: number;
  email?: string;
  error: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  /** Number of rejected rows (some servers return the detailed list here instead). */
  errors: number | Array<string | ImportErrorDetail>;
  error_details?: ImportErrorDetail[];
}

export interface TagCount {
  tag: string;
  count: number;
}

// --- Segments -------------------------------------------------------------

export type SegmentField =
  | "email"
  | "first_name"
  | "last_name"
  | "status"
  | "source"
  | "tags"
  | "total_spent"
  | "orders_count"
  | "last_order_at"
  | "created_at"
  | "last_seen_at"
  | "visited_page";

export type SegmentOp =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "has_tag"
  | "not_has_tag"
  | "within_days"
  | "older_than_days";

export interface SegmentCondition {
  field: SegmentField;
  op: SegmentOp;
  value: string | number;
}

export interface SegmentRules {
  match: "all" | "any";
  conditions: SegmentCondition[];
}

export interface Segment {
  id: string;
  name: string;
  rules: SegmentRules;
  count?: number;
  created_at: string;
  updated_at: string;
}

export interface SegmentPreview {
  count: number;
  sample: Contact[];
}

// --- Campaigns ------------------------------------------------------------

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

export interface CampaignStatsSummary {
  recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  from_name: string | null;
  from_email: string | null;
  html: string | null;
  design?: string | null;
  segment_id: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  stats?: CampaignStatsSummary;
}

export interface CampaignInput {
  name: string;
  subject: string;
  preheader?: string;
  from_name?: string;
  from_email?: string;
  html?: string;
  design?: string | null;
  segment_id?: string | null;
}

export interface CampaignStats {
  recipients: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  open_rate: number;
  click_rate: number;
  timeline: Array<{ hour: string; opens: number; clicks: number }>;
}

// --- Automations ----------------------------------------------------------

export type AutomationTrigger =
  | "contact_created"
  | "tag_added"
  | "order_created"
  | "cart_abandoned"
  | "order_fulfilled"
  | "app_signed_in"
  | "push_subscribed"
  | "event"
  | "email_clicked"
  | "date_anniversary"
  | "inactive"
  | "segment_entered"
  | "page_visited"
  | "product_viewed"
  | "site_action";

/** What the Pingsell script spots on its own on the merchant's sites. */
export type SiteActionKind = "signup" | "login" | "newsletter" | "contact" | "form";

/** trigger_config of « Une action sur votre site » (host empty = every site). */
export interface SiteActionConfig {
  host?: string;
  action: SiteActionKind;
  /** A precise form (form_key); empty = any form of that kind. */
  form?: string;
  /** Readable label of that form, kept for the automation list (UI only). */
  form_label?: string;
}

export type ExitCondition = "push_opened" | "email_opened" | "email_clicked" | "ordered";

export type BranchCondition =
  | { type: "email_opened" }
  | { type: "email_clicked" }
  | { type: "push_opened" }
  | { type: "ordered" }
  | { type: "has_tag"; tag: string }
  | { type: "in_segment"; segment_id: string }
  | { type: "has_app" }
  | { type: "total_spent"; min: number }
  | { type: "orders_count"; min: number }
  | { type: "event_field"; field: string; value: string };

export type AutomationStep =
  | { type: "wait"; hours: number }
  | { type: "wait_until"; hours: number; direction: "before" | "after" }
  | { type: "email"; subject: string; html: string }
  | { type: "push"; title: string; body: string; url?: string | null; image_url?: string | null; in_app?: boolean }
  | { type: "exit_if"; condition: ExitCondition }
  | { type: "tag"; action: "add" | "remove"; tag: string }
  | { type: "webhook"; url: string }
  | { type: "notify"; to?: string; subject: string; message?: string }
  | { type: "send_window"; days: number[]; start_hour: number; end_hour: number }
  | { type: "branch"; condition: BranchCondition; yes: AutomationStep[]; no: AutomationStep[] }
  | { type: "split"; percent: number; a: AutomationStep[]; b: AutomationStep[] };

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  trigger_config: Record<string, unknown> | null;
  steps: AutomationStep[];
  status: "active" | "paused";
  runs_active?: number;
  emails_sent?: number;
  push_sent?: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationInput {
  name: string;
  trigger: AutomationTrigger;
  trigger_config?: Record<string, unknown>;
  steps: AutomationStep[];
  status?: "active" | "paused";
}

// --- Stats ----------------------------------------------------------------

export interface StatsOverview {
  contacts_total: number;
  contacts_subscribed: number;
  contacts_new: number;
  campaigns_sent: number;
  emails_sent: number;
  open_rate: number;
  click_rate: number;
  unsubscribe_rate: number;
  revenue_shopify: number;
  revenue_attributed: number;
  orders_attributed: number;
  timeseries: Array<{ date: string; sent: number; opened: number; clicked: number }>;
}

// --- AI -------------------------------------------------------------------

export interface GenerateEmailInput {
  prompt: string;
  tone?: string;
  brand?: string;
}

export interface GeneratedEmail {
  subject: string;
  preheader: string;
  html: string;
  /** Which generator produced it ("template"), when provided. */
  source?: string;
}

// --- Integrations ---------------------------------------------------------

export interface Integration {
  id: string;
  provider: "shopify";
  shop_domain: string | null;
  status: "connected" | "error";
  connected: boolean;
  config?: Record<string, unknown> | null;
  last_sync_at: string | null;
  created_at: string;
}

export interface ShopifySyncResult {
  customers: number;
  orders: number;
}

export interface Asset {
  id: string;
  filename: string;
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface SavedTemplate {
  id: string;
  name: string;
  design: string;
  created_at: string;
  updated_at: string;
}

// --- Push notifications ---------------------------------------------------

export type PushPlatform = "ios" | "android";
export type PushProvider = "fcm" | "apns" | "expo";

export interface PushConfig {
  app_key: string;
  mode: "log" | "live";
  fcm: { configured: boolean; project_id?: string; client_email?: string };
  apns: { configured: boolean; key_id?: string; team_id?: string; bundle_id?: string; production?: boolean };
  expo: { configured: boolean; has_access_token?: boolean };
  /** null for editors: only owners and admins see the secret. */
  identity: { secret: string | null; required: boolean };
  prompt: PushPrompt;
  prompt_stats: PushPromptStats;
  app_users: number;
  devices: {
    total: number;
    ios: number;
    android: number;
    linked: number;
    by_provider: Record<PushProvider, number>;
  };
}

/** Pre-permission screen shown by the SDK before the system dialog. */
export interface PushPrompt {
  enabled: boolean;
  title: string;
  body: string;
  accept_label: string;
  decline_label: string;
  min_launches: number;
  cooldown_days: number;
  image_url?: string | null;
}

export interface PushPromptStats {
  days: number;
  shown: number;
  accepted: number;
  declined: number;
  granted: number;
  denied: number;
  accept_rate: number;
  opt_in_rate: number;
}

export interface PushConfigInput {
  /** Firebase service-account JSON as a string, or null to remove. */
  fcm?: string | null;
  apns?: { key_p8: string; key_id: string; team_id: string; bundle_id: string; production: boolean } | null;
  expo?: { access_token?: string } | null;
}

export interface PushDevice {
  id: string;
  platform: PushPlatform;
  provider: PushProvider;
  token_preview: string;
  contact_id: string | null;
  contact_email: string | null;
  app_version: string | null;
  active: boolean;
  created_at: string;
  last_seen_at: string;
}

export type PushAudience = { type: "all" } | { type: "segment"; segment_id: string } | { type: "tag"; tag: string };

export interface PushContent {
  title: string;
  body: string;
  image_url?: string | null;
  url?: string | null;
}

/** "push" = system notification (lock screen), "in_app" = notification centre inside the app. */
export type PushChannel = "push" | "in_app";

export interface PushCampaignStats {
  in_app: { total: number; read: number; read_rate: number };
  resend: { total: number; sent: number; opened: number; open_rate: number };
  /** Smart send: notifications waiting for each customer's best hour. */
  scheduled: number;
  total: number;
  sent: number;
  failed: number;
  queued: number;
  opened: number;
  open_rate: number;
}

export interface PushCampaign extends PushContent {
  id: string;
  name: string;
  audience: PushAudience;
  channels: PushChannel[];
  send_mode: PushSendMode;
  resend: { after_hours: number | null; title: string | null; body: string | null; queued_at: string | null };
  status: "draft" | "sending" | "sent";
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  stats: PushCampaignStats;
}

export type PushSendMode = "now" | "smart";

export type PushCampaignInput = PushContent & {
  name: string;
  audience: PushAudience;
  channels: PushChannel[];
  send_mode: PushSendMode;
  resend_after_hours: number | null;
  resend_title?: string | null;
  resend_body?: string | null;
};

/* ---- Statistiques (GET /stats/analytics) ---- */

export interface AnalyticsKpis {
  revenue_attributed: number;
  orders_attributed: number;
  revenue_total: number;
  orders_total: number;
  emails_sent: number;
  emails_delivered: number;
  emails_opened: number;
  emails_clicked: number;
  open_rate: number;
  click_rate: number;
  click_to_open_rate: number;
  bounce_rate: number;
  unsubscribes: number;
  unsubscribe_rate: number;
  push_sent: number;
  push_opened: number;
  push_open_rate: number;
  new_contacts: number;
  net_growth: number;
}

export interface AnalyticsDay {
  date: string;
  emails_sent: number;
  opens: number;
  clicks: number;
  push_sent: number;
  push_opens: number;
  orders: number;
  revenue: number;
  revenue_attributed: number;
  new_contacts: number;
  unsubscribes: number;
}

export interface Analytics {
  range: { from: string; to: string; days: number; previous: { from: string; to: string } };
  attribution_days: number;
  kpis: AnalyticsKpis;
  previous: AnalyticsKpis;
  daily: AnalyticsDay[];
  daily_previous: AnalyticsDay[];
  revenue_split: { campaigns: number; automations: number; push: number; unattributed: number };
  /** Email opens, [weekday 0 = lundi][hour 0-23], local time. */
  heatmap: number[][];
  campaigns: Array<{ id: string; name: string; subject: string; sent_at: string; sent: number; open_rate: number; click_rate: number; unsubscribe_rate: number; revenue: number; orders: number }>;
  automations: Array<{ id: string; name: string; trigger: string; status: string; entered: number; emails_sent: number; open_rate: number; click_rate: number; push_sent: number; push_open_rate: number; revenue: number; orders: number }>;
  push_campaigns: Array<{ id: string; name: string; title: string; sent_at: string | null; sent: number; open_rate: number; revenue: number; orders: number }>;
  top_links: Array<{ url: string; clicks: number; contacts: number }>;
  sources: Array<{ source: string; contacts: number }>;
}

/** No-code sites: universal webhook URL + paste-in form key (Intégrations). */
export interface InboundLastCall {
  uses: number;
  last_used_at: string | null;
  last_source: string | null;
  last_result: { received: number; ignored?: boolean; reason?: string; results?: Array<{ event: string; ok: boolean; error?: string; skipped?: boolean; duplicate?: boolean }> } | null;
}
export interface TrackingSettings {
  enabled: boolean;
  require_consent: boolean;
  /** « Repérer les actions automatiquement » (comptes, connexions, newsletter, formulaires). Absent = on. */
  capture_actions?: boolean;
  pageviews: number;
  last_seen_at: string | null;
  last_url: string | null;
  sites: string[];
  visitors: number;
  identified: number;
}
/** A site recognised by its domain (GET /inbound/sites). */
export interface WebSiteAction {
  kind: SiteActionKind;
  form_key: string;
  label: string | null;
  path: string | null;
  count: number;
  last_at: string;
}
export interface WebSite {
  host: string;
  name: string | null;
  pageviews: number;
  first_seen: string;
  last_seen: string;
  actions: WebSiteAction[];
  /** Most viewed pages over 90 days. */
  pages: Array<{ path: string; count: number }>;
}
export interface InboundSettings {
  webhook: InboundLastCall & { url: string };
  tracking: TrackingSettings;
  form: InboundLastCall & { key: string; script_url: string; action_url: string; allowed_origins: string[] };
}

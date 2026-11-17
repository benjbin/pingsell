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

export interface MeResponse {
  account: Account;
  usage: Usage;
}

export interface AuthResponse {
  token: string;
  account: Account;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
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
  | "contact_created";

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

export interface ContactDetail extends Contact {
  events: ContactEvent[];
  messages: Message[];
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
  | "created_at";

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

export type AutomationTrigger = "contact_created" | "tag_added" | "order_created" | "cart_abandoned";

export type AutomationStep =
  | { type: "wait"; hours: number }
  | { type: "email"; subject: string; html: string };

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  trigger_config: Record<string, unknown> | null;
  steps: AutomationStep[];
  status: "active" | "paused";
  runs_active?: number;
  emails_sent?: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationInput {
  name: string;
  trigger: AutomationTrigger;
  trigger_config?: Record<string, unknown>;
  steps: AutomationStep[];
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

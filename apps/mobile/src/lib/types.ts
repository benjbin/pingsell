/**
 * Types mirroring the Pingsell REST contract (SPEC.md, base /api/v1).
 * Dates are ISO strings, rates are 0..1.
 */

export interface Account {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  account: Account;
}

export interface Usage {
  emails_sent_month: number;
  contacts: number;
}

export interface MeResponse {
  account: Account;
  usage: Usage;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type ContactStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';
export type ContactSource = 'manual' | 'import' | 'shopify' | 'api';

export interface Contact {
  id: string;
  account_id: string;
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

export type EventType =
  | 'open'
  | 'click'
  | 'unsubscribe'
  | 'bounce'
  | 'order'
  | 'cart_abandoned'
  | 'tag_added'
  | 'contact_created';

export interface ContactEvent {
  id: string;
  account_id: string;
  contact_id: string;
  type: EventType;
  data: Record<string, unknown> | null;
  created_at: string;
}

export type MessageStatus = 'queued' | 'sent' | 'failed' | 'bounced';

export interface Message {
  id: string;
  account_id: string;
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

export interface ContactListParams {
  search?: string;
  tag?: string;
  status?: ContactStatus;
  segment_id?: string;
  page?: number;
  limit?: number;
}

export interface Segment {
  id: string;
  account_id: string;
  name: string;
  rules: unknown;
  count?: number;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

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
  account_id: string;
  name: string;
  subject: string;
  preheader: string | null;
  from_name: string | null;
  from_email: string | null;
  html: string | null;
  segment_id: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  stats?: CampaignStatsSummary;
}

export interface CampaignTimelinePoint {
  hour: string;
  opens: number;
  clicks: number;
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
  timeline: CampaignTimelinePoint[];
}

export interface OverviewTimeseriesPoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
}

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
  timeseries: OverviewTimeseriesPoint[];
}

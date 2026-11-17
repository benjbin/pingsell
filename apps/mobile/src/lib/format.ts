import { LOCALE, t } from './i18n';
import type { CampaignStatus, ContactStatus, EventType, MessageStatus } from './types';

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE).format(value ?? 0);
}

/** `rate` is 0..1 per SPEC. */
export function formatPercent(rate: number | null | undefined, digits = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rate ?? 0);
}

export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
    value ?? 0,
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatShortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' });
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const campaignStatusLabel: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: t('Brouillon', 'Draft'), tone: 'neutral' },
  scheduled: { label: t('Programmée', 'Scheduled'), tone: 'info' },
  sending: { label: t("En cours d'envoi", 'Sending'), tone: 'warning' },
  sent: { label: t('Envoyée', 'Sent'), tone: 'success' },
  failed: { label: t('Échec', 'Failed'), tone: 'danger' },
};

export const contactStatusLabel: Record<ContactStatus, { label: string; tone: Tone }> = {
  subscribed: { label: t('Abonné', 'Subscribed'), tone: 'success' },
  unsubscribed: { label: t('Désabonné', 'Unsubscribed'), tone: 'neutral' },
  bounced: { label: t('Rebond', 'Bounced'), tone: 'warning' },
  complained: { label: t('Plainte', 'Complaint'), tone: 'danger' },
};

export const messageStatusLabel: Record<MessageStatus, string> = {
  queued: t('En file', 'Queued'),
  sent: t('Envoyé', 'Sent'),
  failed: t('Échec', 'Failed'),
  bounced: t('Rebond', 'Bounced'),
};

export const eventLabel: Record<EventType, { label: string; icon: string }> = {
  open: { label: t('Ouverture', 'Open'), icon: 'mail-open-outline' },
  click: { label: t('Clic', 'Click'), icon: 'link-outline' },
  unsubscribe: { label: t('Désabonnement', 'Unsubscribe'), icon: 'remove-circle-outline' },
  bounce: { label: t('Rebond', 'Bounce'), icon: 'alert-circle-outline' },
  order: { label: t('Commande', 'Order'), icon: 'bag-check-outline' },
  cart_abandoned: { label: t('Panier abandonné', 'Abandoned cart'), icon: 'cart-outline' },
  tag_added: { label: t('Tag ajouté', 'Tag added'), icon: 'pricetag-outline' },
  contact_created: { label: t('Contact créé', 'Contact created'), icon: 'person-add-outline' },
};

export const sourceLabel: Record<string, string> = {
  manual: t('Manuel', 'Manual'),
  import: 'Import',
  shopify: 'Shopify',
  api: 'API',
};

export function contactDisplayName(c: { first_name: string | null; last_name: string | null; email: string }): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return name || c.email;
}

export function initials(c: { first_name: string | null; last_name: string | null; email: string }): string {
  const parts = [c.first_name, c.last_name].filter((p): p is string => Boolean(p));
  if (parts.length) return parts.map((p) => p[0]!.toUpperCase()).join('').slice(0, 2);
  return c.email.slice(0, 2).toUpperCase();
}

import type {
  AutomationTrigger,
  CampaignStatus,
  ContactSource,
  ContactStatus,
  EventType,
  SegmentField,
  SegmentOp,
} from "./types";

export type Tone = "brand" | "green" | "amber" | "red" | "slate" | "blue";

export const CONTACT_STATUS: Record<ContactStatus, { label: string; tone: Tone }> = {
  subscribed: { label: "Abonné", tone: "green" },
  unsubscribed: { label: "Désabonné", tone: "slate" },
  bounced: { label: "Rejeté", tone: "amber" },
  complained: { label: "Plainte", tone: "red" },
};

export const CONTACT_SOURCE: Record<ContactSource, string> = {
  manual: "Manuel",
  import: "Import",
  shopify: "Shopify",
  api: "API",
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "slate" },
  scheduled: { label: "Programmée", tone: "blue" },
  sending: { label: "En cours d'envoi", tone: "amber" },
  sent: { label: "Envoyée", tone: "green" },
  failed: { label: "Échec", tone: "red" },
};

export const TRIGGERS: Record<AutomationTrigger, { label: string; description: string }> = {
  contact_created: { label: "Nouveau contact", description: "Quand un contact est créé (formulaire, import, API, Shopify)." },
  tag_added: { label: "Tag ajouté", description: "Quand un tag précis est ajouté à un contact." },
  order_created: { label: "Commande passée", description: "Quand un client passe commande sur Shopify." },
  cart_abandoned: { label: "Panier abandonné", description: "Quand un panier Shopify reste sans commande pendant 1 h." },
};

export const EVENT_LABELS: Record<EventType, string> = {
  open: "A ouvert un email",
  click: "A cliqué sur un lien",
  unsubscribe: "S'est désabonné",
  bounce: "Email rejeté",
  order: "A passé commande",
  cart_abandoned: "A abandonné son panier",
  tag_added: "Tag ajouté",
  contact_created: "Contact créé",
};

export type FieldKind = "text" | "number" | "date" | "tags" | "enum";

export const SEGMENT_FIELDS: Record<SegmentField, { label: string; kind: FieldKind; options?: Array<{ value: string; label: string }> }> = {
  email: { label: "Email", kind: "text" },
  first_name: { label: "Prénom", kind: "text" },
  last_name: { label: "Nom", kind: "text" },
  status: {
    label: "Statut",
    kind: "enum",
    options: (Object.keys(CONTACT_STATUS) as ContactStatus[]).map((s) => ({ value: s, label: CONTACT_STATUS[s].label })),
  },
  source: {
    label: "Source",
    kind: "enum",
    options: (Object.keys(CONTACT_SOURCE) as ContactSource[]).map((s) => ({ value: s, label: CONTACT_SOURCE[s] })),
  },
  tags: { label: "Tags", kind: "tags" },
  total_spent: { label: "Total dépensé (€)", kind: "number" },
  orders_count: { label: "Nombre de commandes", kind: "number" },
  last_order_at: { label: "Dernière commande", kind: "date" },
  created_at: { label: "Date d'inscription", kind: "date" },
};

export const OPS_BY_KIND: Record<FieldKind, Array<{ op: SegmentOp; label: string }>> = {
  text: [
    { op: "eq", label: "est égal à" },
    { op: "neq", label: "est différent de" },
    { op: "contains", label: "contient" },
  ],
  enum: [
    { op: "eq", label: "est" },
    { op: "neq", label: "n'est pas" },
  ],
  number: [
    { op: "gt", label: "est supérieur à" },
    { op: "lt", label: "est inférieur à" },
    { op: "eq", label: "est égal à" },
    { op: "neq", label: "est différent de" },
  ],
  date: [
    { op: "within_days", label: "dans les derniers (jours)" },
    { op: "older_than_days", label: "il y a plus de (jours)" },
  ],
  tags: [
    { op: "has_tag", label: "possède le tag" },
    { op: "not_has_tag", label: "ne possède pas le tag" },
  ],
};

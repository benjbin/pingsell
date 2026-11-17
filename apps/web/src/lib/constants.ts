import type {
  AutomationTrigger,
  CampaignStatus,
  ContactSource,
  ContactStatus,
  EventType,
  SegmentField,
  SegmentOp,
  ExitCondition,
} from "./types";
import { t } from "./i18n";

export type Tone = "brand" | "green" | "amber" | "red" | "slate" | "blue";

export const CONTACT_STATUS: Record<ContactStatus, { label: string; tone: Tone }> = {
  subscribed: { label: t("Abonné", "Subscribed"), tone: "green" },
  unsubscribed: { label: t("Désabonné", "Unsubscribed"), tone: "slate" },
  bounced: { label: t("Rejeté", "Bounced"), tone: "amber" },
  complained: { label: t("Plainte", "Complaint"), tone: "red" },
};

export const CONTACT_SOURCE: Record<ContactSource, string> = {
  manual: t("Manuel", "Manual"),
  import: "Import",
  shopify: "Shopify",
  api: "API",
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: t("Brouillon", "Draft"), tone: "slate" },
  scheduled: { label: t("Programmée", "Scheduled"), tone: "blue" },
  sending: { label: t("En cours d'envoi", "Sending"), tone: "amber" },
  sent: { label: t("Envoyée", "Sent"), tone: "green" },
  failed: { label: t("Échec", "Failed"), tone: "red" },
};

export const TRIGGERS: Record<AutomationTrigger, { label: string; description: string }> = {
  contact_created: { label: t("Nouveau contact", "New contact"), description: t("Quand un contact est créé (formulaire, import, API, Shopify).", "When a contact is created (form, import, API, Shopify).") },
  tag_added: { label: t("Tag ajouté", "Tag added"), description: t("Quand un tag précis est ajouté à un contact.", "When a specific tag is added to a contact.") },
  order_created: { label: t("Commande passée", "Order placed"), description: t("Quand un client passe commande (Shopify, ou votre site, caisse ou back-office via l'API).", "When a customer places an order (Shopify, or your site, POS or back office via the API).") },
  cart_abandoned: { label: t("Panier abandonné", "Abandoned cart"), description: t("Quand un panier Shopify reste sans commande pendant 1 h.", "When a Shopify cart goes 1 hour without an order.") },
  order_fulfilled: {
    label: t("Commande expédiée", "Order fulfilled"),
    description: t("Quand la commande est expédiée (Shopify ou API). Transactionnel : atteint aussi les désabonnés marketing.", "When the order ships (Shopify or API). Transactional: also reaches contacts unsubscribed from marketing."),
  },
  app_signed_in: { label: t("Première connexion à l'app", "First app sign-in"), description: t("La première fois que le client se connecte dans votre app mobile.", "The first time the customer signs in to your mobile app.") },
  push_subscribed: { label: t("Notifications activées", "Notifications enabled"), description: t("Quand le client active les notifications sur son premier appareil.", "When the customer enables notifications on their first device.") },
};

export const EXIT_CONDITIONS: Record<ExitCondition, string> = {
  push_opened: t("a ouvert une notification de ce parcours", "opened a notification from this journey"),
  email_opened: t("a ouvert un email de ce parcours", "opened an email from this journey"),
  ordered: t("a passé commande depuis le début du parcours", "placed an order since the journey started"),
};

export const EVENT_LABELS: Record<EventType, string> = {
  open: t("A ouvert un email", "Opened an email"),
  click: t("A cliqué sur un lien", "Clicked a link"),
  unsubscribe: t("S'est désabonné", "Unsubscribed"),
  bounce: t("Email rejeté", "Email bounced"),
  order: t("A passé commande", "Placed an order"),
  cart_abandoned: t("A abandonné son panier", "Abandoned their cart"),
  tag_added: t("Tag ajouté", "Tag added"),
  contact_created: t("Contact créé", "Contact created"),
};

export type FieldKind = "text" | "number" | "date" | "tags" | "enum";

export const SEGMENT_FIELDS: Record<SegmentField, { label: string; kind: FieldKind; options?: Array<{ value: string; label: string }> }> = {
  email: { label: "Email", kind: "text" },
  first_name: { label: t("Prénom", "First name"), kind: "text" },
  last_name: { label: t("Nom", "Last name"), kind: "text" },
  status: {
    label: t("Statut", "Status"),
    kind: "enum",
    options: (Object.keys(CONTACT_STATUS) as ContactStatus[]).map((s) => ({ value: s, label: CONTACT_STATUS[s].label })),
  },
  source: {
    label: "Source",
    kind: "enum",
    options: (Object.keys(CONTACT_SOURCE) as ContactSource[]).map((s) => ({ value: s, label: CONTACT_SOURCE[s] })),
  },
  tags: { label: "Tags", kind: "tags" },
  total_spent: { label: t("Total dépensé (€)", "Total spent (€)"), kind: "number" },
  orders_count: { label: t("Nombre de commandes", "Number of orders"), kind: "number" },
  last_order_at: { label: t("Dernière commande", "Last order"), kind: "date" },
  created_at: { label: t("Date d'inscription", "Sign-up date"), kind: "date" },
};

export const OPS_BY_KIND: Record<FieldKind, Array<{ op: SegmentOp; label: string }>> = {
  text: [
    { op: "eq", label: t("est égal à", "equals") },
    { op: "neq", label: t("est différent de", "is not equal to") },
    { op: "contains", label: t("contient", "contains") },
  ],
  enum: [
    { op: "eq", label: t("est", "is") },
    { op: "neq", label: t("n'est pas", "is not") },
  ],
  number: [
    { op: "gt", label: t("est supérieur à", "is greater than") },
    { op: "lt", label: t("est inférieur à", "is less than") },
    { op: "eq", label: t("est égal à", "equals") },
    { op: "neq", label: t("est différent de", "is not equal to") },
  ],
  date: [
    { op: "within_days", label: t("dans les derniers (jours)", "in the last (days)") },
    { op: "older_than_days", label: t("il y a plus de (jours)", "more than (days) ago") },
  ],
  tags: [
    { op: "has_tag", label: t("possède le tag", "has tag") },
    { op: "not_has_tag", label: t("ne possède pas le tag", "doesn't have tag") },
  ],
};

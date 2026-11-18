import { t } from "../lib/i18n";

export type DnsProvider = "ovh" | "godaddy" | "ionos" | "gandi" | "cloudflare" | "wix" | "squarespace" | "aws" | "google" | "hostinger" | "o2switch";

export interface DnsGuide {
  id: DnsProvider | "shopify" | "other";
  name: string;
  /** Where to log in. */
  url?: string;
  /** Click path to the screen where a record is added. */
  steps: string[];
  /** Label of the "name" field in their form. */
  nameField: string;
  /** Label of the "value" field in their form. */
  valueField: string;
}

/** Step-by-step instructions to add a TXT record, per DNS provider. */
export const DNS_GUIDES: DnsGuide[] = [
  {
    id: "ovh",
    name: "OVHcloud",
    url: "https://www.ovh.com/manager/#/web/domain",
    steps: [
      t("Connectez-vous à votre espace client OVHcloud.", "Log in to your OVHcloud control panel."),
      t("En haut, cliquez sur « Web Cloud », puis à gauche sur « Noms de domaine » et sur votre domaine.", "At the top, click “Web Cloud”, then “Domain names” on the left and your domain."),
      t("Ouvrez l'onglet « Zone DNS », puis cliquez sur « Ajouter une entrée » et choisissez « TXT ».", "Open the “DNS zone” tab, click “Add an entry” and choose “TXT”."),
    ],
    nameField: t("Sous-domaine", "Sub-domain"),
    valueField: t("Valeur", "Value"),
  },
  {
    id: "godaddy",
    name: "GoDaddy",
    url: "https://dcc.godaddy.com/control/portfolio",
    steps: [
      t("Connectez-vous à GoDaddy et ouvrez « Mon portefeuille de domaines ».", "Log in to GoDaddy and open “Domain Portfolio”."),
      t("Cliquez sur votre domaine, puis sur l'onglet « DNS ».", "Click your domain, then the “DNS” tab."),
      t("Cliquez sur « Ajouter un nouvel enregistrement » et choisissez le type « TXT ».", "Click “Add New Record” and choose the “TXT” type."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Valeur", "Value"),
  },
  {
    id: "ionos",
    name: "IONOS",
    url: "https://my.ionos.fr/domains",
    steps: [
      t("Connectez-vous à IONOS et ouvrez « Domaines & SSL ».", "Log in to IONOS and open “Domains & SSL”."),
      t("Cliquez sur la roue dentée à côté de votre domaine, puis sur « DNS ».", "Click the gear next to your domain, then “DNS”."),
      t("Cliquez sur « Ajouter un enregistrement » et choisissez « TXT ».", "Click “Add record” and choose “TXT”."),
    ],
    nameField: t("Nom d'hôte", "Host name"),
    valueField: t("Valeur", "Value"),
  },
  {
    id: "gandi",
    name: "Gandi",
    url: "https://admin.gandi.net/domain/",
    steps: [
      t("Connectez-vous à Gandi et ouvrez « Noms de domaine ».", "Log in to Gandi and open “Domain names”."),
      t("Cliquez sur votre domaine, puis sur l'onglet « Enregistrements DNS ».", "Click your domain, then the “DNS records” tab."),
      t("Cliquez sur « Ajouter un enregistrement » et choisissez le type « TXT ».", "Click “Add record” and choose the “TXT” type."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Valeur du texte", "Text value"),
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    url: "https://dash.cloudflare.com/",
    steps: [
      t("Connectez-vous à Cloudflare et cliquez sur votre domaine.", "Log in to Cloudflare and click your domain."),
      t("Dans le menu de gauche, ouvrez « DNS », puis « Enregistrements ».", "In the left menu, open “DNS”, then “Records”."),
      t("Cliquez sur « Ajouter un enregistrement » et choisissez le type « TXT ».", "Click “Add record” and choose the “TXT” type."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Contenu", "Content"),
  },
  {
    id: "shopify",
    name: "Shopify",
    url: "https://admin.shopify.com/settings/domains",
    steps: [
      t("Seulement si vous avez acheté votre domaine chez Shopify. Dans l'administration Shopify, ouvrez « Paramètres », puis « Domaines ».", "Only if you bought your domain from Shopify. In your Shopify admin, open “Settings”, then “Domains”."),
      t("Cliquez sur votre domaine, puis sur « Paramètres de domaine » → « Modifier les paramètres DNS ».", "Click your domain, then “Domain settings” → “Edit DNS settings”."),
      t("Cliquez sur « Ajouter un enregistrement personnalisé » et choisissez « Enregistrement TXT ».", "Click “Add custom record” and choose “TXT record”."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Valeur TXT", "TXT value"),
  },
  {
    id: "wix",
    name: "Wix",
    url: "https://manage.wix.com/account/domains",
    steps: [
      t("Connectez-vous à Wix et ouvrez « Domaines ».", "Log in to Wix and open “Domains”."),
      t("Cliquez sur « ⋯ » à côté de votre domaine, puis sur « Gérer les enregistrements DNS ».", "Click “⋯” next to your domain, then “Manage DNS records”."),
      t("Dans la section « TXT », cliquez sur « + Ajouter un enregistrement ».", "In the “TXT” section, click “+ Add record”."),
    ],
    nameField: t("Nom d'hôte", "Host name"),
    valueField: t("Valeur", "Value"),
  },
  {
    id: "squarespace",
    name: "Squarespace",
    url: "https://account.squarespace.com/domains",
    steps: [
      t("Connectez-vous à Squarespace et ouvrez « Domaines ».", "Log in to Squarespace and open “Domains”."),
      t("Cliquez sur votre domaine, puis sur « Paramètres DNS ».", "Click your domain, then “DNS settings”."),
      t("Dans « Enregistrements personnalisés », cliquez sur « Ajouter un enregistrement » et choisissez « TXT ».", "Under “Custom records”, click “Add record” and choose “TXT”."),
    ],
    nameField: t("Hôte", "Host"),
    valueField: t("Données", "Data"),
  },
  {
    id: "hostinger",
    name: "Hostinger",
    url: "https://hpanel.hostinger.com/domains",
    steps: [
      t("Connectez-vous à hPanel et ouvrez « Domaines ».", "Log in to hPanel and open “Domains”."),
      t("Cliquez sur « Gérer » à côté de votre domaine, puis sur « DNS / Serveurs de noms ».", "Click “Manage” next to your domain, then “DNS / Nameservers”."),
      t("Choisissez le type « TXT » dans le formulaire d'ajout.", "Choose the “TXT” type in the add form."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Valeur TXT", "TXT value"),
  },
  {
    id: "o2switch",
    name: "o2switch",
    url: "https://www.o2switch.fr/",
    steps: [
      t("Connectez-vous à votre cPanel o2switch.", "Log in to your o2switch cPanel."),
      t("Ouvrez « Zone Editor » (Éditeur de zone), puis « Gérer » à côté de votre domaine.", "Open “Zone Editor”, then “Manage” next to your domain."),
      t("Cliquez sur la flèche de « + Ajouter un enregistrement » et choisissez « Ajouter un enregistrement TXT ».", "Click the arrow next to “+ Add Record” and choose “Add TXT Record”."),
    ],
    nameField: t("Nom", "Name"),
    valueField: t("Enregistrement", "Record"),
  },
  {
    id: "aws",
    name: "Amazon Route 53",
    url: "https://console.aws.amazon.com/route53/v2/hostedzones",
    steps: [
      t("Dans la console AWS, ouvrez Route 53 → « Zones hébergées » et cliquez sur votre domaine.", "In the AWS console, open Route 53 → “Hosted zones” and click your domain."),
      t("Cliquez sur « Créer un enregistrement » et choisissez le type « TXT ».", "Click “Create record” and choose the “TXT” type."),
      t("Mettez la valeur entre guillemets doubles : Route 53 l'exige.", "Wrap the value in double quotes: Route 53 requires it."),
    ],
    nameField: t("Nom de l'enregistrement", "Record name"),
    valueField: t("Valeur", "Value"),
  },
  {
    id: "other",
    name: t("Autre hébergeur", "Other provider"),
    steps: [
      t("Connectez-vous chez l'entreprise à qui vous payez votre nom de domaine chaque année.", "Log in to the company you pay for your domain name every year."),
      t("Cherchez une rubrique appelée « DNS », « Zone DNS » ou « Enregistrements DNS ».", "Look for a section called “DNS”, “DNS zone” or “DNS records”."),
      t("Ajoutez un nouvel enregistrement de type « TXT ».", "Add a new record of type “TXT”."),
    ],
    nameField: t("Nom (ou Hôte)", "Name (or Host)"),
    valueField: t("Valeur (ou Contenu)", "Value (or Content)"),
  },
];

export const guideFor = (id: string | null | undefined) => DNS_GUIDES.find((g) => g.id === id) ?? null;

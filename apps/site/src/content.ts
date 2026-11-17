import { LANG, t } from "./i18n";

/** URL of the web app (sign-in / free trial). Set VITE_APP_URL at build time for production. */
export const APP_URL = (import.meta.env.VITE_APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
/** App links carry the current language so the app opens in the same one. */
export const SIGNUP_URL = `${APP_URL}/inscription?lang=${LANG}`;
export const LOGIN_URL = `${APP_URL}/connexion?lang=${LANG}`;
/** Public REST API base, shown in the developer examples. Set VITE_API_URL in production. */
export const API_URL = (import.meta.env.VITE_API_URL ?? `${APP_URL}/api/v1`).replace(/\/+$/, "");

/**
 * Pricing — 3 SaaS plans. Contacts are unlimited in every plan; paid plans are priced by monthly email volume.
 * ⚠️ Prices and plan contents to validate before going live (the app does not enforce plan limits yet).
 */
export const PRICING = { freeEmails: 5000, yearlyDiscount: 0.2 };

/** Monthly email volumes offered on the paid plans. */
export const VOLUMES = [10_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;
export type Volume = (typeof VOLUMES)[number];

export type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  tagline: string;
  /** Monthly price (€ HT, billed monthly) per volume; null = free plan. */
  prices: Record<Volume, number> | null;
  featuresTitle: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: t("Gratuit", "Free"),
    tagline: t("Pour lancer vos premières campagnes.", "Launch your first campaigns."),
    prices: null,
    featuresTitle: t("Pour démarrer :", "To get started:"),
    features: [
      t("5 000 emails par mois, sans plafond quotidien", "5,000 emails per month, no daily cap"),
      t("Contacts illimités", "Unlimited contacts"),
      t(`Éditeur complet, 30 blocs`, "Full editor, 30 blocks"),
      t("Style de marque et vos polices", "Brand style and your own fonts"),
      t("Segments et import CSV", "Segments and CSV import"),
      t("Connexion à votre site", "Connect your website"),
      t("1 utilisateur", "1 user"),
    ],
    cta: t("Commencer gratuitement", "Start for free"),
  },
  {
    id: "pro",
    name: "Pro",
    tagline: t("Pour les boutiques qui veulent automatiser leurs ventes.", "For stores that want to automate their sales."),
    prices: { 10000: 9, 20000: 15, 50000: 29, 100000: 45, 250000: 99, 500000: 179, 1000000: 299 },
    featuresTitle: t("Tout Gratuit, plus :", "Everything in Free, plus:"),
    features: [
      t("Automatisations : bienvenue, après achat, panier abandonné", "Automations: welcome, post-purchase, abandoned cart"),
      t("Chiffre d'affaires par campagne", "Revenue per campaign"),
      t("API et clés API", "API and API keys"),
      t(
        "Notifications push (écran verrouillé) et centre de notifications dans votre app",
        "Push notifications (lock screen) and an in-app notification center",
      ),
      t(
        "Écran de pré-permission, relance des non-ouvreurs et envoi intelligent",
        "Pre-permission screen, non-opener follow-ups and smart send",
      ),
      t("Push transactionnel « Commande expédiée », par API ou sans code", "Transactional “Order shipped” push, via API or no-code"),
      t("Jusqu'à 3 utilisateurs", "Up to 3 users"),
    ],
    cta: t("Essayer Pro", "Try Pro"),
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: t("Pour les équipes, les agences et les gros volumes.", "For teams, agencies and high volumes."),
    prices: { 10000: 25, 20000: 39, 50000: 59, 100000: 89, 250000: 179, 500000: 299, 1000000: 499 },
    featuresTitle: t("Tout Pro, plus :", "Everything in Pro, plus:"),
    features: [
      t("Utilisateurs illimités", "Unlimited users"),
      t("Rôles administrateur et éditeur", "Admin and editor roles"),
      t("Support prioritaire", "Priority support"),
      t("Aide à la migration de vos contacts", "Help migrating your contacts"),
    ],
    cta: t("Choisir Business", "Choose Business"),
  },
];

/** Monthly price shown for a plan, volume and billing period (yearly = discounted monthly equivalent). */
export function planPrice(plan: Plan, volume: Volume, yearly: boolean): number {
  if (!plan.prices) return 0;
  const base = plan.prices[volume];
  return yearly ? Math.round(base * (1 - PRICING.yearlyDiscount)) : base;
}

/** Plan comparison table: [label, Gratuit, Pro, Business]; true/false render as check/dash. */
export const PLAN_TABLE: Array<[string, string | boolean, string | boolean, string | boolean]> = [
  [t("Emails par mois", "Emails per month"), t("5 000", "5,000"), t("10 000 à 1 million", "10,000 to 1 million"), t("10 000 à 1 million", "10,000 to 1 million")],
  [t("Plafond d'envoi quotidien", "Daily sending cap"), t("Aucun", "None"), t("Aucun", "None"), t("Aucun", "None")],
  ["Contacts", t("Illimités", "Unlimited"), t("Illimités", "Unlimited"), t("Illimités", "Unlimited")],
  [t("Éditeur glisser-déposer, 30 blocs", "Drag-and-drop editor, 30 blocks"), true, true, true],
  [t("Style de marque et polices personnalisées", "Brand style and custom fonts"), true, true, true],
  [t("Segments et import CSV", "Segments and CSV import"), true, true, true],
  [t("Connexion à votre site", "Connect your website"), true, true, true],
  [t("Rapports d'ouvertures et de clics", "Open and click reports"), true, true, true],
  [t("App Pingsell iOS et Android (pour gérer votre compte)", "Pingsell app for iOS and Android (to manage your account)"), true, true, true],
  [t("Automatisations", "Automations"), false, true, true],
  [
    t("Notifications push et centre de notifications in-app (votre app iOS / Android)", "Push notifications and in-app notification center (your iOS / Android app)"),
    false,
    true,
    true,
  ],
  [t("Écran de pré-permission et taux d'opt-in", "Pre-permission screen and opt-in rate"), false, true, true],
  [t("Relance automatique des non-ouvreurs (push)", "Automatic non-opener follow-up (push)"), false, true, true],
  [t("Envoi intelligent à l'heure de chaque client", "Smart send at each customer's best time"), false, true, true],
  [t("Déclencheurs app et étape « Arrêter si… »", "App triggers and “Stop if…” step"), false, true, true],
  [t("Push transactionnel « Commande expédiée » (API ou sans code)", "Transactional “Order shipped” push (API or no-code)"), false, true, true],
  [t("Chiffre d'affaires par campagne", "Revenue per campaign"), false, true, true],
  [t("API et clés API", "API and API keys"), false, true, true],
  [t("Utilisateurs", "Users"), "1", "3", t("Illimités", "Unlimited")],
  ["Support", "Email", "Email", t("Prioritaire", "Priority")],
];

export const BLOCKS = [
  t("Titre", "Heading"),
  t("Texte", "Text"),
  "Image",
  t("Bouton", "Button"),
  t("2 boutons", "2 buttons"),
  t("Liste", "List"),
  t("Citation", "Quote"),
  t("Vidéo", "Video"),
  t("Bannière", "Banner"),
  t("Image + texte", "Image + text"),
  t("Galerie", "Gallery"),
  t("Avantages", "Benefits"),
  t("Chiffres clés", "Key figures"),
  t("Produit", "Product"),
  t("Colonnes", "Columns"),
  t("Code promo", "Promo code"),
  t("Compte à rebours", "Countdown"),
  t("Avis client", "Review"),
  t("Sondage", "Poll"),
  t("Événement", "Event"),
  "FAQ",
  t("Badges applis", "App badges"),
  "Signature",
  "Logo",
  "Menu",
  t("Réseaux sociaux", "Social links"),
  t("Séparateur", "Divider"),
  t("Espace", "Spacer"),
  "HTML",
  t("Pied de page", "Footer"),
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: t("Faut-il une carte bancaire pour commencer ?", "Do I need a credit card to get started?"),
    a: t(
      "Non. Les 5 000 premiers emails de chaque mois sont offerts : vous créez votre compte, importez vos contacts et envoyez votre première campagne sans rien payer.",
      "No. Your first 5,000 emails every month are free: create your account, import your contacts and send your first campaign without paying a cent.",
    ),
  },
  {
    q: t("Quelle formule choisir ?", "Which plan should I choose?"),
    a: t(
      "Gratuit pour démarrer et envoyer vos premières campagnes. Pro dès que vous voulez des automatisations (bienvenue, panier abandonné, après achat), l'API ou travailler à plusieurs. Business pour les équipes et agences qui ont besoin d'utilisateurs illimités et d'un support prioritaire.",
      "Free to get started and send your first campaigns. Pro as soon as you want automations (welcome, abandoned cart, post-purchase), the API or a few teammates. Business for teams and agencies that need unlimited users and priority support.",
    ),
  },
  {
    q: t("Pourquoi payer au volume d'emails plutôt qu'au nombre de contacts ?", "Why pay by email volume instead of by number of contacts?"),
    a: t(
      "Parce que vos contacts dormants ne devraient rien vous coûter. Avec Pingsell, une liste de 20 000 contacts à qui vous écrivez deux fois par mois coûte le prix de ces envois, pas celui de la taille de votre fichier.",
      "Because inactive contacts shouldn't cost you anything. With Pingsell, a list of 20,000 contacts you email twice a month costs what you actually send, not what your list weighs.",
    ),
  },
  {
    q: t("Comment Pingsell se branche sur ma boutique en ligne ?", "How does Pingsell connect to my online store?"),
    a: t(
      "Sans code si votre boutique est sur Shopify : la connexion se fait en un clic, et vos clients, commandes et paniers se synchronisent. Sur une autre plateforme ou un site sur mesure, l'API et les clés API branchent votre back-office : ajout de contacts, événements, déclenchement d'automatisations (bienvenue, après achat, panier abandonné).",
      "No code needed if your store runs on Shopify: connect in one click and your customers, orders and carts sync automatically. On another platform or a custom site, the API and API keys plug into your back office: add contacts, send events and trigger automations (welcome, post-purchase, abandoned cart).",
    ),
  },
  {
    q: t("Puis-je envoyer des notifications push à ma propre app ?", "Can I send push notifications to my own app?"),
    a: t(
      "Oui, en Pro et Business. Votre app iOS ou Android (native, React Native, Flutter ou Expo) enregistre ses appareils auprès de Pingsell avec une clé publique d'app, et l'email relie chaque appareil à un contact. Pingsell envoie ensuite via Firebase Cloud Messaging, APNs ou Expo. Chaque message s'affiche sur l'écran verrouillé et reste dans le centre de notifications de votre app (avec badge des non-lues), grâce au SDK React Native / Expo ou à quatre appels d'API. Vous créez des campagnes avec titre, texte, image et un lien profond qui ouvre la bonne page de l'app, et vous ajoutez une étape « Notification push » dans vos automatisations, à côté de vos emails. À ne pas confondre avec l'app Pingsell, qui sert à suivre votre compte depuis votre téléphone.",
      "Yes, on Pro and Business. Your iOS or Android app (native, React Native, Flutter or Expo) registers its devices with Pingsell using a public app key, and the email address links each device to a contact. Pingsell then delivers through Firebase Cloud Messaging, APNs or Expo. Every message shows up on the lock screen and stays in your app's notification center (with an unread badge), using the React Native / Expo SDK or four API calls. You create campaigns with a title, text, image and a deep link that opens the right screen in your app, and you add a “Push notification” step to your automations, right next to your emails. Not to be confused with the Pingsell app, which lets you follow your account from your phone.",
    ),
  },
  {
    q: t("Pourquoi un écran avant la demande de notifications ?", "Why show a screen before asking for notification permission?"),
    a: t(
      "Parce que la fenêtre système d'iOS et d'Android ne s'affiche qu'une fois : un client qui refuse ne la reverra plus, et devra passer par les réglages de son téléphone. Pingsell affiche d'abord votre propre écran, dans votre app, qui explique ce que vos notifications apportent (suivi de colis, ventes privées…). La fenêtre système ne s'ouvre que pour les clients qui touchent « Activer ». Vous modifiez le texte depuis Pingsell sans republier l'app, vous choisissez à partir de quel lancement l'afficher et après combien de jours le reproposer à ceux qui ont choisi « Plus tard », et vous suivez les affichages, les acceptations et votre taux d'opt-in.",
      "Because the iOS and Android system prompt only appears once: a customer who declines won't see it again and has to go through their phone's settings. Pingsell first shows your own screen, inside your app, explaining what your notifications bring (package tracking, private sales…). The system prompt only opens for customers who tap “Turn on”. You edit the copy from Pingsell without republishing the app, choose on which launch to show it and after how many days to offer it again to those who picked “Not now”, and track views, acceptances and your opt-in rate.",
    ),
  },
  {
    q: t("Quelle différence entre un push transactionnel et un push marketing ?", "What's the difference between a transactional push and a marketing push?"),
    a: t(
      "Un push marketing (campagne, automatisation) part vers une audience et respecte les désinscriptions marketing. Un push transactionnel concerne une seule commande ou un seul compte : il est envoyé immédiatement à un client, retrouvé par son email, via l'appel POST /api/v1/push/send ou sans code avec le déclencheur de votre boutique « Commande expédiée » (avec le suivi du colis). Comme c'est une information attendue, il atteint aussi les clients désinscrits du marketing. Gardez-le pour les vraies informations de service : expédition, livraison, compte.",
      "A marketing push (campaign, automation) goes to an audience and respects marketing unsubscribes. A transactional push is about a single order or account: it's sent instantly to one customer, looked up by email, through the POST /api/v1/push/send call or with no code using your store's “Order shipped” trigger (with package tracking). Since it's information the customer expects, it also reaches customers who unsubscribed from marketing. Keep it for genuine service updates: shipping, delivery, account.",
    ),
  },
  {
    q: t("Je viens d'un autre outil, comment récupérer mes contacts ?", "I'm coming from another tool. How do I bring my contacts?"),
    a: t(
      "Exportez-les en CSV depuis votre ancien outil et importez le fichier dans Pingsell. Seule la colonne email est obligatoire ; prénom, nom, téléphone, tags et statut sont repris s'ils sont présents, donc vos désinscrits restent désinscrits.",
      "Export them as a CSV from your old tool and import the file into Pingsell. Only the email column is required; first name, last name, phone, tags and status are carried over when present, so your unsubscribes stay unsubscribed.",
    ),
  },
  {
    q: t("Mes emails s'afficheront-ils bien partout ?", "Will my emails look good everywhere?"),
    a: t(
      "Les emails Pingsell sont construits pour Gmail, Outlook, Apple Mail et les mobiles. L'éditeur vous montre l'aperçu ordinateur et mobile, et vous pouvez vous envoyer un test avant chaque campagne.",
      "Pingsell emails are built for Gmail, Outlook, Apple Mail and mobile. The editor shows you desktop and mobile previews, and you can send yourself a test before every campaign.",
    ),
  },
  {
    q: t("Puis-je travailler à plusieurs ?", "Can I work with my team?"),
    a: t(
      "Oui. Invitez un associé, un freelance ou votre agence en éditeur ou en administrateur : jusqu'à 3 utilisateurs en Pro, sans limite en Business. Chacun a son accès et vous gardez la main sur l'équipe.",
      "Yes. Invite a partner, a freelancer or your agency as an editor or an admin: up to 3 users on Pro, unlimited on Business. Everyone gets their own login and you stay in control of the team.",
    ),
  },
  {
    q: t("Et le RGPD ?", "What about GDPR?"),
    a: t(
      "Chaque email contient obligatoirement un lien de désinscription, et les désinscriptions sont prises en compte immédiatement pour toutes vos campagnes et automatisations.",
      "Every email always includes an unsubscribe link, and unsubscribes take effect immediately across all your campaigns and automations.",
    ),
  },
];

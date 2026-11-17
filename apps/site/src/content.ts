/** URL of the web app (sign-in / free trial). Set VITE_APP_URL at build time for production. */
export const APP_URL = (import.meta.env.VITE_APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
export const SIGNUP_URL = `${APP_URL}/inscription`;
export const LOGIN_URL = `${APP_URL}/connexion`;
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
    name: "Gratuit",
    tagline: "Pour lancer vos premières campagnes.",
    prices: null,
    featuresTitle: "Pour démarrer :",
    features: [
      "5 000 emails par mois, sans plafond quotidien",
      "Contacts illimités",
      `Éditeur complet, 30 blocs`,
      "Style de marque et vos polices",
      "Segments et import CSV",
      "Connexion Shopify",
      "1 utilisateur",
    ],
    cta: "Commencer gratuitement",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Pour les boutiques qui veulent automatiser leurs ventes.",
    prices: { 10000: 9, 20000: 15, 50000: 29, 100000: 45, 250000: 99, 500000: 179, 1000000: 299 },
    featuresTitle: "Tout Gratuit, plus :",
    features: [
      "Automatisations : bienvenue, après achat, panier abandonné",
      "Chiffre d'affaires Shopify par campagne",
      "API et clés API",
      "Jusqu'à 3 utilisateurs",
    ],
    cta: "Essayer Pro",
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "Pour les équipes, les agences et les gros volumes.",
    prices: { 10000: 25, 20000: 39, 50000: 59, 100000: 89, 250000: 179, 500000: 299, 1000000: 499 },
    featuresTitle: "Tout Pro, plus :",
    features: ["Utilisateurs illimités", "Rôles administrateur et éditeur", "Support prioritaire", "Aide à la migration de vos contacts"],
    cta: "Choisir Business",
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
  ["Emails par mois", "5 000", "10 000 à 1 million", "10 000 à 1 million"],
  ["Plafond d'envoi quotidien", "Aucun", "Aucun", "Aucun"],
  ["Contacts", "Illimités", "Illimités", "Illimités"],
  ["Éditeur glisser-déposer, 30 blocs", true, true, true],
  ["Style de marque et polices personnalisées", true, true, true],
  ["Segments et import CSV", true, true, true],
  ["Connexion Shopify", true, true, true],
  ["Rapports d'ouvertures et de clics", true, true, true],
  ["App iOS et Android", true, true, true],
  ["Automatisations", false, true, true],
  ["Chiffre d'affaires par campagne", false, true, true],
  ["API et clés API", false, true, true],
  ["Utilisateurs", "1", "3", "Illimités"],
  ["Support", "Email", "Email", "Prioritaire"],
];

export const BLOCKS = [
  "Titre",
  "Texte",
  "Image",
  "Bouton",
  "2 boutons",
  "Liste",
  "Citation",
  "Vidéo",
  "Bannière",
  "Image + texte",
  "Galerie",
  "Avantages",
  "Chiffres clés",
  "Produit",
  "Colonnes",
  "Code promo",
  "Compte à rebours",
  "Avis client",
  "Sondage",
  "Événement",
  "FAQ",
  "Badges applis",
  "Signature",
  "Logo",
  "Menu",
  "Réseaux sociaux",
  "Séparateur",
  "Espace",
  "HTML",
  "Pied de page",
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Faut-il une carte bancaire pour commencer ?",
    a: "Non. Les 5 000 premiers emails de chaque mois sont offerts : vous créez votre compte, importez vos contacts et envoyez votre première campagne sans rien payer.",
  },
  {
    q: "Quelle formule choisir ?",
    a: "Gratuit pour démarrer et envoyer vos premières campagnes. Pro dès que vous voulez des automatisations (bienvenue, panier abandonné, après achat), l'API ou travailler à plusieurs. Business pour les équipes et agences qui ont besoin d'utilisateurs illimités et d'un support prioritaire.",
  },
  {
    q: "Pourquoi payer au volume d'emails plutôt qu'au nombre de contacts ?",
    a: "Parce que vos contacts dormants ne devraient rien vous coûter. Avec Missive, une liste de 20 000 contacts à qui vous écrivez deux fois par mois coûte le prix de ces envois, pas celui de la taille de votre fichier.",
  },
  {
    q: "Comment ça marche avec Shopify ?",
    a: "Vous connectez votre boutique en un clic. Vos clients et leurs commandes se synchronisent, et vous pouvez déclencher des emails automatiques : bienvenue, remerciement après achat, relance de panier abandonné.",
  },
  {
    q: "Ma boutique n'est pas sur Shopify, est-ce que ça marche quand même ?",
    a: "Oui. L'API Missive et les clés API permettent de brancher votre back-office ou votre site : ajout de contacts, événements, déclenchement d'automatisations.",
  },
  {
    q: "Je viens d'un autre outil, comment récupérer mes contacts ?",
    a: "Exportez-les en CSV depuis votre ancien outil et importez le fichier dans Missive. Seule la colonne email est obligatoire ; prénom, nom, téléphone, tags et statut sont repris s'ils sont présents, donc vos désinscrits restent désinscrits.",
  },
  {
    q: "Mes emails s'afficheront-ils bien partout ?",
    a: "Les emails Missive sont construits pour Gmail, Outlook, Apple Mail et les mobiles. L'éditeur vous montre l'aperçu ordinateur et mobile, et vous pouvez vous envoyer un test avant chaque campagne.",
  },
  {
    q: "Puis-je travailler à plusieurs ?",
    a: "Oui. Invitez un associé, un freelance ou votre agence en éditeur ou en administrateur : jusqu'à 3 utilisateurs en Pro, sans limite en Business. Chacun a son accès et vous gardez la main sur l'équipe.",
  },
  {
    q: "Et le RGPD ?",
    a: "Chaque email contient obligatoirement un lien de désinscription, et les désinscriptions sont prises en compte immédiatement pour toutes vos campagnes et automatisations.",
  },
];

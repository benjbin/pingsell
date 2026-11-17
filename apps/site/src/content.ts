/** URL of the web app (sign-in / free trial). Set VITE_APP_URL at build time for production. */
export const APP_URL = (import.meta.env.VITE_APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
export const SIGNUP_URL = `${APP_URL}/inscription`;
export const LOGIN_URL = `${APP_URL}/connexion`;

/**
 * Pricing — billed on emails sent, every feature included.
 * ⚠️ Prices to validate before going live: they are the only figures on the site to set.
 */
export const PRICING = {
  freeEmails: 3000,
  /** Price per 1,000 emails, by monthly volume band (cumulative, like tax brackets). */
  tiers: [
    { upTo: 50_000, per1000: 1.0 },
    { upTo: 250_000, per1000: 0.7 },
    { upTo: Infinity, per1000: 0.5 },
  ],
};

export function monthlyPrice(emails: number): number {
  let billable = Math.max(0, emails - PRICING.freeEmails);
  let floor = PRICING.freeEmails;
  let total = 0;
  for (const t of PRICING.tiers) {
    if (billable <= 0) break;
    const band = Math.min(billable, t.upTo - floor);
    total += (band / 1000) * t.per1000;
    billable -= band;
    floor = t.upTo;
  }
  return Math.round(total);
}

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
    a: "Non. Les 3 000 premiers emails de chaque mois sont offerts : vous créez votre compte, importez vos contacts et envoyez votre première campagne sans rien payer.",
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
    a: "Oui, sans supplément. Invitez un associé, un freelance ou votre agence en éditeur ou en administrateur : chacun a son accès et vous gardez la main sur l'équipe.",
  },
  {
    q: "Et le RGPD ?",
    a: "Chaque email contient obligatoirement un lien de désinscription, et les désinscriptions sont prises en compte immédiatement pour toutes vos campagnes et automatisations.",
  },
];

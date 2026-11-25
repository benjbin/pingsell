import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Logo, ThemeToggle } from "../components/layout/AppLayout";
import { LanguageToggle } from "../components/layout/LanguageToggle";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";

// Publisher contact address.
const CONTACT_EMAIL = "contact@neokrome.tech";

const UPDATED = t("19 novembre 2026", "November 19, 2026");

interface Section {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

const SECTIONS: Section[] = [
  {
    title: t("Qui sommes-nous ?", "Who we are"),
    paragraphs: [
      t(
        "Pingsell est un outil d'emailing, de notifications push et d'automatisations pour les boutiques en ligne. Cette politique explique quelles données nous traitons, pourquoi, et comment exercer vos droits.",
        "Pingsell is an email, push notification and automation tool for online stores. This policy explains what data we process, why, and how to exercise your rights.",
      ),
      t(`Pour toute question : ${CONTACT_EMAIL}.`, `For any question: ${CONTACT_EMAIL}.`),
    ],
  },
  {
    title: t("Les données que nous traitons", "The data we process"),
    paragraphs: [t("Pour les marchands qui utilisent Pingsell (vous) :", "For the merchants who use Pingsell (you):")],
    items: [
      t(
        "les données de votre compte : nom de la boutique, adresse email, membres de l'équipe, réglages et historique d'utilisation.",
        "your account data: store name, email address, team members, settings and usage history.",
      ),
    ],
  },
  {
    title: t("Les données de vos clients", "Your customers' data"),
    paragraphs: [
      t(
        "Pour les clients de votre boutique, nous traitons les données que vous nous transmettez, directement ou via Shopify et votre site :",
        "For your store's customers, we process the data you send us, directly or through Shopify and your site:",
      ),
    ],
    items: [
      t("adresse email, nom, téléphone et statut de consentement (abonné, désabonné) ;", "email address, name, phone and consent status (subscribed, unsubscribed);"),
      t("commandes et paniers abandonnés reçus de Shopify ou de votre site ;", "orders and abandoned carts received from Shopify or your site;"),
      t(
        "pages vues et actions sur votre site, uniquement avec le consentement du visiteur lorsque la loi l'exige.",
        "page views and actions on your site, only with the visitor's consent where the law requires it.",
      ),
    ],
  },
  {
    title: t("Pourquoi", "Why"),
    items: [
      t("envoyer vos emails, vos notifications et vos automatisations (bienvenue, panier abandonné, commande expédiée…) ;", "sending your emails, notifications and automations (welcome, abandoned cart, order shipped…);"),
      t("vous montrer vos statistiques : ouvertures, clics et ventes liées à chaque message ;", "showing you your stats: opens, clicks and sales linked to each message;"),
      t("faire fonctionner et sécuriser votre compte.", "running and securing your account."),
    ],
  },
  {
    title: t("Notre rôle et la base légale", "Our role and legal basis"),
    paragraphs: [
      t(
        "Pour les données de vos clients, vous êtes responsable du traitement et Pingsell agit comme sous-traitant : nous les traitons uniquement pour votre compte et selon vos instructions. C'est à vous de recueillir le consentement de vos clients lorsqu'il est requis. Pour les données de votre propre compte, Pingsell est responsable du traitement, sur la base du contrat qui nous lie.",
        "For your customers' data, you are the controller and Pingsell acts as your processor: we process it only on your behalf and following your instructions. Collecting your customers' consent where required is up to you. For your own account data, Pingsell is the controller, on the basis of the contract between us.",
      ),
    ],
  },
  {
    title: t("Combien de temps", "How long we keep it"),
    items: [
      t("données de suivi du site (pages vues) : 13 mois ;", "site tracking data (page views): 13 months;"),
      t("actions enregistrées sur le site : 395 jours ;", "actions recorded on the site: 395 days;"),
      t(
        "données reçues de Shopify : supprimées lorsqu'un client demande l'effacement de ses données, et lorsque la boutique désinstalle l'application (à réception de la demande « shop/redact » de Shopify) ;",
        "data received from Shopify: deleted when a customer asks for their data to be erased, and when the store uninstalls the app (on receiving Shopify's “shop/redact” request);",
      ),
      t("données de votre compte : tant que le compte est ouvert.", "your account data: for as long as the account is open."),
    ],
  },
  {
    title: t("Nos sous-traitants", "Our sub-processors"),
    paragraphs: [
      t(
        "Nous faisons appel à deux catégories de prestataires : l'hébergement (serveurs et base de données) et l'envoi des emails. Ils n'accèdent aux données que pour rendre ce service.",
        "We use two categories of providers: hosting (servers and database) and email delivery. They only access the data to provide that service.",
      ),
    ],
  },
  {
    title: t("Sécurité", "Security"),
    items: [
      t("chiffrement des échanges (HTTPS) ;", "encryption in transit (HTTPS);"),
      t("secrets et clés d'accès conservés à part des données ;", "secrets and access keys stored separately from the data;"),
      t("accès aux données limité aux personnes qui en ont besoin.", "access to data restricted to those who need it."),
    ],
  },
  {
    title: t("Vos droits", "Your rights"),
    paragraphs: [
      t(
        `Vous pouvez demander l'accès, la rectification ou l'effacement de vos données. Si vous êtes client d'une boutique qui utilise Pingsell, adressez-vous d'abord à cette boutique ; vous pouvez aussi nous écrire à ${CONTACT_EMAIL}, nous transmettrons votre demande.`,
        `You can ask to access, correct or erase your data. If you are a customer of a store that uses Pingsell, contact that store first; you can also write to us at ${CONTACT_EMAIL} and we will pass your request on.`,
      ),
    ],
  },
  {
    title: t("Spécificités Shopify", "Shopify specifics"),
    paragraphs: [
      t(
        "Lorsque Pingsell est installé sur une boutique Shopify, nous traitons les demandes de confidentialité que Shopify nous transmet :",
        "When Pingsell is installed on a Shopify store, we act on the privacy requests Shopify sends us:",
      ),
    ],
    items: [
      t("« customers/data_request » : nous fournissons les données détenues sur le client ;", "“customers/data_request”: we provide the data held about the customer;"),
      t("« customers/redact » : nous supprimons les données du client ;", "“customers/redact”: we delete the customer's data;"),
      t("« shop/redact » : après la désinstallation, nous supprimons les données de la boutique.", "“shop/redact”: after the app is uninstalled, we delete the store's data."),
    ],
  },
];

/** Public privacy policy. */
export function PrivacyPage() {
  const { account } = useAuth();
  return (
    <div className="min-h-screen bg-white px-6 py-8 sm:px-12 dark:bg-slate-950">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <Link to="/" aria-label={t("Pingsell, accueil", "Pingsell, home")}>
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      <article className="mx-auto max-w-3xl animate-rise py-12">
        <Link
          to={account ? "/" : "/connexion"}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {account ? t("Retour à Pingsell", "Back to Pingsell") : t("Retour à la connexion", "Back to log in")}
        </Link>
        <h1 className="display mt-6 text-[44px] leading-[0.95] text-slate-900 dark:text-white">{t("Politique de confidentialité", "Privacy policy")}</h1>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t(`Dernière mise à jour : ${UPDATED}`, `Last updated: ${UPDATED}`)}</p>

        <div className="mt-10 space-y-9">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">{s.title}</h2>
              {s.paragraphs?.map((p) => (
                <p key={p} className="mt-2.5 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {p}
                </p>
              ))}
              {s.items && (
                <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-600 marker:text-brand-500 dark:text-slate-300">
                  {s.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-slate-900/10 pt-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          {t("Contact : ", "Contact: ")}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            {CONTACT_EMAIL}
          </a>
        </p>
      </article>
    </div>
  );
}

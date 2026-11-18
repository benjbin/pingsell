import type { LucideIcon } from "lucide-react";
import { CalendarClock, CalendarHeart, Crown, Eye, Globe, Hourglass, MousePointerClick, PackageCheck, Repeat, ShoppingCart, Sparkles } from "lucide-react";
import type { AutomationStep, AutomationTrigger } from "../../lib/types";
import { DEFAULT_EMAIL_HTML } from "../campaigns/defaultTemplate";
import { t } from "../../lib/i18n";

/** The default template with our own title, paragraphs and button. */
function email(subject: string, title: string, lines: string[], cta: string, url = "https://exemple.fr"): AutomationStep {
  const body = `<h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#0f172a;">${title}</h1>\n${lines
    .map((l, i) => `            <p style="margin:0 0 ${i === lines.length - 1 ? 28 : 16}px;">${l}</p>`)
    .join("\n")}\n            `;
  const start = DEFAULT_EMAIL_HTML.indexOf("<h1");
  const end = DEFAULT_EMAIL_HTML.indexOf('<table role="presentation" cellpadding="0" cellspacing="0">', start);
  const html = (DEFAULT_EMAIL_HTML.slice(0, start) + body + DEFAULT_EMAIL_HTML.slice(end))
    .replace(/href="https:\/\/exemple\.fr"([^>]*)>(Découvrir|Discover)</, `href="${url}"$1>${cta}<`);
  return { type: "email", subject, html };
}
const wait = (hours: number): AutomationStep => ({ type: "wait", hours });
const days = (n: number) => wait(n * 24);

export interface Recipe {
  id: string;
  icon: LucideIcon;
  name: string;
  pitch: string;
  tags: string[];
  trigger: AutomationTrigger;
  trigger_config?: Record<string, unknown>;
  steps: AutomationStep[];
}

export const RECIPES: Recipe[] = [
  {
    id: "bienvenue",
    icon: Sparkles,
    name: t("Série de bienvenue", "Welcome series"),
    pitch: t("3 emails sur 7 jours, avec une relance différente selon qu'il a ouvert ou non, puis un code si toujours pas d'achat.", "3 emails over 7 days, a different follow-up depending on whether they opened, then a code if still no purchase."),
    tags: [t("Si / sinon", "If / else"), t("Arrêt si achat", "Stop on purchase")],
    trigger: "contact_created",
    steps: [
      email(t("Bienvenue {{first_name|}} !", "Welcome {{first_name|}}!"), t("Bienvenue {{first_name|}} 👋", "Welcome {{first_name|}} 👋"), [t("Merci de nous avoir rejoints. Voici ce qui fait notre différence…", "Thanks for joining us. Here's what makes us different…")], t("Découvrir la boutique", "Visit the shop")),
      days(2),
      {
        type: "branch",
        condition: { type: "email_opened" },
        yes: [email(t("Nos best-sellers, rien que pour vous", "Our best-sellers, just for you"), t("Ce que nos clients adorent", "What our customers love"), [t("Les 3 produits les plus commandés ce mois-ci.", "The 3 most ordered products this month.")], t("Voir les best-sellers", "See best-sellers"))],
        no: [email(t("Vous êtes passé à côté ?", "Did you miss this?"), t("Un petit rappel", "A quick reminder"), [t("Votre premier email est peut-être resté caché. Voici l'essentiel en 30 secondes.", "Our first email may have gone unnoticed. Here's the gist in 30 seconds.")], t("Découvrir", "Discover"))],
      },
      days(5),
      { type: "exit_if", condition: "ordered" },
      email(t("{{first_name|}}, -10 % sur votre première commande", "{{first_name|}}, 10% off your first order"), t("Un cadeau de bienvenue", "A welcome gift"), [t("Avec le code <strong>BIENVENUE10</strong>, valable 7 jours.", "With the code <strong>WELCOME10</strong>, valid for 7 days.")], t("En profiter", "Use it")),
    ],
  },
  {
    id: "panier",
    icon: ShoppingCart,
    name: t("Panier abandonné", "Abandoned cart"),
    pitch: t("Push tout de suite pour ceux qui ont l'app, email aux heures ouvrées, puis une 2ᵉ relance avec un code. S'arrête dès qu'il commande.", "Push right away for app users, email during business hours, then a 2nd reminder with a code. Stops as soon as they order."),
    tags: ["Push", t("Créneau", "Window"), t("Arrêt si achat", "Stop on purchase")],
    trigger: "cart_abandoned",
    steps: [
      { type: "branch", condition: { type: "has_app" }, yes: [{ type: "push", title: t("Votre panier vous attend 🛒", "Your cart is waiting 🛒"), body: t("Finalisez votre commande en un geste.", "Complete your order in one tap."), in_app: true }], no: [] },
      { type: "send_window", days: [1, 2, 3, 4, 5, 6, 7], start_hour: 9, end_hour: 21 },
      email(t("Vous avez oublié quelque chose…", "You left something behind…"), t("Votre panier est toujours là", "Your cart is still here"), [t("Bonne nouvelle : on l'a gardé de côté pour vous.", "Good news: we kept it aside for you.")], t("Reprendre mon panier", "Back to my cart"), "{{event.checkout_url|https://exemple.fr}}"),
      days(1),
      { type: "exit_if", condition: "ordered" },
      email(t("-10 % pour finaliser votre commande", "10% off to complete your order"), t("Un dernier coup de pouce", "One last nudge"), [t("Code <strong>PANIER10</strong>, valable 48 h.", "Code <strong>CART10</strong>, valid for 48 h.")], t("Finaliser ma commande", "Complete my order"), "{{event.checkout_url|https://exemple.fr}}"),
    ],
  },
  {
    id: "produit-vu",
    icon: Eye,
    name: t("Produit consulté sans achat", "Viewed, not bought"),
    pitch: t("Il a regardé un produit sans l'acheter : 2 h après, un email avec la photo, le prix et un lien direct. S'arrête dès qu'il commande.", "They looked at a product without buying: 2 h later, an email with the photo, price and a direct link. Stops as soon as they order."),
    tags: [t("Suivi du site", "Site tracking"), t("Arrêt si achat", "Stop on purchase")],
    trigger: "product_viewed",
    trigger_config: { hours: 2 },
    steps: [
      { type: "send_window", days: [1, 2, 3, 4, 5, 6, 7], start_hour: 9, end_hour: 21 },
      email(
        t("Toujours tenté(e) par {{event.product}} ?", "Still thinking about {{event.product}}?"),
        "{{event.product}}",
        [
          `<img src="{{event.image|https://exemple.fr/produit.jpg}}" alt="{{event.product}}" width="480" style="display:block;max-width:100%;height:auto;border-radius:16px;margin:0 0 16px;">`,
          t("Vous l'avez regardé de près : il vous attend toujours, à {{event.price}} €.", "You took a close look: it's still waiting for you, at {{event.price}}."),
        ],
        t("Revoir le produit", "See the product"),
        "{{event.url|https://exemple.fr}}",
      ),
      days(2),
      { type: "exit_if", condition: "ordered" },
      email(t("Il part vite…", "It's going fast…"), t("Dernière chance de le revoir", "Last chance to see it again"), [t("Les stocks bougent : réservez le vôtre avant qu'il ne parte.", "Stock moves fast: grab yours before it's gone.")], t("Je le veux", "I want it"), "{{event.url|https://exemple.fr}}"),
    ],
  },
  {
    id: "page-tarifs",
    icon: Globe,
    name: t("Visite de la page Tarifs", "Pricing page visit"),
    pitch: t("Un client ouvre votre page Tarifs ou Réservation sans aller au bout : email le lendemain, et votre équipe est prévenue.", "A customer opens your Pricing or Booking page without going through: email the next day, and your team is alerted."),
    tags: [t("Suivi du site", "Site tracking"), t("Alerte équipe", "Team alert")],
    trigger: "page_visited",
    trigger_config: { url_contains: "/tarifs" },
    steps: [
      { type: "notify", to: "", subject: t("{{first_name|Un client}} regarde vos tarifs", "{{first_name|A customer}} is looking at your pricing"), message: t("{{email}} vient d'ouvrir {{event.url}}.", "{{email}} just opened {{event.url}}.") },
      days(1),
      { type: "exit_if", condition: "ordered" },
      email(t("Une question sur nos tarifs ?", "Any question about pricing?"), t("On vous aide à choisir ?", "Can we help you choose?"), [t("Vous avez regardé nos offres : répondez simplement à cet email, on vous conseille en deux minutes.", "You looked at our plans: just reply to this email, we'll advise you in two minutes.")], t("Voir les tarifs", "See pricing"), "{{event.url|https://exemple.fr}}"),
    ],
  },
  {
    id: "avis",
    icon: PackageCheck,
    name: t("Avis après livraison", "Review after delivery"),
    pitch: t("7 jours après l'expédition, on demande un avis. Ceux qui cliquent reçoivent le tag « ambassadeur ».", "7 days after shipping, ask for a review. Those who click get the “ambassador” tag."),
    tags: [t("Tag", "Tag"), t("Si / sinon", "If / else")],
    trigger: "order_fulfilled",
    steps: [
      days(7),
      email(t("Alors, ça vous plaît ?", "So, do you like it?"), t("Votre avis compte", "Your opinion matters"), [t("Deux minutes pour nous dire ce que vous en pensez ? Ça aide énormément.", "Two minutes to tell us what you think? It helps a lot.")], t("Laisser un avis", "Leave a review")),
      days(3),
      { type: "branch", condition: { type: "email_clicked" }, yes: [{ type: "tag", action: "add", tag: "ambassadeur" }], no: [] },
    ],
  },
  {
    id: "anniversaire",
    icon: CalendarHeart,
    name: t("Anniversaire du client", "Customer birthday"),
    pitch: t("Le jour J, un email avec un cadeau (et une notification s'il a l'app).", "On the day, an email with a gift (and a notification if they have the app)."),
    tags: [t("Date", "Date"), "Push"],
    trigger: "date_anniversary",
    trigger_config: { field: "birthday", days_before: 0 },
    steps: [
      { type: "send_window", days: [1, 2, 3, 4, 5, 6, 7], start_hour: 9, end_hour: 12 },
      email(t("Joyeux anniversaire {{first_name|}} 🎂", "Happy birthday {{first_name|}} 🎂"), t("Joyeux anniversaire !", "Happy birthday!"), [t("Pour fêter ça, -15 % sur tout le site avec le code <strong>ANNIV15</strong>, toute la semaine.", "To celebrate, 15% off everything with code <strong>BDAY15</strong>, all week.")], t("Choisir mon cadeau", "Pick my gift")),
      { type: "push", title: t("Joyeux anniversaire 🎂", "Happy birthday 🎂"), body: t("Un cadeau vous attend dans vos emails.", "A gift is waiting in your inbox."), in_app: true },
    ],
  },
  {
    id: "reactivation",
    icon: Hourglass,
    name: t("Réactivation des inactifs", "Win back inactive customers"),
    pitch: t("Après 90 jours sans commande : « vous nous manquez », puis une offre, puis le tag « inactif » si rien ne bouge.", "After 90 days without an order: “we miss you”, then an offer, then the “inactive” tag if nothing happens."),
    tags: [t("Inactivité", "Inactivity"), t("Tag", "Tag")],
    trigger: "inactive",
    trigger_config: { days: 90 },
    steps: [
      email(t("{{first_name|}}, vous nous manquez", "{{first_name|}}, we miss you"), t("Ça fait longtemps !", "It's been a while!"), [t("Voici ce qui a changé depuis votre dernière visite.", "Here's what's new since your last visit.")], t("Voir les nouveautés", "See what's new")),
      days(7),
      { type: "exit_if", condition: "ordered" },
      email(t("-15 % pour votre retour", "15% off to welcome you back"), t("Revenez, on vous gâte", "Come back, it's on us"), [t("Code <strong>RETOUR15</strong>, valable 10 jours.", "Code <strong>BACK15</strong>, valid for 10 days.")], t("En profiter", "Use it")),
      days(14),
      { type: "exit_if", condition: "ordered" },
      { type: "tag", action: "add", tag: "inactif" },
    ],
  },
  {
    id: "vip",
    icon: Crown,
    name: t("Clients VIP", "VIP customers"),
    pitch: t("À chaque commande : si le client a dépensé 300 € ou plus, tag VIP, alerte à l'équipe et remerciement spécial.", "On every order: if the customer spent €300 or more, VIP tag, team alert and a special thank-you."),
    tags: [t("Si / sinon", "If / else"), t("Alerte équipe", "Team alert")],
    trigger: "order_created",
    steps: [
      {
        type: "branch",
        condition: { type: "total_spent", min: 300 },
        yes: [
          { type: "tag", action: "add", tag: "vip" },
          { type: "notify", subject: t("Nouveau client VIP : {{first_name}} {{last_name}}", "New VIP customer: {{first_name}} {{last_name}}"), message: t("Pensez à un petit mot dans son prochain colis.", "Consider a handwritten note in their next parcel.") },
          email(t("Merci {{first_name|}}, vous êtes VIP ✨", "Thank you {{first_name|}}, you're a VIP ✨"), t("Bienvenue au club VIP", "Welcome to the VIP club"), [t("Livraison offerte et accès en avant-première, à vie.", "Free shipping and early access, for life.")], t("Découvrir mes avantages", "See my perks")),
        ],
        no: [],
      },
    ],
  },
  {
    id: "reservation",
    icon: CalendarClock,
    name: t("Rappel de réservation / rendez-vous", "Booking / appointment reminder"),
    pitch: t("Confirmation immédiate, alerte à l'équipe, rappel 24 h avant, puis demande d'avis le lendemain.", "Instant confirmation, team alert, reminder 24 h before, then a review request the day after."),
    tags: [t("Avant la date", "Before the date"), t("Alerte équipe", "Team alert")],
    trigger: "event",
    trigger_config: { event: "reservation" },
    steps: [
      email(t("Réservation confirmée : {{event.date}}", "Booking confirmed: {{event.date}}"), t("C'est noté, {{first_name|}} !", "You're booked, {{first_name|}}!"), [t("Nous vous attendons {{event.date}}.", "We look forward to seeing you {{event.date}}.")], t("Gérer ma réservation", "Manage my booking")),
      { type: "notify", subject: t("Nouvelle réservation : {{first_name}} {{last_name}}, {{event.date}}", "New booking: {{first_name}} {{last_name}}, {{event.date}}") },
      { type: "wait_until", hours: 24, direction: "before" },
      email(t("C'est demain !", "See you tomorrow!"), t("À demain {{first_name|}}", "See you tomorrow {{first_name|}}"), [t("Petit rappel : {{event.date}}. Un empêchement ? Prévenez-nous.", "Quick reminder: {{event.date}}. Can't make it? Let us know.")], t("Voir ma réservation", "View my booking")),
      { type: "wait_until", hours: 20, direction: "after" },
      email(t("Merci de votre visite", "Thanks for your visit"), t("Ça s'est bien passé ?", "How was it?"), [t("Votre avis aide les autres clients à nous découvrir.", "Your review helps others discover us.")], t("Laisser un avis", "Leave a review")),
    ],
  },
  {
    id: "reachat",
    icon: Repeat,
    name: t("Après-achat et réassort", "Post-purchase and restock"),
    pitch: t("Conseils d'utilisation 3 jours après la commande, puis rappel de réassort 30 jours plus tard s'il n'a pas recommandé.", "Usage tips 3 days after ordering, then a restock reminder 30 days later if they haven't reordered."),
    tags: [t("Arrêt si achat", "Stop on purchase")],
    trigger: "order_created",
    steps: [
      days(3),
      email(t("Nos conseils pour bien en profiter", "Our tips to make the most of it"), t("Bien démarrer", "Getting started"), [t("3 astuces de nos clients les plus fidèles.", "3 tips from our most loyal customers.")], t("Lire les conseils", "Read the tips")),
      days(30),
      { type: "exit_if", condition: "ordered" },
      email(t("Bientôt à court ?", "Running low?"), t("C'est peut-être le moment", "Might be time"), [t("Recommandez en un clic, livraison en 48 h.", "Reorder in one click, delivered in 48 h.")], t("Recommander", "Reorder")),
    ],
  },
  {
    id: "clic",
    icon: MousePointerClick,
    name: t("Intérêt pour une offre", "Interest in an offer"),
    pitch: t("Quand un client clique sur une promo sans acheter : relance 1 jour après, et votre équipe est prévenue via Zapier ou Slack.", "When a customer clicks a promo without buying: follow-up a day later, and your team is notified via Zapier or Slack."),
    tags: [t("Clic", "Click"), "Webhook"],
    trigger: "email_clicked",
    trigger_config: { url_contains: "promo" },
    steps: [
      days(1),
      { type: "exit_if", condition: "ordered" },
      email(t("Une question sur l'offre ?", "Any question about the offer?"), t("On peut vous aider ?", "Can we help?"), [t("Vous avez regardé notre offre : répondez simplement à cet email, on vous répond dans la journée.", "You checked out our offer: just reply to this email and we'll get back to you today.")], t("Revoir l'offre", "See the offer again")),
    ],
  },
];

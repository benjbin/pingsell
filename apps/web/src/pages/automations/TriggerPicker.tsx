import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, Code2, Globe, Smartphone, Store, Users, type LucideIcon } from "lucide-react";
import { SITE_ACTION_KINDS, TRIGGERS, siteLabel } from "../../lib/constants";
import { cx } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AutomationSources, AutomationTrigger, Segment, SiteActionKind, WebSite } from "../../lib/types";

/** Ce qu'il manque pour qu'un déclencheur parte, et où le brancher. */
export interface Readiness {
  ready: boolean;
  why?: string;
  fix?: { to: string; label: string };
}

interface Ctx {
  sources: AutomationSources | null | undefined;
  sites: WebSite[] | undefined;
  eventNames: Array<{ name: string }> | null | undefined;
}

const SHOP_FIX = { to: "/integrations?outil=boutique", label: t("Brancher ma boutique", "Connect my shop") };
const SITE_FIX = { to: "/integrations?outil=suivi", label: t("Coller la ligne Pingsell sur mon site", "Paste the Pingsell line on my site") };
const API_FIX = { to: "/integrations?outil=site", label: t("Voir le guide Site sur mesure", "See the Custom website guide") };
const APP_FIX = { to: "/integrations?outil=app", label: t("Brancher mon app", "Connect my app") };

/** Le nom de ce qui est branché côté boutique : « Shopify », « WordPress · boutique.fr »… */
export function shopName(s: AutomationSources | null | undefined): string {
  if (!s) return "";
  return [s.shopify ? "Shopify" : "", ...s.plugins].filter(Boolean).join(", ");
}

export function readinessOf(tr: AutomationTrigger, { sources: s, sites, eventNames }: Ctx): Readiness {
  // Tant que rien n'est chargé, on ne crie pas au loup.
  if (!s || !sites) return { ready: true };
  const shop = s.shopify || s.plugins.length > 0;
  const noShop = t(
    "aucune boutique n'est branchée et Pingsell n'a jamais reçu de commande. Ce déclencheur sert aux sites qui vendent en ligne.",
    "no shop is connected and Pingsell has never received an order. This trigger is for sites that sell online.",
  );
  switch (tr) {
    case "order_created":
      return shop || s.orders > 0 ? { ready: true } : { ready: false, why: noShop, fix: SHOP_FIX };
    case "inactive":
      return shop || s.orders > 0
        ? { ready: true }
        : { ready: false, why: t("il se base sur les commandes, et Pingsell n'en a jamais reçu.", "it relies on orders, and Pingsell has never received any."), fix: SHOP_FIX };
    case "cart_abandoned":
      return shop || s.carts > 0
        ? { ready: true }
        : {
            ready: false,
            why: t("aucune boutique n'est branchée et Pingsell n'a jamais reçu de panier. Ce déclencheur sert aux sites qui vendent en ligne.", "no shop is connected and Pingsell has never received a cart. This trigger is for sites that sell online."),
            fix: SHOP_FIX,
          };
    case "order_fulfilled":
      return shop || s.fulfilled > 0
        ? { ready: true }
        : {
            ready: false,
            why: t("aucune boutique n'est branchée et Pingsell n'a jamais reçu d'expédition. Ce déclencheur sert aux sites qui vendent en ligne.", "no shop is connected and Pingsell has never received a shipment. This trigger is for sites that sell online."),
            fix: SHOP_FIX,
          };
    case "site_action":
    case "page_visited":
      return sites.length > 0
        ? { ready: true }
        : { ready: false, why: t("la ligne Pingsell n'a encore été vue sur aucun de vos sites.", "the Pingsell line hasn't been seen on any of your sites yet."), fix: SITE_FIX };
    case "product_viewed":
      if (sites.length === 0) return { ready: false, why: t("la ligne Pingsell n'a encore été vue sur aucun de vos sites.", "the Pingsell line hasn't been seen on any of your sites yet."), fix: SITE_FIX };
      return s.products_seen > 0
        ? { ready: true }
        : {
            ready: false,
            why: t(
              "aucune fiche produit (avec un prix) n'a été vue sur vos sites. Ce déclencheur sert aux boutiques en ligne.",
              "no product page (with a price) has been seen on your sites. This trigger is for online shops.",
            ),
          };
    case "event":
      return (eventNames?.length ?? 0) > 0
        ? { ready: true }
        : {
            ready: false,
            why: t(
              "votre site n'a encore envoyé aucun événement. Il faut qu'un développeur ajoute un appel dans son code.",
              "your site hasn't sent any event yet. A developer needs to add a call to its code.",
            ),
            fix: API_FIX,
          };
    case "app_signed_in":
      return s.app_users > 0
        ? { ready: true }
        : { ready: false, why: t("aucune app mobile n'est reliée à Pingsell.", "no mobile app is linked to Pingsell."), fix: APP_FIX };
    case "push_subscribed":
      return s.push_devices > 0 || s.app_users > 0
        ? { ready: true }
        : { ready: false, why: t("aucune app mobile n'est reliée à Pingsell.", "no mobile app is linked to Pingsell."), fix: APP_FIX };
    case "segment_entered":
      return s.segments > 0
        ? { ready: true }
        : { ready: false, why: t("vous n'avez encore créé aucun segment.", "you haven't created any segment yet."), fix: { to: "/segments", label: t("Créer un segment", "Create a segment") } };
    default:
      // Nouveau contact, tag, date, clic dans un email : marchent avec n'importe quel compte.
      return { ready: true };
  }
}

interface Group {
  id: string;
  icon: LucideIcon;
  title: string;
  triggers: AutomationTrigger[];
}

const GROUPS: Group[] = [
  { id: "site", icon: Globe, title: t("Votre site", "Your site"), triggers: ["site_action", "page_visited", "product_viewed"] },
  { id: "shop", icon: Store, title: t("Votre boutique en ligne", "Your online shop"), triggers: ["order_created", "cart_abandoned", "order_fulfilled", "inactive"] },
  { id: "api", icon: Code2, title: t("Votre site, via votre développeur", "Your site, through your developer"), triggers: ["event"] },
  { id: "contacts", icon: Users, title: t("Vos contacts et vos emails", "Your contacts and emails"), triggers: ["contact_created", "tag_added", "segment_entered", "date_anniversary", "email_clicked"] },
  { id: "app", icon: Smartphone, title: t("Votre app mobile", "Your mobile app"), triggers: ["app_signed_in", "push_subscribed"] },
];

/** Libellés plus parlants dans le sélecteur que les noms courts des listes. */
const PICK_LABEL: Partial<Record<AutomationTrigger, string>> = {
  site_action: t("Un formulaire ou une action sur le site", "A form or an action on the site"),
};

function groupStatus(g: Group, ctx: Ctx): { ok: boolean; text: string; fix?: Readiness["fix"] } {
  const s = ctx.sources;
  if (!s || !ctx.sites) return { ok: true, text: "" };
  if (g.id === "site") {
    if (ctx.sites.length === 0) return { ok: false, text: t("Aucun site repéré", "No site spotted"), fix: SITE_FIX };
    const forms = ctx.sites.reduce((n, site) => n + site.actions.length, 0);
    const names = ctx.sites.map(siteLabel).join(", ");
    return { ok: true, text: forms ? t(`${names} · ${forms} formulaire${forms > 1 ? "s" : ""} repéré${forms > 1 ? "s" : ""}`, `${names} · ${forms} form${forms > 1 ? "s" : ""} spotted`) : names };
  }
  if (g.id === "shop") {
    const name = shopName(s);
    if (name) return { ok: true, text: t(`Branchée : ${name}`, `Connected: ${name}`) };
    if (s.orders > 0) return { ok: true, text: t(`${s.orders} commande${s.orders > 1 ? "s" : ""} reçue${s.orders > 1 ? "s" : ""} par l'API`, `${s.orders} order${s.orders > 1 ? "s" : ""} received through the API`) };
    return { ok: false, text: t("Aucune boutique branchée", "No shop connected"), fix: SHOP_FIX };
  }
  if (g.id === "api") {
    const n = ctx.eventNames?.length ?? 0;
    return n ? { ok: true, text: t(`${n} événement${n > 1 ? "s" : ""} déjà reçu${n > 1 ? "s" : ""}`, `${n} event${n > 1 ? "s" : ""} already received`) } : { ok: false, text: t("Rien reçu pour l'instant", "Nothing received yet"), fix: API_FIX };
  }
  if (g.id === "app") return s.app_users || s.push_devices ? { ok: true, text: t("App reliée", "App linked") } : { ok: false, text: t("Aucune app reliée", "No app linked"), fix: APP_FIX };
  return { ok: true, text: t("Toujours disponible", "Always available") };
}

export function TriggerPicker({ value, onPick, icons, ...ctx }: Ctx & { value: AutomationTrigger; onPick: (tr: AutomationTrigger) => void; icons: Record<AutomationTrigger, LucideIcon> }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t(
          "D'où part l'automatisation ? Chaque déclencheur indique s'il peut partir avec ce qui est branché sur votre compte.",
          "Where does the automation start? Each trigger shows whether it can fire with what's connected to your account.",
        )}
      </p>
      {GROUPS.map((g) => {
        const st = groupStatus(g, ctx);
        return (
          <section key={g.id}>
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <g.icon className="size-4 text-slate-500" />
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{g.title}</h4>
              {st.text && (
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    st.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                  )}
                >
                  {st.text}
                </span>
              )}
              {!st.ok && st.fix && (
                <Link to={st.fix.to} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                  {st.fix.label} →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {g.triggers.map((tr) => {
                const Icon = icons[tr];
                const active = tr === value;
                const r = readinessOf(tr, ctx);
                return (
                  <button
                    key={tr}
                    type="button"
                    onClick={() => onPick(tr)}
                    className={cx(
                      "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition",
                      active
                        ? "bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-900/30"
                        : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50",
                      !r.ready && !active && "opacity-60",
                    )}
                  >
                    <Icon className={cx("mt-0.5 size-5 shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{PICK_LABEL[tr] ?? TRIGGERS[tr].label}</span>
                        {!r.ready && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {t("Pas branché", "Not connected")}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{TRIGGERS[tr].description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Sous le choix : pourquoi le déclencheur choisi ne partira pas encore, et où le brancher. */
export function NotReadyNotice({ readiness }: { readiness: Readiness }) {
  if (readiness.ready) return null;
  return (
    <div className="mt-4 flex gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">{t("Ce déclencheur ne partira pas pour l'instant : ", "This trigger won't fire for now: ")}</span>
        {readiness.why}{" "}
        {readiness.fix && (
          <Link to={readiness.fix.to} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            {readiness.fix.label} →
          </Link>
        )}
      </p>
    </div>
  );
}

/** Ce que fait la personne, en verbe : « crée un compte », « envoie un formulaire de contact »… */
const DOES: Record<SiteActionKind, string> = {
  signup: t("crée un compte", "creates an account"),
  login: t("se connecte", "signs in"),
  newsletter: t("s'inscrit à la newsletter", "signs up to the newsletter"),
  contact: t("envoie un formulaire de contact", "sends a contact form"),
  form: t("envoie un formulaire", "sends a form"),
};

const q = (v: string) => t(`« ${v} »`, `“${v}”`);

/** « En clair » : la phrase qui dit exactement ce qui fera démarrer l'automatisation. */
export function triggerSentence(
  tr: AutomationTrigger,
  cfg: Record<string, unknown>,
  extra: { tag: string; eventName: string; sources: AutomationSources | null | undefined; sites: WebSite[] | undefined; segments: Segment[] },
): string {
  const str = (k: string) => (typeof cfg[k] === "string" ? (cfg[k] as string).trim() : "");
  const host = str("host");
  const site = host ? (extra.sites?.find((s) => s.host === host) ? siteLabel(extra.sites.find((s) => s.host === host)!) : host) : "";
  const onSite = site ? t(`sur ${site}`, `on ${site}`) : t("sur n'importe lequel de vos sites", "on any of your sites");
  const shop = shopName(extra.sources);
  const fromShop = shop ? t(` (${shop})`, ` (${shop})`) : "";
  switch (tr) {
    case "site_action": {
      const action = (SITE_ACTION_KINDS.includes(cfg.action as SiteActionKind) ? cfg.action : "signup") as SiteActionKind;
      const form = str("form");
      const label = str("form_label");
      const what = form ? t(`envoie le formulaire ${label ? q(label) : q(form)}`, `sends the form ${label ? q(label) : q(form)}`) : DOES[action];
      return t(`Démarre quand quelqu'un ${what} ${onSite}.`, `Starts when someone ${what} ${onSite}.`);
    }
    case "page_visited": {
      const url = str("url_contains");
      return t(
        `Démarre quand un contact déjà connu ouvre ${url ? `une page contenant ${q(url)}` : "une page"} ${onSite} (une fois par jour au plus).`,
        `Starts when a known contact opens ${url ? `a page containing ${q(url)}` : "a page"} ${onSite} (at most once a day).`,
      );
    }
    case "product_viewed":
      return t(`Démarre quand un contact regarde un produit ${onSite} sans l'acheter dans les ${Number(cfg.hours ?? 2)} h.`, `Starts when a contact views a product ${onSite} without buying it within ${Number(cfg.hours ?? 2)} h.`);
    case "order_created": {
      const min = Number(cfg.min_total ?? 0);
      return t(`Démarre à chaque commande reçue de votre boutique${fromShop}${min > 0 ? ` d'au moins ${min} €` : ""}.`, `Starts with every order from your shop${fromShop}${min > 0 ? ` of at least €${min}` : ""}.`);
    }
    case "cart_abandoned":
      return t(`Démarre quand un panier de votre boutique${fromShop} reste 1 h sans commande.`, `Starts when a cart in your shop${fromShop} goes 1 hour without an order.`);
    case "order_fulfilled":
      return t(`Démarre quand une commande de votre boutique${fromShop} est expédiée.`, `Starts when an order from your shop${fromShop} ships.`);
    case "inactive":
      return t(`Démarre quand un client n'a rien commandé depuis ${Number(cfg.days ?? 90)} jours.`, `Starts when a customer hasn't ordered for ${Number(cfg.days ?? 90)} days.`);
    case "event":
      return extra.eventName.trim()
        ? t(`Démarre quand votre site envoie l'événement ${q(extra.eventName.trim())}.`, `Starts when your site sends the event ${q(extra.eventName.trim())}.`)
        : t("Démarre quand votre site envoie l'événement que vous indiquez ci-dessous.", "Starts when your site sends the event you enter below.");
    case "contact_created":
      return t("Démarre pour chaque nouveau contact : formulaire, import, API ou boutique.", "Starts for every new contact: form, import, API or shop.");
    case "tag_added":
      return extra.tag.trim() ? t(`Démarre quand le tag ${q(extra.tag.trim())} est ajouté à un contact.`, `Starts when the tag ${q(extra.tag.trim())} is added to a contact.`) : t("Démarre quand le tag indiqué ci-dessous est ajouté à un contact.", "Starts when the tag below is added to a contact.");
    case "segment_entered": {
      const sg = extra.segments.find((x) => x.id === str("segment_id"));
      return sg ? t(`Démarre quand un contact entre dans le segment ${q(sg.name)}.`, `Starts when a contact enters the segment ${q(sg.name)}.`) : t("Démarre quand un contact entre dans le segment choisi ci-dessous.", "Starts when a contact enters the segment chosen below.");
    }
    case "date_anniversary":
      return t("Démarre chaque année à la date choisie de la fiche du contact.", "Starts every year on the chosen date of the contact's record.");
    case "email_clicked": {
      const url = str("url_contains");
      return t(`Démarre quand un contact clique ${url ? `un lien contenant ${q(url)}` : "un lien"} dans un de vos emails.`, `Starts when a contact clicks ${url ? `a link containing ${q(url)}` : "a link"} in one of your emails.`);
    }
    case "app_signed_in":
      return t("Démarre la première fois qu'un client se connecte dans votre app.", "Starts the first time a customer signs in to your app.");
    case "push_subscribed":
      return t("Démarre quand un client active les notifications de votre app.", "Starts when a customer turns on your app's notifications.");
  }
}

/** Le bandeau « En clair », en haut du déclencheur. */
export function TriggerSentence({ text }: { text: string }) {
  return (
    <p className="mb-4 flex gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white dark:bg-white/10">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
      <span>
        <span className="font-semibold">{t("En clair : ", "In short: ")}</span>
        {text}
      </span>
    </p>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Activity, Blocks, Download, Eye, FormInput, Globe, KeyRound, MousePointerClick, RefreshCw, ShieldCheck, UserRoundPlus, Webhook } from "lucide-react";
import { API_URL, api } from "../../lib/api";
import type { InboundLastCall, InboundSettings } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { cx, formatDateTime } from "../../lib/format";
import { t, LOCALE } from "../../lib/i18n";
import { Button, Field, Input } from "../ui/primitives";
import { ConfirmModal } from "../ui/Overlay";
import { CopyButton } from "../CopyButton";
import { useToast } from "../ui/Toast";
import { SitesPanel } from "./Sites";
import { Code, GuideHead, Hint, Kbd, Step, Steps, Tabs, Waiting, usePoll, type GuideProps } from "./ConnectGuides";

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

const SOURCE_LABELS: Record<string, string> = {
  woocommerce: "WooCommerce",
  webflow: "Webflow",
  framer: "Framer",
  wix: "Wix",
  tally: "Tally",
  typeform: "Typeform",
  wordpress: "WordPress",
  "wordpress-form": t("Formulaire WordPress", "WordPress form"),
  prestashop: "PrestaShop",
  webhook: "Webhook",
  formulaire: t("Formulaire", "Form"),
};

function CopyLine({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <code className={cx("min-w-0 flex-1 truncate text-xs text-slate-900 dark:text-white", mono && "font-mono")}>{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

/** « Dernier appel : Framer, le 18/11 à 15:42 — inscription ✓ » */
function LastCall({ call }: { call: InboundLastCall }) {
  if (!call.last_used_at) return null;
  const source = SOURCE_LABELS[call.last_source ?? ""] ?? call.last_source ?? "";
  const r = call.last_result;
  const detail = r?.ignored
    ? r.reason === "test"
      ? t("appel de test, rien à faire", "test call, nothing to do")
      : t("aucune adresse email trouvée dans les données", "no email address found in the data")
    : (r?.results ?? []).map((x) => (x.ok ? `${x.event} ✓` : `${x.event} : ${x.error}`)).join(" · ");
  const failed = r?.results?.some((x) => !x.ok) || (r?.ignored && r.reason !== "test");
  return (
    <p className={cx("rounded-2xl px-4 py-3 text-sm", failed ? "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200" : "bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300")}>
      <span className="font-semibold">{t("Dernier appel reçu", "Last call received")}</span> : {source}, {formatDateTime(call.last_used_at)}
      {detail && <> — {detail}</>}
    </p>
  );
}

/** Polls the inbound settings until `pick` reports a new call. */
function useNewCall(settings: InboundSettings | null, pick: (s: InboundSettings) => InboundLastCall, active: boolean) {
  const start = useRef<number | null>(null);
  if (settings && start.current === null) start.current = pick(settings).uses;
  const [latest, setLatest] = useState<InboundSettings | null>(null);
  const hit = usePoll(active && !!settings, async () => {
    const s = await api.inbound.get();
    setLatest(s);
    return pick(s).uses > (start.current ?? 0);
  });
  return { hit, latest };
}

/* -------------------------------------------------------------------------- */
/* WordPress / WooCommerce and PrestaShop extensions                           */
/* -------------------------------------------------------------------------- */

const PLUGINS = {
  wordpress: {
    title: "WordPress & WooCommerce",
    zip: "/downloads/pingsell-wordpress.zip",
    intro: t(
      "L'extension Pingsell envoie toute seule les nouveaux comptes, les paniers abandonnés (même ceux des visiteurs non connectés), les commandes, les expéditions avec leur numéro de suivi et vos formulaires (Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent Forms).",
      "The Pingsell plugin automatically sends new accounts, abandoned carts (even from guests), orders, shipments with their tracking number and your forms (Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent Forms).",
    ),
    install: t(
      <>Dans WordPress : <Kbd>Extensions › Ajouter une extension › Téléverser une extension</Kbd>, choisissez le fichier, puis <Kbd>Installer maintenant</Kbd> et <Kbd>Activer l’extension</Kbd>.</>,
      <>In WordPress: <Kbd>Plugins › Add New Plugin › Upload Plugin</Kbd>, choose the file, then <Kbd>Install Now</Kbd> and <Kbd>Activate Plugin</Kbd>.</>,
    ),
    settings: t(<>Ouvrez <Kbd>Réglages › Pingsell</Kbd> et collez ces deux valeurs, puis <Kbd>Enregistrer</Kbd> et <Kbd>Tester la connexion</Kbd>.</>, <>Open <Kbd>Settings › Pingsell</Kbd>, paste these two values, then <Kbd>Save</Kbd> and <Kbd>Test connection</Kbd>.</>),
    extra: t(
      <>Formulaire d'inscription : ajoutez le code court <code>[pingsell_form]</code> dans n'importe quelle page (options <code>title</code>, <code>button</code>, <code>tags</code>, <code>fields="first_name,email"</code>).</>,
      <>Sign-up form: add the <code>[pingsell_form]</code> shortcode to any page (options <code>title</code>, <code>button</code>, <code>tags</code>, <code>fields="first_name,email"</code>).</>,
    ),
  },
  prestashop: {
    title: "PrestaShop",
    zip: "/downloads/pingsell-prestashop.zip",
    intro: t(
      "Le module Pingsell (PrestaShop 1.7, 8 et 9) envoie tout seul les nouveaux comptes, les inscriptions à la newsletter, les paniers abandonnés, les commandes et les expéditions avec le lien de suivi du transporteur.",
      "The Pingsell module (PrestaShop 1.7, 8 and 9) automatically sends new accounts, newsletter sign-ups, abandoned carts, orders and shipments with the carrier's tracking link.",
    ),
    install: t(
      <>Dans PrestaShop : <Kbd>Modules › Gestionnaire de modules › Installer un module</Kbd>, déposez le fichier, puis <Kbd>Configurer</Kbd>.</>,
      <>In PrestaShop: <Kbd>Modules › Module Manager › Upload a module</Kbd>, drop the file, then <Kbd>Configure</Kbd>.</>,
    ),
    settings: t(<>Collez ces deux valeurs dans la page du module, puis <Kbd>Enregistrer et tester</Kbd>.</>, <>Paste these two values on the module's page, then <Kbd>Save and test</Kbd>.</>),
    extra: t(
      <>Formulaire d'inscription : activez « Formulaire d'inscription Pingsell au-dessus du pied de page » dans le module.</>,
      <>Sign-up form: turn on “Pingsell sign-up form above the footer” in the module.</>,
    ),
  },
} as const;

export type PluginId = keyof typeof PLUGINS;

export function PluginGuide({ platform, done, onDone, onNoPlugin }: GuideProps & { platform: PluginId; onNoPlugin?: () => void }) {
  const toast = useToast();
  const meta = PLUGINS[platform];
  const store = `missive_api_key_${platform}`;
  const [key, setKey] = useState<{ id: string; key: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem(store);
      return raw ? (JSON.parse(raw) as { id: string; key: string }) : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);

  const received = usePoll(!!key && !done, async () => {
    const keys = await api.apiKeys.list();
    return !!keys.find((k) => k.id === key?.id)?.last_used_at;
  });
  useEffect(() => {
    if (received) onDone(t(`${meta.title} est relié à Pingsell. Les prochains clients arriveront dans Contacts.`, `${meta.title} is connected to Pingsell. New customers will show up in Contacts.`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  async function generate() {
    setBusy(true);
    try {
      const created = await api.apiKeys.create(meta.title);
      if (created.key) {
        const k = { id: created.id, key: created.key };
        setKey(k);
        try {
          sessionStorage.setItem(store, JSON.stringify(k));
        } catch {
          /* private mode */
        }
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <GuideHead icon={Blocks} title={meta.title} text={meta.intro} done={done || undefined} />
      <Steps>
        <Step n={1} title={t("Téléchargez l'extension", "Download the plugin")}>
          <a
            href={meta.zip}
            download
            className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Download className="size-4" /> {meta.zip.split("/").pop()}
          </a>
        </Step>
        <Step n={2} title={t("Installez-la", "Install it")}>
          <p>{meta.install}</p>
        </Step>
        <Step n={3} title={t("Reliez-la à votre compte", "Link it to your account")} done={!!key}>
          <p>{meta.settings}</p>
          <Field label={t("Adresse de l'API", "API address")}>
            <CopyLine value={API_URL} />
          </Field>
          <Field label={t("Clé API", "API key")}>
            {key ? (
              <CopyLine value={key.key} />
            ) : (
              <Button icon={KeyRound} loading={busy} onClick={() => void generate()}>
                {t("Générer ma clé API", "Generate my API key")}
              </Button>
            )}
          </Field>
          {key && <p className="text-xs text-slate-500">{t("Copiez-la maintenant : elle ne sera plus affichée en entier.", "Copy it now: it won't be shown in full again.")}</p>}
        </Step>
        <Step n={4} title={t("Testez la connexion", "Test the connection")} done={!!done} last>
          {done ? (
            <p>{meta.extra}</p>
          ) : key ? (
            <Waiting>{t("Cliquez sur « Tester la connexion » dans l'extension : on vous confirme ici dès que Pingsell reçoit l'appel.", "Click “Test connection” in the plugin and we'll confirm here as soon as Pingsell receives the call.")}</Waiting>
          ) : (
            <p>{t("Générez la clé à l'étape 3 : on détectera la connexion en direct, ici.", "Generate the key in step 3 and we'll detect the connection live, right here.")}</p>
          )}
        </Step>
      </Steps>
      {platform === "wordpress" && onNoPlugin && (
        <p className="mt-7 border-t border-slate-900/10 pt-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          {t("Vous ne pouvez pas installer d'extension (hébergement géré, WordPress.com) ? ", "Can't install plugins (managed hosting, WordPress.com)? ")}
          <button type="button" onClick={onNoPlugin} className="font-semibold text-brand-500 hover:text-brand-600">
            {t("Utilisez les webhooks WooCommerce", "Use WooCommerce webhooks")}
          </button>
          .
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Universal webhook: Framer, Webflow, Wix, Squarespace, WooCommerce, Tally…   */
/* -------------------------------------------------------------------------- */

export type NoCodeTab = "framer" | "webflow" | "wix" | "squarespace" | "woocommerce" | "forms" | "other";

const NOCODE_TABS: Array<{ id: NoCodeTab; label: string }> = [
  { id: "framer", label: "Framer" },
  { id: "webflow", label: "Webflow" },
  { id: "wix", label: "Wix" },
  { id: "squarespace", label: "Squarespace" },
  { id: "woocommerce", label: "WooCommerce" },
  { id: "forms", label: "Tally · Typeform" },
  { id: "other", label: t("Autre outil", "Other tool") },
];

const EVENT_CHOICES = [
  { id: "inscription", label: t("Inscription / contact", "Sign-up / contact") },
  { id: "commande", label: t("Commande", "Order") },
  { id: "reservation", label: t("Réservation", "Booking") },
  { id: "rendez_vous", label: t("Rendez-vous", "Appointment") },
  { id: "devis", label: t("Demande de devis", "Quote request") },
  { id: "custom", label: t("Autre nom…", "Other name…") },
];

export function NoCodeGuide({ done, onDone, initialTab = "framer", onUseForm }: GuideProps & { initialTab?: NoCodeTab; onUseForm?: () => void }) {
  const toast = useToast();
  const data = useAsync(() => api.inbound.get(), []);
  const [tab, setTab] = useState<NoCodeTab>(initialTab);
  const [event, setEvent] = useState("inscription");
  const [custom, setCustom] = useState("");
  const [tags, setTags] = useState("");
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const settings = data.data ?? null;
  const { hit, latest } = useNewCall(settings, (s) => s.webhook, !done);
  const current = latest ?? settings;

  useEffect(() => {
    if (!hit || !latest) return;
    const src = SOURCE_LABELS[latest.webhook.last_source ?? ""] ?? latest.webhook.last_source;
    onDone(t(`Premier appel reçu (${src}). Vérifiez le contact dans Contacts : c'est branché !`, `First call received (${src}). Check the contact in Contacts: you're connected!`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit]);

  const name = event === "custom" ? custom.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : event;
  const url = useMemo(() => {
    if (!settings) return "";
    const q = new URLSearchParams();
    if (name && name !== "inscription") q.set("event", name);
    const tg = tags.split(",").map((x) => x.trim()).filter(Boolean).join(",");
    if (tg) q.set("tags", tg);
    const qs = q.toString();
    return settings.webhook.url + (qs ? `?${qs}` : "");
  }, [settings, name, tags]);

  async function rotate() {
    setRotating(true);
    try {
      await api.inbound.rotate("webhook");
      await data.reload();
      toast.success(t("Nouvelle adresse créée", "New address created"), t("L'ancienne ne fonctionne plus : collez la nouvelle dans vos outils.", "The old one no longer works: paste the new one in your tools."));
    } catch (err) {
      toast.error(err);
    } finally {
      setRotating(false);
      setConfirmRotate(false);
    }
  }

  const how: Record<NoCodeTab, ReactNode> = {
    framer: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>{t(<>Sélectionnez votre formulaire dans Framer, puis dans le panneau de droite : <Kbd>Send To › Add… › Webhook</Kbd>.</>, <>Select your form in Framer, then in the right panel: <Kbd>Send To › Add… › Webhook</Kbd>.</>)}</li>
        <li>{t("Collez l'adresse ci-dessus et publiez le site : les envois ne partent que depuis le site publié.", "Paste the address above and publish the site: submissions are only sent from the published site.")}</li>
        <li>{t("Les champs Email, Nom, Prénom, Téléphone sont reconnus quel que soit leur nom ; les autres sont gardés avec le contact.", "Email, name, first name and phone fields are recognised whatever their name; the others are kept with the contact.")}</li>
      </ol>
    ),
    webflow: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>{t(<>Dans Webflow : <Kbd>Site settings › Apps & integrations › Webhooks › Add webhook</Kbd>.</>, <>In Webflow: <Kbd>Site settings › Apps & integrations › Webhooks › Add webhook</Kbd>.</>)}</li>
        <li>{t(<>Formulaires : déclencheur <Kbd>Form submission</Kbd>. Boutique : ajoutez aussi <Kbd>New order</Kbd> et <Kbd>Order changed</Kbd> (commande et expédition, détectées automatiquement).</>, <>Forms: trigger <Kbd>Form submission</Kbd>. Store: also add <Kbd>New order</Kbd> and <Kbd>Order changed</Kbd> (order and shipment, detected automatically).</>)}</li>
        <li>{t("Collez l'adresse ci-dessus, puis publiez le site.", "Paste the address above, then publish the site.")}</li>
      </ol>
    ),
    wix: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>{t(<>Dans le tableau de bord Wix : <Kbd>Automations › + Créer une automation › Partir de zéro</Kbd>.</>, <>In the Wix dashboard: <Kbd>Automations › + Create Automation › Start from Scratch</Kbd>.</>)}</li>
        <li>{t(<>Déclencheur : <Kbd>Formulaire envoyé</Kbd> (ou <Kbd>Commande passée</Kbd>, avec « Commande » choisi ci-dessus).</>, <>Trigger: <Kbd>Form submitted</Kbd> (or <Kbd>Order placed</Kbd>, with “Order” picked above).</>)}</li>
        <li>{t(<>Action : <Kbd>Envoyer une requête HTTP</Kbd>, méthode <Kbd>POST</Kbd>, corps <Kbd>Toutes les données d’automation</Kbd>, et collez l'adresse ci-dessus.</>, <>Action: <Kbd>Send an HTTP request</Kbd>, method <Kbd>POST</Kbd>, body <Kbd>All automation data</Kbd>, and paste the address above.</>)}</li>
      </ol>
    ),
    squarespace: (
      <div className="space-y-2">
        <p>
          {t("Squarespace n'envoie pas ses formulaires vers un webhook. Deux solutions sans Zapier :", "Squarespace doesn't send its forms to a webhook. Two ways without Zapier:")}
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            {t("Inscriptions : collez le ", "Sign-ups: paste the ")}
            {onUseForm ? (
              <button type="button" onClick={onUseForm} className="font-semibold text-brand-500 hover:text-brand-600">{t("formulaire Pingsell", "Pingsell form")}</button>
            ) : (
              t("formulaire Pingsell", "Pingsell form")
            )}
            {t(" dans un bloc Code (offre Core ou supérieure).", " into a Code block (Core plan or above).")}
          </li>
          <li>{t(<>Commandes : <Kbd>Pages › Outils du site web › Injection de code</Kbd>, collez le code ci-dessous dans <Kbd>Page de statut de commande</Kbd>, et aussi dans <Kbd>Page de confirmation de commande</Kbd> si vous vendez des cartes cadeaux, abonnements ou adhésions (offre Core ou supérieure).</>, <>Orders: <Kbd>Pages › Website tools › Code injection</Kbd>, paste the code below into <Kbd>Order status page</Kbd>, and also into <Kbd>Order confirmation page</Kbd> if you sell gift cards, subscriptions or memberships (Core plan or above).</>)}</li>
        </ol>
        {settings && (
          <Code
            code={`<script>
  window.Pingsell = window.Pingsell || { q: [] };
  Pingsell.q.push(["track", "commande", {
    email: "{customerEmailAddress}",
    id: "{orderId}",
    total: "{orderGrandTotal}"
  }]);
</script>
<script src="${settings.form.script_url}" async></script>`}
          />
        )}
      </div>
    ),
    woocommerce: (
      <div className="space-y-2">
        <Hint>{t("L'extension WordPress fait tout ceci automatiquement, avec en plus les paniers des visiteurs non connectés. Les webhooks servent quand on ne peut pas installer d'extension.", "The WordPress plugin does all this automatically, plus guest carts. Webhooks are for when you can't install plugins.")}</Hint>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>{t(<>Dans WordPress : <Kbd>WooCommerce › Réglages › Avancé › Webhooks › Ajouter un webhook</Kbd>.</>, <>In WordPress: <Kbd>WooCommerce › Settings › Advanced › Webhooks › Add webhook</Kbd>.</>)}</li>
          <li>{t(<>État <Kbd>Actif</Kbd>, sujet <Kbd>Commande mise à jour</Kbd>, collez l'adresse ci-dessus dans <Kbd>URL de livraison</Kbd>, laissez le secret tel quel, puis <Kbd>Enregistrer</Kbd>.</>, <>Status <Kbd>Active</Kbd>, topic <Kbd>Order updated</Kbd>, paste the address above as <Kbd>Delivery URL</Kbd>, leave the secret as is, then <Kbd>Save</Kbd>.</>)}</li>
          <li>{t(<>Recommencez avec les sujets <Kbd>Commande créée</Kbd> et <Kbd>Client créé</Kbd>.</>, <>Repeat with the topics <Kbd>Order created</Kbd> and <Kbd>Customer created</Kbd>.</>)}</li>
        </ol>
        <p className="text-xs text-slate-500">
          {t("Pingsell lit le statut : en attente de paiement → panier à relancer, en cours → commande, terminée → expédition (avec le suivi de l'extension Shipment Tracking).", "Pingsell reads the status: pending payment → cart to win back, processing → order, completed → shipment (with tracking from the Shipment Tracking plugin).")}
        </p>
      </div>
    ),
    forms: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>{t(<>Tally : publiez le formulaire, puis <Kbd>Integrations › Webhooks › Connect</Kbd> et collez l'adresse.</>, <>Tally: publish the form, then <Kbd>Integrations › Webhooks › Connect</Kbd> and paste the address.</>)}</li>
        <li>{t(<>Typeform : <Kbd>Connect › Webhooks › Add a webhook</Kbd>, collez l'adresse, puis activez-le.</>, <>Typeform: <Kbd>Connect › Webhooks › Add a webhook</Kbd>, paste the address, then turn it on.</>)}</li>
        <li>{t("Les questions Email, Prénom, Nom, Téléphone et Date sont reconnues ; les autres réponses sont gardées avec le contact.", "Email, first name, last name, phone and date questions are recognised; other answers are kept with the contact.")}</li>
      </ol>
    ),
    other: (
      <div className="space-y-2">
        <p>{t("Tout outil qui envoie un webhook (JSON ou formulaire classique) fonctionne : Elementor Pro (Actions après soumission › Webhook), Carrd Pro Plus (élément Form de type « Custom » › Send to URL, méthode AJAX, format JSON), Jotform (Paramètres › Intégrations › Webhooks), Systeme.io, Jimdo, Odoo, Make… Collez simplement l'adresse. Calendly : le webhook se crée par son API (jeton d'accès personnel) avec cette même adresse ; chaque rendez-vous arrive comme événement « reservation », annulations comprises.", "Any tool that sends a webhook (JSON or a classic form post) works: Elementor Pro (Actions After Submit › Webhook), Carrd Pro Plus (Form element, “Custom” type › Send to URL, AJAX method, JSON format), Jotform (Settings › Integrations › Webhooks), Systeme.io, Jimdo, Odoo, Make… Just paste the address. Calendly: the webhook is created through its API (personal access token) with this same address; each booking arrives as a “reservation” event, cancellations included.")}</p>
        <p>{t("Pingsell trouve tout seul l'email, le prénom, le nom, le téléphone, un numéro de commande, un montant et une date, quels que soient les noms des champs.", "Pingsell finds the email, first name, last name, phone, an order number, an amount and a date on its own, whatever the field names.")}</p>
      </div>
    ),
  };

  return (
    <>
      <GuideHead
        icon={Webhook}
        title={t("Framer, Webflow, Wix, Squarespace…", "Framer, Webflow, Wix, Squarespace…")}
        text={t(
          "Une seule adresse à coller dans votre outil, sans code et sans Zapier. Pingsell reconnaît tout seul ce qu'il reçoit : formulaire, commande, expédition.",
          "One address to paste in your tool, no code and no Zapier. Pingsell recognises what it receives on its own: form, order, shipment.",
        )}
        done={done || undefined}
      />
      <Steps>
        <Step n={1} title={t("Choisissez ce que l'appel signifie", "Choose what the call means")}>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setEvent(c.id)}
                className={cx(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  event === c.id ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {event === "custom" && (
              <Field label={t("Nom de l'événement", "Event name")}>
                <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="inscription_atelier" />
              </Field>
            )}
            <Field label={t("Tags à ajouter (facultatif)", "Tags to add (optional)")}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="newsletter, salon-2026" />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            {t("WooCommerce, Webflow Ecommerce, Tally et Typeform sont détectés tout seuls : gardez « Inscription » pour eux.", "WooCommerce, Webflow Ecommerce, Tally and Typeform are detected on their own: keep “Sign-up” for them.")}
          </p>
        </Step>
        <Step n={2} title={t("Copiez votre adresse de webhook", "Copy your webhook address")}>
          {settings ? <CopyLine value={url} /> : <Waiting>{t("Chargement…", "Loading…")}</Waiting>}
          <p className="text-xs text-slate-500">
            {t("Elle est secrète : elle suffit pour ajouter des contacts à votre compte. ", "It's secret: it's enough to add contacts to your account. ")}
            <button type="button" className="font-semibold text-brand-500 hover:text-brand-600" onClick={() => setConfirmRotate(true)}>
              <RefreshCw className="mr-1 inline size-3" />
              {t("En créer une nouvelle", "Create a new one")}
            </button>
          </p>
        </Step>
        <Step n={3} title={t("Collez-la dans votre outil", "Paste it in your tool")}>
          <Tabs label={t("Outil", "Tool")} value={tab} onChange={setTab} options={NOCODE_TABS} />
          <div className="text-sm text-slate-600 dark:text-slate-300">{how[tab]}</div>
        </Step>
        <Step n={4} title={t("Faites un essai", "Run a test")} done={!!done} last>
          {done ? (
            <p>
              {t("Tout fonctionne. Choisissez maintenant ce que vos clients reçoivent dans ", "Everything works. Now choose what your customers receive in ")}
              <Link to="/automatisations" className="font-semibold text-brand-500 hover:text-brand-600">{t("Automatisations", "Automations")}</Link>.
            </p>
          ) : (
            <Waiting>{t("Remplissez votre formulaire une fois (ou passez une commande test) : on vous confirme ici dès que Pingsell la reçoit.", "Fill in your form once (or place a test order) and we'll confirm here as soon as Pingsell receives it.")}</Waiting>
          )}
          {current && <LastCall call={current.webhook} />}
        </Step>
      </Steps>
      <ConfirmModal
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => void rotate()}
        loading={rotating}
        title={t("Créer une nouvelle adresse ?", "Create a new address?")}
        description={t("L'adresse actuelle cessera de fonctionner immédiatement : il faudra coller la nouvelle dans tous vos outils.", "The current address stops working right away: you'll need to paste the new one in all your tools.")}
        confirmLabel={t("Créer une nouvelle adresse", "Create a new address")}
        danger
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Paste-in signup form                                                         */
/* -------------------------------------------------------------------------- */

const PLACES: Array<{ id: string; label: string; how: string }> = [
  { id: "wix", label: "Wix", how: t("Ajouter › Code intégré › Intégrer du HTML, puis collez le code.", "Add › Embed code › Embed HTML, then paste the code.") },
  { id: "squarespace", label: "Squarespace", how: t("Ajoutez un bloc « Code » et collez le code, en désactivant « Afficher la source » (offre Core ou supérieure).", "Add a “Code” block and paste the code, with “Display source” off (Core plan or above).") },
  { id: "framer", label: "Framer", how: t("Insert › Embed, choisissez « HTML » et collez le code.", "Insert › Embed, pick “HTML” and paste the code.") },
  { id: "webflow", label: "Webflow", how: t("Ajoutez un élément « Code Embed » et collez le code.", "Add a “Code Embed” element and paste the code.") },
  { id: "wordpress", label: "WordPress", how: t("Bloc « HTML personnalisé », ou le code court [pingsell_form] de l'extension.", "“Custom HTML” block, or the plugin's [pingsell_form] shortcode.") },
  { id: "shopify", label: "Shopify", how: t("Boutique en ligne › Thèmes › Personnaliser › Ajouter une section › « Liquid personnalisé ».", "Online Store › Themes › Customize › Add section › “Custom Liquid”.") },
  { id: "other", label: t("Autre", "Other"), how: t("Partout où l'on peut coller du HTML : Carrd Pro (Embed), Jimdo, Strikingly, Google Sites, Notion (Super, Potion)…", "Anywhere you can paste HTML: Carrd (Embed), Jimdo, Strikingly, Google Sites, Notion (Super, Potion)…") },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function FormGuide({ done, onDone }: GuideProps) {
  const toast = useToast();
  const data = useAsync(() => api.inbound.get(), []);
  const settings = data.data ?? null;
  const [title, setTitle] = useState(t("Restez au courant", "Stay in the loop"));
  const [button, setButton] = useState(t("Je m’inscris", "Sign me up"));
  const [tags, setTags] = useState("newsletter");
  const [withFirst, setWithFirst] = useState(true);
  const [color, setColor] = useState("#145CFF");
  const [place, setPlace] = useState("wix");
  const [mode, setMode] = useState<"ready" | "own" | "track">("ready");
  const [domains, setDomains] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { hit, latest } = useNewCall(settings, (s) => s.form, !done);
  const current = latest ?? settings;

  useEffect(() => {
    if (hit) onDone(t("Première inscription reçue. Retrouvez-la dans Contacts : c'est branché !", "First sign-up received. Find it in Contacts: you're connected!"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit]);

  const attrs = [
    `data-title="${esc(title)}"`,
    `data-button="${esc(button)}"`,
    tags.trim() ? `data-tags="${esc(tags.trim())}"` : "",
    withFirst ? `data-fields="first_name,email"` : "",
    color.toLowerCase() !== "#145cff" ? `data-color="${esc(color)}"` : "",
  ].filter(Boolean);
  const script = settings ? `<script src="${settings.form.script_url}" async></script>` : "";
  const snippet = `<div data-pingsell-form\n  ${attrs.join("\n  ")}></div>\n${script}`;
  const own = `<form data-pingsell data-tags="${esc(tags.trim() || "newsletter")}">\n  <input name="prenom" placeholder="Prénom">\n  <input name="email" type="email" placeholder="Email" required>\n  <button type="submit">${esc(button)}</button>\n</form>\n${script}`;
  const track = `${script}\n<script>\n  // Page de confirmation : réservation, rendez-vous, commande…\n  window.Pingsell = window.Pingsell || { q: [] };\n  Pingsell.q.push(["track", "reservation", {\n    email: "client@exemple.fr",\n    id: "R-2041",\n    date: "2026-12-24T19:30:00+01:00"\n  }]);\n</script>`;

  // Live preview with the real script (it renders every [data-pingsell-form] added to the page).
  useEffect(() => {
    if (!settings || document.querySelector(`script[src="${settings.form.script_url}"]`)) return;
    (window as unknown as { __pingsellNoTrack?: boolean }).__pingsellNoTrack = true;
    const s = document.createElement("script");
    s.src = settings.form.script_url;
    s.async = true;
    document.head.appendChild(s);
  }, [settings]);
  const previewKey = JSON.stringify([title, button, tags, withFirst, color]);

  async function saveDomains() {
    if (domains === null) return;
    setSaving(true);
    try {
      await api.inbound.setOrigins(domains.split(/[\s,]+/).filter(Boolean));
      await data.reload();
      setDomains(null);
      toast.success(t("Domaines enregistrés", "Domains saved"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const allowed = settings?.form.allowed_origins ?? [];
  const appHost = window.location.hostname.replace(/^www\./, "");
  const previewBlocked = allowed.length > 0 && !allowed.some((d) => appHost === d || appHost.endsWith(`.${d}`));

  return (
    <>
      <GuideHead
        icon={FormInput}
        title={t("Formulaire d'inscription à coller", "Paste-in sign-up form")}
        text={t(
          "Un formulaire prêt à l'emploi pour n'importe quel site : Wix, Squarespace, Framer, Webflow, WordPress, Shopify, Carrd… Chaque inscription arrive dans Contacts et peut lancer un scénario de bienvenue.",
          "A ready-made form for any site: Wix, Squarespace, Framer, Webflow, WordPress, Shopify, Carrd… Every sign-up lands in Contacts and can start a welcome flow.",
        )}
        done={done || undefined}
      />
      <Steps>
        <Step n={1} title={t("Personnalisez-le", "Customise it")}>
          <Tabs
            label={t("Type", "Type")}
            value={mode}
            onChange={setMode}
            options={[
              { id: "ready", label: t("Formulaire prêt à l'emploi", "Ready-made form") },
              { id: "own", label: t("Mon propre formulaire", "My own form") },
              { id: "track", label: t("Page de confirmation", "Confirmation page") },
            ]}
          />
          {mode === "ready" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("Titre", "Title")}>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
                </Field>
                <Field label={t("Bouton", "Button")}>
                  <Input value={button} onChange={(e) => setButton(e.target.value)} maxLength={40} />
                </Field>
                <Field label={t("Tags ajoutés aux inscrits", "Tags added to sign-ups")}>
                  <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="newsletter" />
                </Field>
                <Field label={t("Couleur du bouton", "Button colour")}>
                  <div className="flex items-center gap-2">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border-0 bg-transparent" aria-label={t("Couleur", "Colour")} />
                    <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
                  </div>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={withFirst} onChange={(e) => setWithFirst(e.target.checked)} className="size-4 rounded" />
                {t("Demander aussi le prénom (pour personnaliser vos emails)", "Also ask for the first name (to personalise your emails)")}
              </label>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/10 dark:bg-slate-950 dark:ring-white/10">
                <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-400 uppercase">{t("Aperçu réel", "Live preview")}</p>
                {previewBlocked ? (
                  <p className="text-xs text-slate-500">{t("Aperçu désactivé : ce domaine ne fait pas partie des domaines autorisés.", "Preview off: this domain isn't one of the allowed domains.")}</p>
                ) : (
                  <div
                    key={previewKey}
                    data-pingsell-form=""
                    data-title={title}
                    data-button={button}
                    data-tags={tags}
                    data-fields={withFirst ? "first_name,email" : "email"}
                    data-color={color}
                  />
                )}
                <p className="mt-3 text-[11px] text-slate-400">{t("Une inscription faite ici crée vraiment le contact.", "A sign-up made here really creates the contact.")}</p>
              </div>
            </>
          )}
          {mode === "own" && (
            <p>
              {t(
                <>Gardez le design de votre site : ajoutez <code>data-pingsell</code> à votre balise <code>&lt;form&gt;</code> et collez le script. Les champs sont reconnus quel que soit leur nom (email, prénom, nom, téléphone…).</>,
                <>Keep your site's design: add <code>data-pingsell</code> to your <code>&lt;form&gt;</code> tag and paste the script. Fields are recognised whatever their name (email, first name, last name, phone…).</>,
              )}
            </p>
          )}
          {mode === "track" && (
            <p>
              {t(
                <>Sur une page de remerciement (réservation, rendez-vous, commande), un appel suffit : le nom après <code>"track"</code> est celui que vous choisirez dans Automatisations.</>,
                <>On a thank-you page (booking, appointment, order), one call is enough: the name after <code>"track"</code> is the one you'll pick in Automations.</>,
              )}
            </p>
          )}
        </Step>
        <Step n={2} title={t("Copiez le code", "Copy the code")}>
          {settings ? <Code code={mode === "ready" ? snippet : mode === "own" ? own : track} /> : <Waiting>{t("Chargement…", "Loading…")}</Waiting>}
        </Step>
        <Step n={3} title={t("Collez-le sur votre site", "Paste it on your site")}>
          <Tabs label={t("Site", "Site")} value={place} onChange={setPlace} options={PLACES} />
          <p>{PLACES.find((p) => p.id === place)?.how}</p>
          <Field label={t("Domaines autorisés (conseillé)", "Allowed domains (recommended)")}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={domains ?? allowed.join(", ")}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="maboutique.fr, monsite.framer.website"
              />
              <Button variant="secondary" icon={Globe} onClick={() => void saveDomains()} loading={saving} disabled={domains === null}>
                {t("Enregistrer", "Save")}
              </Button>
            </div>
          </Field>
          <p className="text-xs text-slate-500">
            {t("Vide : le formulaire marche partout. Renseigné : seuls ces sites (et leurs sous-domaines) peuvent l'utiliser. Sur Wix, le bloc HTML tourne sur filesusr.com : ajoutez-le aussi, ou laissez vide. Les robots sont filtrés et les envois limités dans tous les cas.", "Empty: the form works anywhere. Filled in: only these sites (and their subdomains) can use it. On Wix, the HTML block runs on filesusr.com: add it too, or leave empty. Bots are filtered and submissions rate-limited either way.")}
          </p>
        </Step>
        <Step n={4} title={t("Faites un essai", "Run a test")} done={!!done} last>
          {done ? (
            <p>
              {t("Tout fonctionne. Activez un scénario de bienvenue dans ", "Everything works. Turn on a welcome flow in ")}
              <Link to="/automatisations" className="font-semibold text-brand-500 hover:text-brand-600">{t("Automatisations", "Automations")}</Link>.
            </p>
          ) : (
            <Waiting>{t("Inscrivez-vous une fois sur votre site (ou dans l'aperçu) : on vous confirme ici dès que Pingsell reçoit l'inscription.", "Sign up once on your site (or in the preview) and we'll confirm here as soon as Pingsell receives it.")}</Waiting>
          )}
          {current && <LastCall call={current.form} />}
        </Step>
      </Steps>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Suivi du site : une ligne, tout le reste est automatique                   */
/* -------------------------------------------------------------------------- */

export function TrackingGuide({ done, onDone }: GuideProps) {
  const toast = useToast();
  const data = useAsync(() => api.inbound.get(), []);
  const settings = data.data ?? null;
  const [place, setPlace] = useState("wix");
  const [busy, setBusy] = useState<"enabled" | "require_consent" | "capture_actions" | null>(null);
  const [live, setLive] = useState<InboundSettings | null>(null);
  const current = live ?? settings;
  const tracking = current?.tracking;

  async function toggle(key: "enabled" | "require_consent" | "capture_actions", value: boolean) {
    setBusy(key);
    try {
      setLive(await api.inbound.setTracking({ [key]: value }));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  const script = settings ? `<script src="${settings.form.script_url}" async></script>` : "";
  const head: Record<string, string> = {
    wix: t("Paramètres du site › Code personnalisé › Ajouter du code : collez la ligne, « Toutes les pages », emplacement « Head ».", "Site settings › Custom code › Add code: paste the line, “All pages”, place in “Head”."),
    squarespace: t("Paramètres › Avancé › Injection de code › En-tête : collez la ligne (offre Core ou supérieure).", "Settings › Advanced › Code injection › Header: paste the line (Core plan or above)."),
    framer: t("Paramètres du site › Général › Code personnalisé › « Start of <head> tag » : collez la ligne, puis publiez.", "Site settings › General › Custom code › “Start of <head> tag”: paste the line, then publish."),
    webflow: t("Paramètres du site › Code personnalisé › Head code : collez la ligne, puis publiez.", "Site settings › Custom code › Head code: paste the line, then publish."),
    wordpress: t("Avec l'extension Pingsell (1.2 ou plus), rien à faire : le suivi est déjà actif. Sinon, collez la ligne dans l'en-tête du thème.", "With the Pingsell plugin (1.2 or later), nothing to do: tracking is already on. Otherwise, paste the line in the theme header."),
    shopify: t("Boutique en ligne › Thèmes › … › Modifier le code › theme.liquid : collez la ligne juste avant </head>.", "Online Store › Themes › … › Edit code › theme.liquid: paste the line just before </head>."),
    other: t("Dans l'en-tête commun à toutes les pages (balise <head>), ou via Google Tag Manager (balise HTML personnalisée, toutes les pages).", "In the header shared by every page (<head> tag), or through Google Tag Manager (custom HTML tag, all pages)."),
  };

  const FEATURES: Array<{ icon: typeof Eye; title: string; text: string }> = [
    { icon: Activity, title: t("Pages et produits vus", "Pages and products viewed"), text: t("Nom, photo et prix des produits lus tout seuls sur la page.", "Product name, photo and price read straight from the page.") },
    { icon: UserRoundPlus, title: t("Ce que font vos visiteurs", "What your visitors do"), text: t("Création de compte, connexion, inscription newsletter, formulaire de contact\u00a0: repérés tout seuls.", "Account created, sign-in, newsletter sign-up, contact form: spotted on their own.") },
    { icon: MousePointerClick, title: t("Qui est le visiteur", "Who the visitor is"), text: t("Reconnu dès qu'il clique dans un de vos emails, ou qu'il tape son email dans n'importe quel formulaire du site.", "Recognised as soon as they click in one of your emails, or type their email in any form on the site.") },
  ];

  return (
    <>
      <GuideHead
        icon={Activity}
        title={t("Vos sites", "Your sites")}
        text={t(
          "Une seule ligne à coller, une seule fois, sur chacun de vos sites. Pingsell reconnaît ensuite chaque site tout seul et repère ce que vos visiteurs y font\u00a0: pages et produits vus, créations de compte, connexions, inscriptions newsletter, formulaires de contact. Vous n'avez plus jamais à toucher au code.",
          "One line to paste, once, on each of your sites. Pingsell then recognises every site on its own and spots what your visitors do there: pages and products viewed, accounts created, sign-ins, newsletter sign-ups, contact forms. You never have to touch the code again.",
        )}
        done={done || undefined}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <f.icon className="size-5 text-brand-500" />
            <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{f.title}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{f.text}</p>
          </div>
        ))}
      </div>
      <Steps>
        <Step n={1} title={t("Copiez cette ligne", "Copy this line")}>
          {settings ? <Code code={script} /> : <Waiting>{t("Chargement…", "Loading…")}</Waiting>}
          <p className="text-xs text-slate-500">
            {t(
              "À coller une seule fois sur chacun de vos sites\u00a0: la même ligne marche partout, Pingsell distingue vos sites par leur adresse. C'est aussi la ligne du formulaire à coller\u00a0: si elle est déjà sur vos pages, tout tourne déjà.",
              "Paste it once on each of your sites: the same line works everywhere, Pingsell tells your sites apart by their address. It's also the paste-in form's line: if it's already on your pages, everything is already running.",
            )}
          </p>
        </Step>
        <Step n={2} title={t("Collez-la dans l'en-tête de chaque site", "Paste it in each site's header")}>
          <Tabs label={t("Site", "Site")} value={place} onChange={setPlace} options={PLACES} />
          <p>{head[place]}</p>
        </Step>
        <Step n={3} title={t("Vos sites repérés", "Your sites spotted")} done={!!done}>
          {tracking && tracking.pageviews > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [tracking.pageviews, t("pages vues", "page views")],
                [tracking.visitors, t("visiteurs", "visitors")],
                [tracking.identified, t("reconnus", "recognised")],
              ].map(([n, l]) => (
                <div key={String(l)} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="font-display text-xl font-bold text-slate-900 dark:text-white">{Number(n).toLocaleString(LOCALE)}</p>
                  <p className="text-xs text-slate-500">{l}</p>
                </div>
              ))}
            </div>
          )}
          <SitesPanel
            captureOff={!!tracking && (!tracking.enabled || tracking.capture_actions === false)}
            onFirstSite={() => onDone(t("Premier site repéré\u00a0: la ligne est en place\u00a0!", "First site spotted: the line is in place!"))}
            onFirstAction={() => onDone(t("Première action repérée sur votre site\u00a0: vous pouvez créer une automatisation\u00a0!", "First action spotted on your site: you can create an automation!"))}
          />
          <p>
            {t("Ensuite, dans ", "Then, in ")}
            <Link to="/automatisations" className="font-semibold text-brand-500 hover:text-brand-600">{t("Automatisations", "Automations")}</Link>
            {t(
              "\u00a0: «\u00a0Une action sur votre site\u00a0», «\u00a0Produit consulté sans achat\u00a0» et «\u00a0Page visitée\u00a0» sont prêts à l'emploi. Dans ",
              ": “An action on your site”, “Viewed, not bought” and “Page visited” are ready to use. In ",
            )}
            <Link to="/segments" className="font-semibold text-brand-500 hover:text-brand-600">{t("Segments", "Segments")}</Link>
            {t("\u00a0: «\u00a0Page du site\u00a0» et «\u00a0Dernière visite du site\u00a0».", ": “Site page” and “Last site visit”.")}
          </p>
        </Step>
        <Step n={4} title={t("Réglez la confidentialité", "Set privacy")} last>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded" checked={!!tracking?.enabled} disabled={!tracking || busy !== null} onChange={(e) => void toggle("enabled", e.target.checked)} />
            <span>
              <span className="font-semibold text-slate-900 dark:text-white">{t("Suivre les visites", "Track visits")}</span>
              <span className="block text-xs text-slate-500">
                {t(
                  "Décoché\u00a0: Pingsell ne suit plus ni les pages vues ni les actions (comptes, connexions, formulaires). Le formulaire Pingsell à coller marche toujours.",
                  "Unchecked: Pingsell no longer follows page views or actions (accounts, sign-ins, forms). The Pingsell paste-in form still works.",
                )}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded"
              checked={!!tracking?.enabled && tracking.capture_actions !== false}
              disabled={!tracking || !tracking.enabled || busy !== null}
              onChange={(e) => void toggle("capture_actions", e.target.checked)}
            />
            <span>
              <span className="font-semibold text-slate-900 dark:text-white">{t("Repérer les actions automatiquement", "Spot actions automatically")}</span>
              <span className="block text-xs text-slate-500">
                {t(
                  "Créations de compte, connexions, inscriptions newsletter et formulaires. Décoché\u00a0: Pingsell ne les repère plus et le déclencheur «\u00a0Une action sur votre site\u00a0» ne part plus.",
                  "Account creations, sign-ins, newsletter sign-ups and forms. Unchecked: Pingsell no longer spots them and the “An action on your site” trigger no longer fires.",
                )}
                {tracking && !tracking.enabled && (
                  <span className="mt-0.5 block font-semibold text-amber-700 dark:text-amber-300">{t("Activez d'abord le suivi des visites.", "Turn on visit tracking first.")}</span>
                )}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded" checked={!!tracking?.require_consent} disabled={!tracking || busy !== null} onChange={(e) => void toggle("require_consent", e.target.checked)} />
            <span>
              <span className="font-semibold text-slate-900 dark:text-white">{t("Attendre l'accord cookies du visiteur (conseillé en Europe)", "Wait for the visitor's cookie consent (recommended in Europe)")}</span>
              <span className="block text-xs text-slate-500">
                {t(
                  <>Reconnu tout seul avec Cookiebot, et avec Axeptio si vous y ajoutez un service nommé <code>pingsell</code>. Avec une autre bannière, appelez <code>Pingsell.consent(true)</code> quand le visiteur accepte. Sans cet accord, ni les visites ni les actions du visiteur ne sont repérées.</>,
                  <>Detected automatically with Cookiebot, and with Axeptio if you add a service named <code>pingsell</code>. With another banner, call <code>Pingsell.consent(true)</code> when the visitor accepts. Without that consent, neither the visitor's visits nor actions are spotted.</>,
                )}
              </span>
            </span>
          </label>
          <Hint>
            <ShieldCheck className="mr-1 inline size-3.5" />
            {t(
              "Seuls l'email, le prénom, le nom et le téléphone tapés dans un formulaire sont repris, jamais un mot de passe ni un numéro de carte. Les visiteurs anonymes sont oubliés après 90 jours, l'historique après 13 mois, et tout est effacé avec le contact.",
              "Only the email, first name, last name and phone typed in a form are kept, never a password or card number. Anonymous visitors are forgotten after 90 days, history after 13 months, and everything is erased with the contact.",
            )}
          </Hint>
        </Step>
      </Steps>
      <p className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        {t(
          "Cette ligne capte toute seule tout ce qui se passe dans le navigateur de vos visiteurs. L'API ne sert que pour ce qui se passe sur votre serveur, par exemple un paiement confirmé\u00a0: ",
          "This line captures on its own everything that happens in your visitors' browser. The API is only for what happens on your server, for example a confirmed payment: ",
        )}
        <Link to="/integrations?outil=site" className="font-semibold text-brand-500 hover:text-brand-600">{t("Site sur mesure", "Custom website")}</Link>.
      </p>
    </>
  );
}

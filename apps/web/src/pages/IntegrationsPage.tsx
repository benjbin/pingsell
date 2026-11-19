import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Activity,
  ArrowRight,
  Blocks,
  CheckCircle2,
  FormInput,
  ShoppingBasket,
  Webhook,
  Contact,
  FileSpreadsheet,
  Globe,
  LayoutDashboard,
  Package,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Store,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { t, LOCALE } from "../lib/i18n";
import { useAsync } from "../lib/useAsync";
import { cx } from "../lib/format";
import { Button, Card, Input, PageHeader } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { ApiGuide, AppGuide, FileGuide, ShopifyGuide, type ApiKind } from "../components/connect/ConnectGuides";
import { SiteEventsPanel } from "../components/connect/SiteEvents";
import { FormGuide, NoCodeGuide, PluginGuide, TrackingGuide, type NoCodeTab } from "../components/connect/NoCodeGuides";

type ToolId = "shopify" | "wordpress" | "prestashop" | "nocode" | "form" | "suivi" | "site" | "crm" | "pos" | "backoffice" | "app" | "file" | "other";

const TOOLS: Array<{ id: ToolId; icon: LucideIcon; title: string; text: string; how: string; api?: ApiKind }> = [
  { id: "shopify", icon: ShoppingBag, title: "Shopify", text: t("Clients, commandes, expéditions et paniers abandonnés.", "Customers, orders, shipments and abandoned carts."), how: t("1 clic", "1 click") },
  { id: "wordpress", icon: Blocks, title: "WordPress & WooCommerce", text: t("Comptes, paniers abandonnés, commandes, suivi et formulaires.", "Accounts, abandoned carts, orders, tracking and forms."), how: t("Extension · 2 min", "Plugin · 2 min") },
  { id: "prestashop", icon: ShoppingBasket, title: "PrestaShop", text: t("Comptes, newsletter, paniers, commandes et suivi.", "Accounts, newsletter, carts, orders and tracking."), how: t("Module · 2 min", "Module · 2 min") },
  { id: "nocode", icon: Webhook, title: "Framer, Webflow, Wix…", text: t("Formulaires et commandes, sans code ni Zapier.", "Forms and orders, no code, no Zapier."), how: t("Webhook · 2 min", "Webhook · 2 min") },
  { id: "suivi", icon: Activity, title: t("Vos sites", "Your sites"), text: t("Une ligne à coller\u00a0: pages, produits, comptes créés et formulaires repérés tout seuls.", "One line to paste: pages, products, accounts created and forms spotted on their own."), how: t("1 ligne", "1 line") },
  { id: "form", icon: FormInput, title: t("Formulaire à coller", "Paste-in form"), text: t("Un formulaire d'inscription pour n'importe quel site.", "A sign-up form for any site."), how: t("Copier-coller", "Copy & paste") },
  { id: "site", icon: Globe, title: t("Site sur mesure", "Custom website"), text: t("Inscriptions, commandes, réservations : un seul appel API.", "Sign-ups, orders, bookings: a single API call."), how: "API · 5 min", api: "site" },
  { id: "crm", icon: Contact, title: t("Votre CRM", "Your CRM"), text: t("Fiches clients et étapes, envoyées comme tags.", "Customer records and stages, sent as tags."), how: "API · 5 min", api: "crm" },
  { id: "pos", icon: Store, title: t("Votre caisse", "Your POS"), text: t("Ventes en boutique quand le client laisse son email.", "In-store sales when the customer leaves their email."), how: "API · 5 min", api: "pos" },
  { id: "backoffice", icon: LayoutDashboard, title: t("Back-office / ERP", "Back office / ERP"), text: t("Commandes de tous vos canaux et leur suivi.", "Orders from all your channels, with tracking."), how: "API · 5 min", api: "backoffice" },
  { id: "app", icon: Smartphone, title: t("App iOS & Android", "iOS & Android app"), text: t("Notifications push et centre de notifications.", "Push notifications and notification center."), how: "SDK" },
  { id: "file", icon: FileSpreadsheet, title: t("Fichier Excel / CSV", "Excel / CSV file"), text: t("Mailchimp, Brevo, Klaviyo, tableur…", "Mailchimp, Brevo, Klaviyo, spreadsheets…"), how: t("Import · 1 min", "Import · 1 min") },
  { id: "other", icon: Wrench, title: t("Un autre outil", "Another tool"), text: t("Tout ce qui sait faire un appel web.", "Anything that can make a web request."), how: "API", api: "other" },
];

const IDS = TOOLS.map((it) => it.id);

export function IntegrationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const guideRef = useRef<HTMLDivElement>(null);

  // Back from Shopify's OAuth page during onboarding: resume the welcome flow.
  useEffect(() => {
    if (params.get("shopify") !== "connected") return;
    try {
      if (sessionStorage.getItem("missive_onboarding_return")) {
        sessionStorage.removeItem("missive_onboarding_return");
        navigate("/bienvenue?shopify=connected", { replace: true });
      }
    } catch {
      /* ignore */
    }
  }, [params, navigate]);

  const outil = params.get("outil") as ToolId | null;
  const selected = outil && IDS.includes(outil) ? outil : params.get("shopify") ? "shopify" : null;
  const tool = TOOLS.find((it) => it.id === selected);

  const [done, setDone] = useState<Partial<Record<ToolId, string>>>({});
  const [nocodeTab, setNocodeTab] = useState<NoCodeTab>("framer");
  const status = useAsync(async () => {
    const [shopify, keys, push, contacts, inbound, events, sites] = await Promise.all([
      api.integrations.shopify.status().catch(() => null),
      api.apiKeys.list().catch(() => []),
      api.push.config().catch(() => null),
      api.contacts.list({ limit: 1 }).catch(() => null),
      api.inbound.get().catch(() => null),
      api.automations.eventNames().catch(() => []),
      api.inbound.sites().catch(() => []),
    ]);
    return {
      shopify: !!shopify?.integration && shopify.integration.connected !== false,
      keysUsed: keys.filter((k) => k.last_used_at).length,
      devices: push?.devices.total ?? 0,
      contacts: contacts?.total ?? 0,
      pageviews: inbound?.tracking?.pageviews ?? 0,
      siteEvents: events.length,
      sites: sites.length,
    };
  }, [done]);

  function badge(it: (typeof TOOLS)[number]): string | null {
    const s = status.data;
    if (done[it.id]) return it.id === "file" ? t("Importé", "Imported") : t("Connecté", "Connected");
    if (!s) return null;
    if (it.id === "shopify") return s.shopify ? t("Connectée", "Connected") : null;
    if (it.id === "app") return s.devices
        ? t(
            `${s.devices.toLocaleString(LOCALE)} appareil${s.devices > 1 ? "s" : ""}`,
            `${s.devices.toLocaleString(LOCALE)} device${s.devices === 1 ? "" : "s"}`,
          )
        : null;
    if (it.id === "file") return s.contacts
        ? t(`${s.contacts.toLocaleString(LOCALE)} contacts`, `${s.contacts.toLocaleString(LOCALE)} contact${s.contacts === 1 ? "" : "s"}`)
        : null;
    if (it.id === "suivi" && s.sites) return t(`${s.sites} site${s.sites > 1 ? "s" : ""}`, `${s.sites} site${s.sites === 1 ? "" : "s"}`);
    if (it.id === "suivi") return s.pageviews
        ? t(`${s.pageviews.toLocaleString(LOCALE)} pages vues`, `${s.pageviews.toLocaleString(LOCALE)} page views`)
        : null;
    if (it.id === "site") return s.siteEvents
        ? t(
            `${s.siteEvents} événement${s.siteEvents > 1 ? "s" : ""} reçu${s.siteEvents > 1 ? "s" : ""}`,
            `${s.siteEvents} event${s.siteEvents === 1 ? "" : "s"} received`,
          )
        : null;
    if (it.id === "other") return s.keysUsed
        ? t(
            `${s.keysUsed} clé${s.keysUsed > 1 ? "s" : ""} active${s.keysUsed > 1 ? "s" : ""}`,
            `${s.keysUsed} active key${s.keysUsed === 1 ? "" : "s"}`,
          )
        : null;
    return null;
  }

  function open(id: ToolId | null) {
    const next = new URLSearchParams(params);
    next.delete("shopify");
    if (id) next.set("outil", id);
    else next.delete("outil");
    setParams(next, { replace: true });
    if (id) requestAnimationFrame(() => guideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const mark = (id: ToolId) => (label: string) => setDone((d) => (d[id] === label ? d : { ...d, [id]: label }));

  return (
    <>
      <PageHeader
        title={t("Intégrations", "Integrations")}
        description={t(
          "Pingsell se branche sur ce que vous utilisez déjà. Choisissez un outil : un guide pas à pas vous accompagne jusqu'au premier essai.",
          "Pingsell plugs into the tools you already use. Pick one: a step-by-step guide walks you through to your first test.",
        )}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TOOLS.map((it) => {
          const on = selected === it.id;
          const b = badge(it);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={on}
              onClick={() => open(on ? null : it.id)}
              className={cx(
                "group flex flex-col rounded-2xl bg-white p-4 text-left ring-1 transition dark:bg-slate-900",
                on ? "ring-2 ring-brand-500 shadow-[0_18px_40px_-24px_rgba(20,92,255,0.7)]" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10 dark:hover:ring-white/30",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={cx("flex size-10 items-center justify-center rounded-xl", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-500 dark:bg-brand-900/30")}>
                  <it.icon className="size-5" strokeWidth={1.75} />
                </span>
                {b ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <CheckCircle2 className="size-3" /> {b}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{it.how}</span>
                )}
              </span>
              <span className="mt-3 font-display text-[15px] font-bold text-slate-900 dark:text-white">{it.title}</span>
              <span className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{it.text}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                {on ? t("Guide ouvert", "Guide open") : t("Voir le guide", "View guide")} <ArrowRight className={cx("size-3.5 transition-transform", on ? "rotate-90" : "group-hover:translate-x-0.5")} />
              </span>
            </button>
          );
        })}
      </div>

      <div ref={guideRef} className="scroll-mt-6">
        {tool ? (
          <Card className="relative mt-6 p-6 sm:p-8">
            <button
              type="button"
              onClick={() => open(null)}
              aria-label={t("Fermer le guide", "Close guide")}
              className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X className="size-5" />
            </button>
            <div className="max-w-3xl">
              {tool.id === "shopify" && <ShopifyGuide done={done.shopify} onDone={mark("shopify")} />}
              {(tool.id === "wordpress" || tool.id === "prestashop") && (
                <PluginGuide
                  key={tool.id}
                  platform={tool.id}
                  done={done[tool.id]}
                  onDone={mark(tool.id)}
                  onNoPlugin={() => {
                    setNocodeTab("woocommerce");
                    open("nocode");
                  }}
                />
              )}
              {tool.id === "nocode" && <NoCodeGuide key={nocodeTab} initialTab={nocodeTab} done={done.nocode} onDone={mark("nocode")} onUseForm={() => open("form")} />}
              {tool.id === "form" && <FormGuide done={done.form} onDone={mark("form")} />}
              {tool.id === "suivi" && <TrackingGuide done={done.suivi} onDone={mark("suivi")} />}
              {tool.id === "site" && (
                <div className="mb-8 border-b border-slate-900/10 pb-8 dark:border-white/10">
                  <p className="mb-6 rounded-2xl bg-brand-50/70 px-4 py-3 text-sm text-slate-700 dark:bg-brand-500/15 dark:text-slate-200">
                    {t(
                      "Pas besoin de l'API pour les comptes créés, les connexions ou les formulaires\u00a0: la ligne de ",
                      "No need for the API for accounts created, sign-ins or forms: the ",
                    )}
                    <button type="button" onClick={() => open("suivi")} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                      {t("Vos sites", "Your sites")}
                    </button>
                    {t(
                      " les capte toute seule dans le navigateur. L'API sert seulement à ce qui se passe sur votre serveur, par exemple un paiement confirmé.",
                      " line captures them on its own in the browser. The API is only for what happens on your server, for example a confirmed payment.",
                    )}
                  </p>
                  <SiteEventsPanel />
                </div>
              )}
              {tool.api && <ApiGuide key={tool.id} kind={tool.api} done={done[tool.id]} onDone={mark(tool.id)} onUseFile={() => open("file")} onKeyCreated={() => void status.reload()} />}
              {tool.id === "app" && <AppGuide done={done.app} onDone={mark("app")} />}
              {tool.id === "file" && <FileGuide done={done.file} onDone={mark("file")} />}
            </div>
          </Card>
        ) : (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-300 px-5 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t(
              <>
                Vous ne trouvez pas votre outil ? S'il sait faire un appel web ou exporter un fichier, il se branche :{" "}
                <button type="button" onClick={() => open("other")} className="font-semibold text-brand-500 hover:text-brand-600">
                  voir comment
                </button>
                .
              </>,
              <>
                Don't see your tool? If it can make a web request or export a file, it can connect:{" "}
                <button type="button" onClick={() => open("other")} className="font-semibold text-brand-500 hover:text-brand-600">
                  see how
                </button>
                .
              </>,
            )}
          </p>
        )}
      </div>

      <Simulator onDone={() => toast.success(t("Événement simulé", "Event simulated"), t("Les automatisations correspondantes ont été déclenchées.", "Matching automations have been triggered."))} />
    </>
  );
}

/** Fire a fake Shopify event to try automations without a real shop. */
function Simulator({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"order" | "order_fulfilled" | "cart_abandoned" | null>(null);

  async function simulate(type: "order" | "order_fulfilled" | "cart_abandoned") {
    if (!email.trim()) {
      toast.error(t("Indiquez l'email d'un contact", "Enter a contact's email"));
      return;
    }
    setBusy(type);
    try {
      await api.integrations.shopify.simulate({ type, email: email.trim() });
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("Tester vos automatisations sans boutique réelle", "Test your automations without a real store")}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {t(
          "Simulez un événement pour un contact (créé s'il n'existe pas) et regardez vos scénarios partir.",
          "Simulate an event for a contact (created if it doesn't exist) and watch your flows kick off.",
        )}
      </p>
      <div className="mt-3 flex flex-col flex-wrap gap-2 sm:flex-row">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("contact@exemple.fr", "contact@example.com")} className="sm:max-w-xs" aria-label={t("Email du contact", "Contact email")} />
        <Button variant="secondary" icon={ShoppingBag} onClick={() => void simulate("order")} loading={busy === "order"}>
          {t("Commande", "Order")}
        </Button>
        <Button variant="secondary" icon={Package} onClick={() => void simulate("order_fulfilled")} loading={busy === "order_fulfilled"}>
          {t("Expédition", "Shipment")}
        </Button>
        <Button variant="secondary" icon={ShoppingCart} onClick={() => void simulate("cart_abandoned")} loading={busy === "cart_abandoned"}>
          {t("Panier abandonné", "Abandoned cart")}
        </Button>
      </div>
    </Card>
  );
}

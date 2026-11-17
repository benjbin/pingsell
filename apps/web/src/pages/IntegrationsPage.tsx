import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
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
import { useAsync } from "../lib/useAsync";
import { cx } from "../lib/format";
import { Button, Card, Input, PageHeader } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { ApiGuide, AppGuide, FileGuide, ShopifyGuide, type ApiKind } from "../components/connect/ConnectGuides";

type ToolId = "shopify" | "site" | "crm" | "pos" | "backoffice" | "app" | "file" | "other";

const TOOLS: Array<{ id: ToolId; icon: LucideIcon; title: string; text: string; how: string; api?: ApiKind }> = [
  { id: "shopify", icon: ShoppingBag, title: "Shopify", text: "Clients, commandes, expéditions et paniers abandonnés.", how: "1 clic" },
  { id: "site", icon: Globe, title: "Votre site web", text: "Inscriptions, commandes et expéditions de votre site.", how: "API · 5 min", api: "site" },
  { id: "crm", icon: Contact, title: "Votre CRM", text: "Fiches clients et étapes, envoyées comme tags.", how: "API · 5 min", api: "crm" },
  { id: "pos", icon: Store, title: "Votre caisse", text: "Ventes en boutique quand le client laisse son email.", how: "API · 5 min", api: "pos" },
  { id: "backoffice", icon: LayoutDashboard, title: "Back-office / ERP", text: "Commandes de tous vos canaux et leur suivi.", how: "API · 5 min", api: "backoffice" },
  { id: "app", icon: Smartphone, title: "App iOS & Android", text: "Notifications push et centre de notifications.", how: "SDK" },
  { id: "file", icon: FileSpreadsheet, title: "Fichier Excel / CSV", text: "Mailchimp, Brevo, Klaviyo, tableur…", how: "Import · 1 min" },
  { id: "other", icon: Wrench, title: "Un autre outil", text: "Tout ce qui sait faire un appel web.", how: "API", api: "other" },
];

const IDS = TOOLS.map((t) => t.id);

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
  const tool = TOOLS.find((t) => t.id === selected);

  const [done, setDone] = useState<Partial<Record<ToolId, string>>>({});
  const status = useAsync(async () => {
    const [shopify, keys, push, contacts] = await Promise.all([
      api.integrations.shopify.status().catch(() => null),
      api.apiKeys.list().catch(() => []),
      api.push.config().catch(() => null),
      api.contacts.list({ limit: 1 }).catch(() => null),
    ]);
    return {
      shopify: !!shopify?.integration && shopify.integration.connected !== false,
      keysUsed: keys.filter((k) => k.last_used_at).length,
      devices: push?.devices.total ?? 0,
      contacts: contacts?.total ?? 0,
    };
  }, [done]);

  function badge(t: (typeof TOOLS)[number]): string | null {
    const s = status.data;
    if (done[t.id]) return t.id === "file" ? "Importé" : "Connecté";
    if (!s) return null;
    if (t.id === "shopify") return s.shopify ? "Connectée" : null;
    if (t.id === "app") return s.devices ? `${s.devices.toLocaleString("fr-FR")} appareil${s.devices > 1 ? "s" : ""}` : null;
    if (t.id === "file") return s.contacts ? `${s.contacts.toLocaleString("fr-FR")} contacts` : null;
    if (t.id === "other") return s.keysUsed ? `${s.keysUsed} clé${s.keysUsed > 1 ? "s" : ""} active${s.keysUsed > 1 ? "s" : ""}` : null;
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
      <PageHeader title="Intégrations" description="Pingsell se branche sur ce que vous utilisez déjà. Choisissez un outil : un guide pas à pas vous accompagne jusqu'au premier essai." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TOOLS.map((t) => {
          const on = selected === t.id;
          const b = badge(t);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => open(on ? null : t.id)}
              className={cx(
                "group flex flex-col rounded-2xl bg-white p-4 text-left ring-1 transition dark:bg-slate-900",
                on ? "ring-2 ring-brand-500 shadow-[0_18px_40px_-24px_rgba(20,92,255,0.7)]" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10 dark:hover:ring-white/30",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={cx("flex size-10 items-center justify-center rounded-xl", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-500 dark:bg-brand-900/30")}>
                  <t.icon className="size-5" strokeWidth={1.75} />
                </span>
                {b ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <CheckCircle2 className="size-3" /> {b}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.how}</span>
                )}
              </span>
              <span className="mt-3 font-display text-[15px] font-bold text-slate-900 dark:text-white">{t.title}</span>
              <span className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{t.text}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                {on ? "Guide ouvert" : "Voir le guide"} <ArrowRight className={cx("size-3.5 transition-transform", on ? "rotate-90" : "group-hover:translate-x-0.5")} />
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
              aria-label="Fermer le guide"
              className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X className="size-5" />
            </button>
            <div className="max-w-3xl">
              {tool.id === "shopify" && <ShopifyGuide done={done.shopify} onDone={mark("shopify")} />}
              {tool.api && <ApiGuide key={tool.id} kind={tool.api} done={done[tool.id]} onDone={mark(tool.id)} onUseFile={() => open("file")} onKeyCreated={() => void status.reload()} />}
              {tool.id === "app" && <AppGuide done={done.app} onDone={mark("app")} />}
              {tool.id === "file" && <FileGuide done={done.file} onDone={mark("file")} />}
            </div>
          </Card>
        ) : (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-300 px-5 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Vous ne trouvez pas votre outil ? S'il sait faire un appel web ou exporter un fichier, il se branche :{" "}
            <button type="button" onClick={() => open("other")} className="font-semibold text-brand-500 hover:text-brand-600">
              voir comment
            </button>
            .
          </p>
        )}
      </div>

      <Simulator onDone={() => toast.success("Événement simulé", "Les automatisations correspondantes ont été déclenchées.")} />
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
      toast.error("Indiquez l'email d'un contact");
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
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Tester vos automatisations sans boutique réelle</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Simulez un événement pour un contact (créé s'il n'existe pas) et regardez vos scénarios partir.</p>
      <div className="mt-3 flex flex-col flex-wrap gap-2 sm:flex-row">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@exemple.fr" className="sm:max-w-xs" aria-label="Email du contact" />
        <Button variant="secondary" icon={ShoppingBag} onClick={() => void simulate("order")} loading={busy === "order"}>
          Commande
        </Button>
        <Button variant="secondary" icon={Package} onClick={() => void simulate("order_fulfilled")} loading={busy === "order_fulfilled"}>
          Expédition
        </Button>
        <Button variant="secondary" icon={ShoppingCart} onClick={() => void simulate("cart_abandoned")} loading={busy === "cart_abandoned"}>
          Panier abandonné
        </Button>
      </div>
    </Card>
  );
}

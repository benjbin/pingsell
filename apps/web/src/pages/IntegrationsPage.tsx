import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowRight, Code2, KeyRound, Link2, Package, RefreshCw, ShoppingBag, ShoppingCart, Unplug } from "lucide-react";
import { API_URL, api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDateTime } from "../lib/format";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Skeleton } from "../components/ui/primitives";
import { ConfirmModal } from "../components/ui/Overlay";
import { useToast } from "../components/ui/Toast";

function ShopifyLogo() {
  return (
    <span className="flex size-11 items-center justify-center rounded-xl bg-[#95BF47]/15 text-[#5E8E3E]">
      <ShoppingBag className="size-5" />
    </span>
  );
}

export function IntegrationsPage() {
  const toast = useToast();
  const integrations = useAsync(() => api.integrations.list(), []);
  const shopify = integrations.data?.find((i) => i.provider === "shopify");
  const connected = !!shopify && shopify.connected !== false;

  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [simEmail, setSimEmail] = useState("");
  const [simulating, setSimulating] = useState<"order" | "order_fulfilled" | "cart_abandoned" | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setConnecting(true);
    try {
      const domain = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
      await api.integrations.shopify.connect({ shop_domain: domain, access_token: accessToken.trim() });
      toast.success("Boutique connectée", "La synchronisation initiale a démarré.");
      setAccessToken("");
      await integrations.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setConnecting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await api.integrations.shopify.sync();
      toast.success("Synchronisation terminée", `${res.customers} clients et ${res.orders} commandes importés.`);
      await integrations.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api.integrations.shopify.disconnect();
      toast.success("Boutique déconnectée");
      setDisconnectOpen(false);
      await integrations.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setDisconnecting(false);
    }
  }

  async function simulate(type: "order" | "order_fulfilled" | "cart_abandoned") {
    if (!simEmail.trim()) {
      toast.error("Indiquez l'email d'un contact");
      return;
    }
    setSimulating(type);
    try {
      await api.integrations.shopify.simulate({ type, email: simEmail.trim() });
      toast.success(
        type === "order" ? "Commande simulée" : type === "order_fulfilled" ? "Expédition simulée" : "Panier abandonné simulé",
        "Les automatisations correspondantes ont été déclenchées.",
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setSimulating(null);
    }
  }

  return (
    <>
      <PageHeader title="Intégrations" description="Connectez votre boutique et vos outils à Missive." />

      {integrations.error && (
        <div className="mb-6">
          <ErrorState message={integrations.error} onRetry={integrations.reload} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex flex-wrap items-start gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
            <ShopifyLogo />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-slate-900 dark:text-white">Shopify</h2>
                {integrations.loading ? (
                  <Skeleton className="h-5 w-20 rounded-full" />
                ) : connected ? (
                  shopify?.status === "error" ? (
                    <Badge tone="red" dot>
                      Erreur
                    </Badge>
                  ) : (
                    <Badge tone="green" dot>
                      Connectée
                    </Badge>
                  )
                ) : (
                  <Badge tone="slate">Non connectée</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Synchronisez clients et commandes, déclenchez des automatisations sur les achats et paniers abandonnés.
              </p>
            </div>
          </div>

          <div className="p-5">
            {integrations.loading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : connected && shopify ? (
              <div className="space-y-6">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Boutique</dt>
                    <dd className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-white">{shopify.shop_domain}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Dernière synchronisation</dt>
                    <dd className="mt-0.5 text-sm font-medium text-slate-900 dark:text-white">{shopify.last_sync_at ? formatDateTime(shopify.last_sync_at) : "Jamais"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button icon={RefreshCw} onClick={sync} loading={syncing}>
                    Synchroniser maintenant
                  </Button>
                  <Button variant="ghost" icon={Unplug} onClick={() => setDisconnectOpen(true)} className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                    Déconnecter
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={connect} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Domaine de la boutique" htmlFor="shop-domain">
                    <Input id="shop-domain" required value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} placeholder="ma-boutique.myshopify.com" />
                  </Field>
                  <Field label="Jeton d'accès Admin API" htmlFor="shop-token">
                    <Input id="shop-token" type="password" required value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="shpat_…" autoComplete="off" />
                  </Field>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dans Shopify : Paramètres › Applications › Développer des applications › créez une application avec les accès <code>read_customers</code>,{" "}
                  <code>read_orders</code> et <code>read_checkouts</code>, puis copiez le jeton Admin API.
                </p>
                <Button type="submit" icon={Link2} loading={connecting}>
                  Connecter la boutique
                </Button>
              </form>
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-900/40">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Tester sans boutique réelle</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Simulez un événement Shopify pour un contact (créé s'il n'existe pas) afin de tester vos automatisations.
            </p>
            <div className="mt-3 flex flex-col flex-wrap gap-2 sm:flex-row">
              <Input type="email" value={simEmail} onChange={(e) => setSimEmail(e.target.value)} placeholder="contact@exemple.fr" className="sm:max-w-xs" aria-label="Email du contact" />
              <Button variant="secondary" icon={ShoppingBag} onClick={() => void simulate("order")} loading={simulating === "order"}>
                Simuler une commande
              </Button>
              <Button variant="secondary" icon={Package} onClick={() => void simulate("order_fulfilled")} loading={simulating === "order_fulfilled"}>
                Simuler une expédition
              </Button>
              <Button variant="secondary" icon={ShoppingCart} onClick={() => void simulate("cart_abandoned")} loading={simulating === "cart_abandoned"}>
                Simuler un panier abandonné
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
              <Code2 className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold text-slate-900 dark:text-white">API publique</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Ajoutez des contacts, taguez-les et lancez des campagnes depuis votre propre code avec une clé API.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">
              {`curl -X POST ${API_URL}/api/v1/contacts \\
  -H "Authorization: Bearer msv_…" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"client@exemple.fr"}'`}
            </pre>
            <Link to="/parametres" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              <KeyRound className="size-4" /> Gérer les clés API <ArrowRight className="size-4" />
            </Link>
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={disconnect}
        loading={disconnecting}
        danger
        title="Déconnecter Shopify ?"
        description="La synchronisation s'arrêtera. Les contacts déjà importés sont conservés."
        confirmLabel="Déconnecter"
      />
    </>
  );
}

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Smartphone,
  Unplug,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { API_URL, api } from "../../lib/api";
import { cx, formatDateTime } from "../../lib/format";
import { Button, Field, Input } from "../ui/primitives";
import { ConfirmModal } from "../ui/Overlay";
import { CopyButton } from "../CopyButton";
import { useToast } from "../ui/Toast";
import { ImportContactsModal } from "../../pages/contacts/ImportContactsModal";
import { t, LOCALE } from "../../lib/i18n";

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

/** Polls `check` every 3 s while `active`, until it returns true. */
export function usePoll(active: boolean, check: () => Promise<boolean>) {
  const [hit, setHit] = useState(false);
  const fn = useRef(check);
  fn.current = check;
  useEffect(() => {
    if (!active || hit) return;
    let stop = false;
    const tick = async () => {
      try {
        if (await fn.current()) setHit(true);
      } catch {
        /* keep polling */
      }
    };
    const id = setInterval(() => !stop && void tick(), 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [active, hit]);
  return hit;
}

export function GuideHead({ icon: Icon, title, text, done }: { icon: LucideIcon; title: string; text: ReactNode; done?: string }) {
  return (
    <div className="mb-7">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="mt-3 text-[15px] text-slate-600 dark:text-slate-300">{text}</div>
      {done && <Success>{done}</Success>}
    </div>
  );
}

export function Success({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
      <CheckCircle2 className="size-5 shrink-0" /> {children}
    </p>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <Loader2 className="size-4 shrink-0 animate-spin text-brand-500" /> {children}
    </p>
  );
}

export function Code({ code }: { code: string }) {
  return (
    <div className="relative min-w-0">
      <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 pt-12 text-[12.5px] leading-relaxed text-slate-200">{code}</pre>
      <div className="absolute top-2.5 right-2.5">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

/** Numbered, vertical walkthrough. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-0">{children}</ol>;
}

export function Step({ n, title, done, last, children }: { n: number; title: string; done?: boolean; last?: boolean; children?: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-slate-200 dark:bg-slate-700" />}
      <span
        className={cx(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold",
          done ? "bg-emerald-500 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h3 className="font-display text-[15px] font-bold text-slate-900 dark:text-white">{title}</h3>
        {children && <div className="mt-2.5 space-y-3 text-sm text-slate-600 dark:text-slate-300">{children}</div>}
      </div>
    </li>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[] | Array<{ id: T; label: string }>; onChange: (v: T) => void; label: string }) {
  const items = (options as Array<T | { id: T; label: string }>).map((o) => (typeof o === "string" ? { id: o, label: o } : o));
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {items.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition",
            value === o.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-brand-50/70 px-4 py-3 text-sm text-slate-700 dark:bg-brand-500/15 dark:text-slate-200">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-slate-900 dark:text-white">{children}</span>;
}

export interface GuideProps {
  /** Success message once connected (controlled by the parent, e.g. the onboarding flow). */
  done?: string;
  onDone: (label: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Shopify                                                                    */
/* -------------------------------------------------------------------------- */

export function ShopifyGuide({ done, onDone, returnTo }: GuideProps & { returnTo?: "onboarding" }) {
  const toast = useToast();
  const [status, setStatus] = useState<{ connected: boolean; error: boolean; shop: string | null; lastSync: string | null; oauth: boolean } | null>(null);
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function load() {
    try {
      const r = await api.integrations.shopify.status();
      const connected = !!r.integration && r.integration.connected !== false;
      setStatus({
        connected,
        error: r.integration?.status === "error",
        shop: r.integration?.shop_domain ?? null,
        lastSync: r.integration?.last_sync_at ?? null,
        oauth: r.oauth_available,
      });
      if (connected) onDone(
          t(
            `Boutique ${r.integration?.shop_domain ?? ""} connectée : clients et commandes synchronisés automatiquement`,
            `Store ${r.integration?.shop_domain ?? ""} connected: customers and orders sync automatically`,
          ),
        );
    } catch {
      setStatus({ connected: false, error: false, shop: null, lastSync: null, oauth: false });
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domain = () => (shop.trim().includes(".") ? shop.trim() : `${shop.trim()}.myshopify.com`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (status?.oauth) {
        if (returnTo === "onboarding") sessionStorage.setItem("missive_onboarding_return", "1");
        window.location.href = await api.integrations.shopify.installUrl(domain());
        return;
      }
      await api.integrations.shopify.connect({ shop_domain: domain(), access_token: token.trim() });
      setToken("");
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.integrations.shopify.sync();
      toast.success(
        t("Synchronisation terminée", "Sync complete"),
        t(
          `${r.customers} clients et ${r.orders} commandes importés.`,
          `${r.customers} customer${r.customers === 1 ? "" : "s"} and ${r.orders} order${r.orders === 1 ? "" : "s"} imported.`,
        ),
      );
      await load();
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
      toast.success(t("Boutique déconnectée", "Store disconnected"));
      setConfirm(false);
      onDone("");
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <>
      <GuideHead
        icon={ShoppingBag}
        title={t("Connecter Shopify", "Connect Shopify")}
        text={t("Vos clients, leurs commandes, les expéditions et les paniers abandonnés arrivent tout seuls dans Pingsell, et restent à jour en continu.", "Your customers, their orders, shipments and abandoned carts flow into Pingsell automatically and stay up to date.")}
        done={done || undefined}
      />

      {!status ? (
        <Waiting>{t("Vérification de votre boutique…", "Checking your store…")}</Waiting>
      ) : status.connected ? (
        <div className="space-y-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{t("Boutique", "Store")}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{status.shop}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{t("Dernière synchronisation", "Last sync")}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{status.lastSync ? formatDateTime(status.lastSync) : t("En cours…", "In progress…")}</dd>
            </div>
          </dl>
          {status.error && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {t("La dernière synchronisation a échoué. Vérifiez que l'application Pingsell est toujours installée dans Shopify, puis relancez.", "The last sync failed. Make sure the Pingsell app is still installed in Shopify, then try again.")}
            </p>
          )}
          <Hint>
            {t(
              <>
                Ce qui arrive automatiquement : <Kbd>nouveaux clients</Kbd>, <Kbd>commandes passées</Kbd>, <Kbd>commandes expédiées</Kbd> et <Kbd>paniers abandonnés</Kbd>. Chacun peut lancer une automatisation.
              </>,
              <>
                What syncs automatically: <Kbd>new customers</Kbd>, <Kbd>orders placed</Kbd>, <Kbd>orders shipped</Kbd> and <Kbd>abandoned carts</Kbd>. Each one can trigger an automation.
              </>,
            )}
          </Hint>
          <div className="flex flex-wrap gap-2">
            <Button icon={RefreshCw} onClick={() => void sync()} loading={syncing}>
              {t("Synchroniser maintenant", "Sync now")}
            </Button>
            <Button variant="ghost" icon={Unplug} onClick={() => setConfirm(true)} className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              {t("Déconnecter", "Disconnect")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <Steps>
            <Step n={1} title={t("Indiquez l'adresse de votre boutique", "Enter your store address")} last={status.oauth}>
              <p>{t("C'est l'adresse qui finit par .myshopify.com, visible dans Shopify en haut à gauche ou dans Paramètres › Domaines.", "It's the address ending in .myshopify.com, shown at the top left in Shopify or under Settings › Domains.")}</p>
              <Field label={t("Adresse de la boutique", "Store address")} htmlFor="cg-shop">
                <div className="flex items-center rounded-xl bg-white ring-1 ring-slate-900/15 focus-within:ring-2 focus-within:ring-brand-500 dark:bg-slate-950 dark:ring-white/15">
                  <input
                    id="cg-shop"
                    required
                    value={shop}
                    onChange={(e) => setShop(e.target.value.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}
                    placeholder={t("ma-boutique", "my-store")}
                    className="h-11 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none dark:text-white"
                    autoComplete="off"
                  />
                  {!shop.includes(".") && <span className="pr-4 text-sm text-slate-400">.myshopify.com</span>}
                </div>
              </Field>
              {status.oauth && (
                <>
                  <p>{t("Shopify vous demandera d'autoriser Pingsell à lire vos clients et vos commandes, puis vous ramènera ici.", "Shopify will ask you to allow Pingsell to read your customers and orders, then bring you back here.")}</p>
                  <Button type="submit" size="lg" icon={Link2} loading={busy}>
                    {t("Connecter en 1 clic", "Connect in 1 click")}
                  </Button>
                </>
              )}
            </Step>
            {!status.oauth && (
              <>
                <Step n={2} title={t("Ouvrez votre application personnalisée dans Shopify", "Open your custom app in Shopify")}>
                  <ol className="list-decimal space-y-1.5 pl-5">
                    <li>
                      {t(
                        <>
                          Dans l'admin Shopify, ouvrez <Kbd>Paramètres › Applications et canaux de vente</Kbd>, puis <Kbd>Développer des applications</Kbd>.
                        </>,
                        <>
                          In the Shopify admin, open <Kbd>Settings › Apps and sales channels</Kbd>, then <Kbd>Develop apps</Kbd>.
                        </>,
                      )}
                    </li>
                    <li>{t("Ouvrez l'application personnalisée de votre boutique (ou celle créée pour Pingsell).", "Open your store's custom app (or the one created for Pingsell).")}</li>
                    <li>
                      {t(
                        <>
                          Dans <Kbd>Configuration › Admin API</Kbd>, vérifiez que <code>read_customers</code>, <code>read_orders</code> et <code>read_checkouts</code> sont cochés, puis
                          enregistrez.
                        </>,
                        <>
                          In <Kbd>Configuration › Admin API</Kbd>, make sure <code>read_customers</code>, <code>read_orders</code> and <code>read_checkouts</code> are checked, then save.
                        </>,
                      )}
                    </li>
                  </ol>
                  <Hint>
                    {t(
                      "Pingsell ne demande que la lecture : rien n'est modifié dans votre boutique. Depuis 2026, Shopify ne permet plus de créer de nouvelles applications depuis l'admin : si vous n'en avez pas, la connexion en 1 clic s'en charge à votre place.",
                      "Pingsell only asks for read access: nothing in your store is changed. Since 2026, Shopify no longer lets you create new apps from the admin. If you don't have one, 1-click connect handles it for you.",
                    )}
                  </Hint>
                </Step>
                <Step n={3} title={t("Collez le jeton d'accès", "Paste the access token")} last>
                  <p>
                    {t(
                      <>
                        Toujours dans l'application, onglet <Kbd>Identifiants API</Kbd> : affichez le <Kbd>jeton d'accès Admin API</Kbd> (il commence par shpat_) et collez-le ici. Shopify ne le montre qu'une fois : s'il a déjà été révélé, désinstallez puis réinstallez
                        l'application pour en obtenir un nouveau.
                      </>,
                      <>
                        Still in the app, on the <Kbd>API credentials</Kbd> tab, reveal the <Kbd>Admin API access token</Kbd> (it starts with shpat_) and paste it here. Shopify only shows it once: if it was already revealed, uninstall and reinstall the app
                        to get a new one.
                      </>,
                    )}
                  </p>
                  <Field label={t("Jeton d'accès Admin API", "Admin API access token")} htmlFor="cg-token">
                    <Input id="cg-token" type="password" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" autoComplete="off" />
                  </Field>
                  <Button type="submit" size="lg" icon={Link2} loading={busy}>
                    {t("Connecter la boutique", "Connect store")}
                  </Button>
                  <p className="text-xs text-slate-500">{t("La première synchronisation démarre aussitôt : vos clients et vos commandes passées sont importés.", "The first sync starts right away: your customers and past orders are imported.")}</p>
                </Step>
              </>
            )}
          </Steps>
        </form>
      )}

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={disconnect}
        loading={disconnecting}
        danger
        title={t("Déconnecter Shopify ?", "Disconnect Shopify?")}
        description={t("La synchronisation s'arrêtera. Les contacts déjà importés sont conservés.", "Syncing will stop. Contacts already imported are kept.")}
        confirmLabel={t("Déconnecter", "Disconnect")}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* API: site, CRM, caisse, back-office, tout autre outil                     */
/* -------------------------------------------------------------------------- */

export type ApiKind = "site" | "crm" | "pos" | "backoffice" | "other";
type Lang = "cURL" | "Node.js" | "PHP" | "Python";

const KINDS: Record<ApiKind, { icon: LucideIcon; title: string; intro: string; label: string }> = {
  site: {
    icon: Code2,
    title: t("Brancher votre site web", "Connect your website"),
    intro: t("Site sur mesure, WordPress, Webflow avec un back-end… Votre site prévient Pingsell de ce qui se passe (inscription, panier, commande, expédition). Ce que vos clients reçoivent ensuite, vous le réglez dans Automatisations.", "Custom site, WordPress, Webflow with a back end… Your site tells Pingsell what happens (sign-up, cart, order, shipping). What your customers receive next, you set up in Automations."),
    label: t("Mon site web", "My website"),
  },
  crm: {
    icon: Code2,
    title: t("Brancher votre CRM", "Connect your CRM"),
    intro: t("Quand une fiche client est créée ou qualifiée dans votre CRM, elle arrive dans Pingsell avec ses tags, et vos scénarios démarrent.", "When a customer record is created or qualified in your CRM, it lands in Pingsell with its tags, and your workflows kick in."),
    label: t("Mon CRM", "My CRM"),
  },
  pos: {
    icon: Code2,
    title: t("Brancher votre caisse", "Connect your POS"),
    intro: t("À chaque ticket où le client laisse son email, Pingsell reçoit la vente : remerciement, fidélité et relances partent tout seuls.", "Whenever a customer leaves their email at checkout, Pingsell gets the sale: thank-yous, loyalty and follow-ups go out on their own."),
    label: t("Ma caisse", "My POS"),
  },
  backoffice: {
    icon: Code2,
    title: t("Brancher votre back-office", "Connect your back office"),
    intro: t("ERP, outil de gestion des commandes ou logistique : envoyez les commandes et leur expédition, Pingsell prévient le client par email ou par notification.", "ERP, order management or logistics tool: send orders and their shipping, and Pingsell notifies the customer by email or push notification."),
    label: t("Mon back-office", "My back office"),
  },
  other: {
    icon: Code2,
    title: t("Brancher n'importe quel outil", "Connect any tool"),
    intro: t("Tout ce qui sait faire un appel web peut alimenter Pingsell, dans n'importe quel langage.", "Anything that can make a web request can feed Pingsell, in any language."),
    label: t("Mon outil", "My tool"),
  },
};

/** What a site can put in `event`. Informational: one call, the name says what happened. */
const SIGNALS: Array<{ name: string; when: string; extra: string; effect: string }> = [
  {
    name: "inscription",
    when: t("Inscription, compte créé, newsletter", "Sign-up, account created, newsletter"),
    extra: "tags",
    effect: t("Crée ou met à jour le client → « Nouveau contact », « Tag ajouté »", "Creates or updates the customer → “New contact”, “Tag added”"),
  },
  {
    name: "panier",
    when: t("Le client a saisi son email au paiement, puis à chaque changement", "Customer entered their email at checkout, then on every change"),
    extra: "id, total, url, items",
    effect: t("Sans commande dans l'heure → « Panier abandonné »", "No order within the hour → “Abandoned cart”"),
  },
  {
    name: "commande",
    when: t("Paiement validé", "Payment confirmed"),
    extra: "id, total, currency",
    effect: t("Ajoute la vente à la fiche → « Commande passée », annule la relance panier", "Adds the sale → “Order placed”, cancels the cart reminder"),
  },
  {
    name: "expedition",
    when: t("Colis remis au transporteur", "Parcel handed to the carrier"),
    extra: "id, carrier, tracking_number, url",
    effect: t("→ « Commande expédiée » (transactionnel)", "→ “Order shipped” (transactional)"),
  },
  {
    name: t("tout autre nom", "any other name"),
    when: t("reservation, rendez_vous, avis, abonnement, anniversaire, devis…", "booking, appointment, review, subscription, birthday, quote…"),
    extra: t("id, date + tous vos champs", "id, date + any field you like"),
    effect: t("→ « Événement de votre site » : vous choisissez quoi envoyer et quand (ex : 24 h avant la date)", "→ “Event from your site”: you choose what to send and when (e.g. 24 h before the date)"),
  },
];

const EXAMPLE_BODY = {
  event: "reservation",
  email: "camille@exemple.fr",
  first_name: "Camille",
  id: "R-2041",
  date: "2026-12-24T19:30:00+01:00",
  couverts: 4,
};

function phpValue(v: unknown, indent = ""): string {
  if (Array.isArray(v)) return `[${v.map((x) => phpValue(x, indent)).join(", ")}]`;
  if (v && typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${indent}  "${k}" => ${phpValue(x, indent + "  ")}`)
      .join(",\n");
    return `[\n${inner},\n${indent}]`;
  }
  return JSON.stringify(v);
}

function snippet(lang: Lang, key: string, path: string, body: Record<string, unknown>): string {
  const url = `${API_URL}/api/v1${path}`;
  const json = JSON.stringify(body, null, 2);
  switch (lang) {
    case "cURL":
      return `curl -X POST ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
    case "Node.js":
      return `await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${key}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${json.replace(/\n/g, "\n  ")}),
});`;
    case "PHP":
      return `$ch = curl_init("${url}");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer ${key}", "Content-Type: application/json"],
  CURLOPT_POSTFIELDS => json_encode(${phpValue(body, "  ")}),
]);
curl_exec($ch);`;
    case "Python":
      return `import requests

requests.post(
  "${url}",
  headers={"Authorization": "Bearer ${key}"},
  json=${json.replace(/\n/g, "\n  ")},
)`;
  }
}

const keyStore = (kind: ApiKind) => `missive_api_key_${kind}`;

/** The full key is shown only once: keep it for this browser session so switching guides doesn't lose it. */
function loadKey(kind: ApiKind): { id: string; key: string } | null {
  try {
    const raw = sessionStorage.getItem(keyStore(kind));
    return raw ? (JSON.parse(raw) as { id: string; key: string }) : null;
  } catch {
    return null;
  }
}

export function ApiGuide({
  done,
  onDone,
  kind = "other",
  onUseFile,
  onKeyCreated,
}: GuideProps & { kind?: ApiKind; onUseFile?: () => void; onKeyCreated?: () => void }) {
  const toast = useToast();
  const meta = KINDS[kind];
  const [key, setKey] = useState<{ id: string; key: string } | null>(() => loadKey(kind));
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>("cURL");

  const received = usePoll(!!key && !done, async () => {
    const keys = await api.apiKeys.list();
    return !!keys.find((k) => k.id === key?.id)?.last_used_at;
  });
  useEffect(() => {
    if (!received) return;
    onDone(t("Premier appel reçu de votre outil. Vérifiez le contact dans Contacts : c'est branché !", "First call received from your tool. Check the contact in Contacts: you're connected!"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  async function generate() {
    setBusy(true);
    try {
      const created = await api.apiKeys.create(meta.label);
      if (created.key) {
        const k = { id: created.id, key: created.key };
        setKey(k);
        try {
          sessionStorage.setItem(keyStore(kind), JSON.stringify(k));
        } catch {
          /* private mode */
        }
        onKeyCreated?.();
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const apiKey = key?.key ?? t("VOTRE_CLE_API", "YOUR_API_KEY");

  return (
    <>
      <GuideHead icon={meta.icon} title={meta.title} text={meta.intro} done={done || undefined} />
      <Steps>
        <Step n={1} title={t("Créez la clé secrète de votre outil", "Create your tool's secret key")} done={!!key}>
          {!key ? (
            <>
              <p>{t("Elle identifie votre compte. Gardez-la côté serveur : jamais dans une page web ni dans une app mobile.", "It identifies your account. Keep it on the server, never in a web page or mobile app.")}</p>
              <Button icon={KeyRound} loading={busy} onClick={() => void generate()}>
                {t("Générer ma clé API", "Generate my API key")}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center dark:bg-slate-800/60">
                <KeyRound className="size-4 shrink-0 text-brand-500" />
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white">{key.key}</code>
                <CopyButton text={key.key} />
              </div>
              <p className="text-xs text-slate-500">{t("Copiez-la maintenant : elle ne sera plus affichée en entier. Vous gérez vos clés dans Paramètres.", "Copy it now: it won't be shown in full again. You manage your keys in Settings.")}</p>
            </>
          )}
        </Step>

        <Step n={2} title={t("Collez cet appel partout où il se passe quelque chose", "Paste this call wherever something happens")}>
          <p>
            {t(
              <>
                Un seul appel pour tout. Seul le nom dans <code>event</code> change : inscription, panier, commande, expédition, réservation, rendez-vous… Ce que vos clients reçoivent ensuite se règle dans{" "}
                <Link to="/automatisations" className="font-semibold text-brand-500 hover:text-brand-600">Automatisations</Link>, sans retoucher au code.
              </>,
              <>
                One call for everything. Only the name in <code>event</code> changes: sign-up, cart, order, shipping, booking, appointment… What your customers receive next is set up in{" "}
                <Link to="/automatisations" className="font-semibold text-brand-500 hover:text-brand-600">Automations</Link>, without touching the code again.
              </>,
            )}
          </p>
          <Tabs label={t("Langage", "Language")} value={lang} onChange={setLang} options={["cURL", "Node.js", "PHP", "Python"] as const} />
          <Code code={snippet(lang, apiKey, "/events", EXAMPLE_BODY)} />
          <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-900/10 dark:ring-white/10">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">event</th>
                  <th className="px-3 py-2 font-semibold">{t("Quand l'envoyer", "When to send it")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Champs utiles", "Useful fields")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Ce qui se passe", "What happens")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/5 dark:divide-white/5">
                {SIGNALS.map((sig) => (
                  <tr key={sig.name} className="align-top">
                    <td className="px-3 py-2.5"><code className="font-mono font-semibold text-slate-900 dark:text-white">{sig.name}</code></td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{sig.when}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300">{sig.extra}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{sig.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            {t(
              <>
                Toujours obligatoires : <code>event</code> et <code>email</code>. Le même <code>id</code> renvoyé met à jour au lieu de doublonner (une réservation déplacée décale son rappel). Pour annuler, renvoyez-le avec <code>"status": "annule"</code>. Ajoutez <code>"transactional": true</code> pour un rappel de réservation ou un reçu : il atteint aussi les clients désabonnés des promos.
              </>,
              <>
                Always required: <code>event</code> and <code>email</code>. Sending the same <code>id</code> again updates instead of duplicating (a moved booking shifts its reminder). To cancel, send it again with <code>"status": "cancelled"</code>. Add <code>"transactional": true</code> for a booking reminder or a receipt: it also reaches customers unsubscribed from promotions.
              </>,
            )}
          </p>
        </Step>

        <Step n={3} title={t("Faites un essai", "Run a test")} done={!!done} last>
          {done ? (
            <p>{t("Tout fonctionne. Activez maintenant un scénario dans Automatisations pour que les messages partent tout seuls.", "Everything works. Now turn on a workflow in Automations so messages go out on their own.")}</p>
          ) : key ? (
            <Waiting>{t("Lancez le code une fois (ou la commande cURL dans un terminal) : on vous confirme ici dès que Pingsell reçoit l'appel.", "Run the code once (or the cURL command in a terminal) and we'll confirm here as soon as Pingsell receives the call.")}</Waiting>
          ) : (
            <p>{t("Générez la clé à l'étape 1 : on détectera votre premier appel en direct, ici.", "Generate the key in step 1 and we'll detect your first call live, right here.")}</p>
          )}
        </Step>
      </Steps>

      {onUseFile && (
        <p className="mt-7 border-t border-slate-900/10 pt-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          {t(
            <>
              Pas de développeur sous la main ? Exportez vos clients depuis votre outil et{" "}
              <button type="button" onClick={onUseFile} className="font-semibold text-brand-500 hover:text-brand-600">
                importez le fichier
              </button>{" "}
              : c'est prêt en une minute.
            </>,
            <>
              No developer on hand? Export your customers from your tool and{" "}
              <button type="button" onClick={onUseFile} className="font-semibold text-brand-500 hover:text-brand-600">
                import the file
              </button>
              . You'll be ready in a minute.
            </>,
          )}
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* App mobile                                                                 */
/* -------------------------------------------------------------------------- */

export function AppGuide({ done, onDone }: GuideProps) {
  const [appKey, setAppKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<number | null>(null);
  const [stack, setStack] = useState<"expo" | "native">("expo");
  const [failed, setFailed] = useState(false);
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    api.push
      .config()
      .then((c) => {
        setAppKey(c.app_key);
        setDevices(c.devices.total);
        baseline.current = c.devices.total;
      })
      .catch(() => setFailed(true));
  }, []);

  const received = usePoll(!!appKey && !done, async () => {
    const c = await api.push.config();
    return baseline.current !== null && c.devices.total > baseline.current;
  });
  useEffect(() => {
    if (received) onDone(t("Nouveau téléphone enregistré : vous pouvez lui envoyer des notifications", "New phone registered: you can now send it notifications"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  const k = appKey ?? "msvapp_…";

  return (
    <>
      <GuideHead
        icon={Smartphone}
        title={t("Brancher votre app mobile", "Connect your mobile app")}
        text={t("Notifications sur l'écran verrouillé, centre de notifications dans l'app et écran de permission : tout est déjà construit, il suffit de le brancher.", "Lock-screen notifications, an in-app notification center and a pre-permission screen: it's all built, you just plug it in.")}
        done={done || undefined}
      />
      <div className="mb-6">
        <Tabs
          label={t("Technologie de l'app", "App technology")}
          value={stack}
          onChange={setStack}
          options={[
            { id: "expo", label: "React Native / Expo" },
            { id: "native", label: "Swift, Kotlin, Flutter" },
          ]}
        />
      </div>

      {stack === "expo" ? (
        <Steps>
          <Step n={1} title={t("Installez le kit Pingsell", "Install the Pingsell SDK")}>
            <Code code="npx expo install @pingsell/expo-push expo-notifications" />
          </Step>
          <Step n={2} title={t("Initialisez-le au démarrage de l'app", "Initialize it when the app starts")}>
            <p>{t("Votre clé d'application est déjà remplie. Elle est publique : elle peut rester dans l'app.", "Your app key is already filled in. It's public, so it can live in the app.")}</p>
            <Code
              code={`// App.tsx
import { Pingsell, PingsellPermissionPrompt } from "@pingsell/expo-push";

Pingsell.init({ appKey: "${k}", apiUrl: "${API_URL}" });`}
            />
          </Step>
          <Step n={3} title={t("Reliez le téléphone au client, puis demandez la permission", "Link the phone to the customer, then ask for permission")}>
            <p>{t("À la connexion du client, pour que ses notifications et ses automatisations le suivent :", "When the customer signs in, so their notifications and automations follow them:")}</p>
            <Code
              code={`await Pingsell.identify({ email: user.email });
await Pingsell.requestPermission();

// ${t("Une seule fois, à la racine de l'app :", "Once, at the root of the app:")}
<PingsellPermissionPrompt />`}
            />
            <Hint>
              {t("Pingsell affiche d'abord un écran à vos couleurs (réglable dans Notifications push) avant la fenêtre du système : bien plus de clients disent oui.", "Pingsell first shows a pre-permission screen in your brand colors (configurable in Push notifications) before the system prompt, so far more customers say yes.")}
            </Hint>
          </Step>
          <Step n={4} title={t("Option : le centre de notifications", "Optional: the notification center")}>
            <Code code={`import { PingsellInbox } from "@pingsell/expo-push";\n\n<PingsellInbox />`} />
          </Step>
          <Step n={5} title={t("Testez sur un vrai téléphone", "Test on a real phone")} done={!!done} last>
            {done ? (
              <p>{t("Envoyez-lui une notification de test depuis Notifications push.", "Send it a test notification from Push notifications.")}</p>
            ) : appKey ? (
              <Waiting>{t("Lancez l'app sur un téléphone et acceptez les notifications : on vous confirme ici dès qu'il est enregistré.", "Open the app on a phone and allow notifications. We'll confirm here as soon as it's registered.")}</Waiting>
            ) : failed ? (
              <p className="text-red-600 dark:text-red-400">{t("Impossible de charger votre clé d'application. Rechargez la page.", "Couldn't load your app key. Reload the page.")}</p>
            ) : (
              <Waiting>{t("Chargement de votre clé d'application…", "Loading your app key…")}</Waiting>
            )}
          </Step>
        </Steps>
      ) : (
        <Steps>
          <Step n={1} title={t("Récupérez le jeton de notification", "Get the push token")}>
            <p>{t("Comme d'habitude sur chaque plateforme : APNs sur iOS, Firebase Cloud Messaging sur Android ou Flutter.", "As usual on each platform: APNs on iOS, Firebase Cloud Messaging on Android or Flutter.")}</p>
          </Step>
          <Step n={2} title={t("Enregistrez le téléphone chez Pingsell", "Register the phone with Pingsell")}>
            <p>{t("Un appel web, avec votre clé d'application et l'email du client connecté :", "One web request, with your app key and the signed-in customer's email:")}</p>
            <Code
              code={`POST ${API_URL}/api/v1/push/app/devices
Authorization: Bearer ${k}
Content-Type: application/json

{
  "token": "${t("<jeton APNs ou FCM>", "<APNs or FCM token>")}",
  "platform": "ios",
  "email": "camille@exemple.fr"
}`}
            />
            <p className="text-xs text-slate-500">{t("platform vaut ios ou android. Une app iOS qui passe par Firebase ajoute \"provider\": \"fcm\".", "platform is ios or android. An iOS app that uses Firebase adds \"provider\": \"fcm\".")}</p>
          </Step>
          <Step n={3} title={t("Testez sur un vrai téléphone", "Test on a real phone")} done={!!done} last>
            {done ? <p>{t("Envoyez-lui une notification de test depuis Notifications push.", "Send it a test notification from Push notifications.")}</p> : <Waiting>{t("On vous confirme ici dès que le premier téléphone est enregistré.", "We'll confirm here as soon as the first phone is registered.")}</Waiting>}
          </Step>
        </Steps>
      )}

      <p className="mt-7 border-t border-slate-900/10 pt-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        {devices
          ? t(
              `${devices.toLocaleString(LOCALE)} appareil(s) déjà enregistré(s). `,
              `${devices.toLocaleString(LOCALE)} device${devices === 1 ? "" : "s"} already registered. `,
            )
          : ""}
        {t("Clés iOS et Android, écran de permission et tests :", "iOS and Android keys, pre-permission screen and testing:")}{" "}
        <Link to="/notifications" className="font-semibold text-brand-500 hover:text-brand-600">
          {t("Notifications push", "Push notifications")}
        </Link>
        .
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Fichier                                                                    */
/* -------------------------------------------------------------------------- */

const EXPORTS = [
  { id: "mailchimp", label: "Mailchimp", how: t("Audience › All contacts › Export Audience, puis téléchargez le fichier CSV.", "Audience › All contacts › Export Audience, then download the CSV file.") },
  { id: "brevo", label: "Brevo", how: t("Contacts › cochez tous les contacts › Exporter, au format CSV.", "Contacts › select all contacts › Export, as CSV.") },
  { id: "klaviyo", label: "Klaviyo", how: t("Audience › Lists & Segments › ouvrez la liste › Manage list › Export list to CSV.", "Audience › Lists & Segments › open the list › Manage list › Export list to CSV.") },
  { id: "excel", label: "Excel", how: t("Fichier › Enregistrer sous › CSV UTF-8 (délimité par des virgules). Ou copiez directement les cellules.", "File › Save As › CSV UTF-8 (Comma delimited). Or just copy the cells.") },
  { id: "sheets", label: "Google Sheets", how: t("Fichier › Télécharger › Valeurs séparées par des virgules (.csv).", "File › Download › Comma-separated values (.csv).") },
  { id: "other", label: t("Autre outil", "Other tool"), how: t("Cherchez « Exporter » dans la liste de vos contacts ou clients : presque tous les outils proposent un export CSV ou Excel.", "Look for “Export” in your contact or customer list: almost every tool offers a CSV or Excel export.") },
] as const;

export function FileGuide({ done, onDone }: GuideProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<(typeof EXPORTS)[number]["id"]>("mailchimp");
  return (
    <>
      <GuideHead
        icon={FileSpreadsheet}
        title={t("Importer un fichier de contacts", "Import a contact file")}
        text={t("Vous changez d'outil ou vos clients sont dans un tableur ? Importez-les en une minute, sans perdre les tags.", "Switching tools, or keeping customers in a spreadsheet? Import them in a minute, tags included.")}
        done={done || undefined}
      />
      <Steps>
        <Step n={1} title={t("Exportez vos contacts", "Export your contacts")}>
          <Tabs label={t("Outil d'origine", "Source tool")} value={from} onChange={setFrom} options={EXPORTS.map((e) => ({ id: e.id, label: e.label }))} />
          <Hint>{EXPORTS.find((e) => e.id === from)!.how}</Hint>
        </Step>
        <Step n={2} title={t("Vérifiez les colonnes", "Check the columns")}>
          <p>
            {t(
              <>
                Seule la colonne <Kbd>email</Kbd> est obligatoire. Pingsell reconnaît aussi <code>first_name</code>, <code>last_name</code>, <code>phone</code>, <code>status</code> et{" "}
                <code>tags</code> (séparés par des points-virgules).
              </>,
              <>
                Only the <Kbd>email</Kbd> column is required. Pingsell also recognizes <code>first_name</code>, <code>last_name</code>, <code>phone</code>, <code>status</code> and{" "}
                <code>tags</code> (separated by semicolons).
              </>,
            )}
          </p>
          <Code code={`email,first_name,last_name,tags\ncamille@exemple.fr,Camille,Martin,vip;newsletter`} />
          <p className="text-xs text-slate-500">{t("Les contacts déjà présents sont mis à jour, jamais dupliqués.", "Existing contacts are updated, never duplicated.")}</p>
        </Step>
        <Step n={3} title={t("Importez le fichier", "Import the file")} done={!!done} last>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full flex-col items-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 px-6 py-8 text-center transition hover:border-brand-500 hover:bg-brand-50/40 dark:border-slate-700"
          >
            <Upload className="size-6 text-brand-500" />
            <span className="font-display text-base font-bold text-slate-900 dark:text-white">{done ? t("Importer un autre fichier", "Import another file") : t("Choisir mon fichier", "Choose my file")}</span>
            <span className="text-xs text-slate-500">{t("CSV, ou copier-coller depuis Excel", "CSV, or copy and paste from Excel")}</span>
          </button>
        </Step>
      </Steps>
      <ImportContactsModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={(r) => {
          setOpen(false);
          const n = (x: number) => x.toLocaleString(LOCALE);
          onDone(
            t(
              `Import terminé : ${n(r.created)} contact${r.created > 1 ? "s" : ""} ajouté${r.created > 1 ? "s" : ""}, ${n(r.updated)} mis à jour`,
              `Import complete: ${n(r.created)} contact${r.created === 1 ? "" : "s"} added, ${n(r.updated)} updated`,
            ),
          );
        }}
      />
    </>
  );
}

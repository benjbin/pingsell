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

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[] | Array<{ id: T; label: string }>; onChange: (v: T) => void; label: string }) {
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

function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-brand-50/70 px-4 py-3 text-sm text-slate-700 dark:bg-brand-500/15 dark:text-slate-200">{children}</div>;
}

function Kbd({ children }: { children: ReactNode }) {
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
      if (connected) onDone(`Boutique ${r.integration?.shop_domain ?? ""} connectée : clients et commandes synchronisés automatiquement`);
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
      toast.success("Synchronisation terminée", `${r.customers} clients et ${r.orders} commandes importés.`);
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
      toast.success("Boutique déconnectée");
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
        title="Connecter Shopify"
        text="Vos clients, leurs commandes, les expéditions et les paniers abandonnés arrivent tout seuls dans Missive, et restent à jour en continu."
        done={done || undefined}
      />

      {!status ? (
        <Waiting>Vérification de votre boutique…</Waiting>
      ) : status.connected ? (
        <div className="space-y-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">Boutique</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{status.shop}</dd>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">Dernière synchronisation</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{status.lastSync ? formatDateTime(status.lastSync) : "En cours…"}</dd>
            </div>
          </dl>
          {status.error && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              La dernière synchronisation a échoué. Vérifiez que l'application Missive est toujours installée dans Shopify, puis relancez.
            </p>
          )}
          <Hint>
            Ce qui arrive automatiquement : <Kbd>nouveaux clients</Kbd>, <Kbd>commandes passées</Kbd>, <Kbd>commandes expédiées</Kbd> et <Kbd>paniers abandonnés</Kbd>. Chacun peut lancer une automatisation.
          </Hint>
          <div className="flex flex-wrap gap-2">
            <Button icon={RefreshCw} onClick={() => void sync()} loading={syncing}>
              Synchroniser maintenant
            </Button>
            <Button variant="ghost" icon={Unplug} onClick={() => setConfirm(true)} className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              Déconnecter
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <Steps>
            <Step n={1} title="Indiquez l'adresse de votre boutique" last={status.oauth}>
              <p>C'est l'adresse qui finit par .myshopify.com, visible dans Shopify en haut à gauche ou dans Paramètres › Domaines.</p>
              <Field label="Adresse de la boutique" htmlFor="cg-shop">
                <div className="flex items-center rounded-xl bg-white ring-1 ring-slate-900/15 focus-within:ring-2 focus-within:ring-brand-500 dark:bg-slate-950 dark:ring-white/15">
                  <input
                    id="cg-shop"
                    required
                    value={shop}
                    onChange={(e) => setShop(e.target.value.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}
                    placeholder="ma-boutique"
                    className="h-11 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none dark:text-white"
                    autoComplete="off"
                  />
                  {!shop.includes(".") && <span className="pr-4 text-sm text-slate-400">.myshopify.com</span>}
                </div>
              </Field>
              {status.oauth && (
                <>
                  <p>Shopify vous demandera d'autoriser Missive à lire vos clients et vos commandes, puis vous ramènera ici.</p>
                  <Button type="submit" size="lg" icon={Link2} loading={busy}>
                    Connecter en 1 clic
                  </Button>
                </>
              )}
            </Step>
            {!status.oauth && (
              <>
                <Step n={2} title="Ouvrez votre application personnalisée dans Shopify">
                  <ol className="list-decimal space-y-1.5 pl-5">
                    <li>
                      Dans l'admin Shopify, ouvrez <Kbd>Paramètres › Applications et canaux de vente</Kbd>, puis <Kbd>Développer des applications</Kbd>.
                    </li>
                    <li>Ouvrez l'application personnalisée de votre boutique (ou celle créée pour Missive).</li>
                    <li>
                      Dans <Kbd>Configuration › Admin API</Kbd>, vérifiez que <code>read_customers</code>, <code>read_orders</code> et <code>read_checkouts</code> sont cochés, puis
                      enregistrez.
                    </li>
                  </ol>
                  <Hint>
                    Missive ne demande que la lecture : rien n'est modifié dans votre boutique. Depuis 2026, Shopify ne permet plus de créer de nouvelles applications depuis l'admin : si
                    vous n'en avez pas, la connexion en 1 clic s'en charge à votre place.
                  </Hint>
                </Step>
                <Step n={3} title="Collez le jeton d'accès" last>
                  <p>
                    Toujours dans l'application, onglet <Kbd>Identifiants API</Kbd> : affichez le <Kbd>jeton d'accès Admin API</Kbd> (il commence par shpat_) et collez-le ici. Shopify ne le montre qu'une fois : s'il a déjà été révélé, désinstallez puis réinstallez
                    l'application pour en obtenir un nouveau.
                  </p>
                  <Field label="Jeton d'accès Admin API" htmlFor="cg-token">
                    <Input id="cg-token" type="password" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" autoComplete="off" />
                  </Field>
                  <Button type="submit" size="lg" icon={Link2} loading={busy}>
                    Connecter la boutique
                  </Button>
                  <p className="text-xs text-slate-500">La première synchronisation démarre aussitôt : vos clients et vos commandes passées sont importés.</p>
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
        title="Déconnecter Shopify ?"
        description="La synchronisation s'arrêtera. Les contacts déjà importés sont conservés."
        confirmLabel="Déconnecter"
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* API: site, CRM, caisse, back-office, tout autre outil                     */
/* -------------------------------------------------------------------------- */

export type ApiKind = "site" | "crm" | "pos" | "backoffice" | "other";
type EventId = "contact" | "order" | "shipped" | "tag";
type Lang = "cURL" | "Node.js" | "PHP" | "Python";

const KINDS: Record<ApiKind, { icon: LucideIcon; title: string; intro: string; events: EventId[]; label: string }> = {
  site: {
    icon: Code2,
    title: "Brancher votre site web",
    intro: "Site sur mesure, WordPress, Webflow avec un back-end… Deux ou trois appels suffisent : à l'inscription, à la commande et à l'expédition.",
    events: ["contact", "order", "shipped"],
    label: "Mon site web",
  },
  crm: {
    icon: Code2,
    title: "Brancher votre CRM",
    intro: "Quand une fiche client est créée ou qualifiée dans votre CRM, elle arrive dans Missive avec ses tags, et vos scénarios démarrent.",
    events: ["contact", "tag"],
    label: "Mon CRM",
  },
  pos: {
    icon: Code2,
    title: "Brancher votre caisse",
    intro: "À chaque ticket où le client laisse son email, Missive reçoit la vente : remerciement, fidélité et relances partent tout seuls.",
    events: ["order", "contact"],
    label: "Ma caisse",
  },
  backoffice: {
    icon: Code2,
    title: "Brancher votre back-office",
    intro: "ERP, outil de gestion des commandes ou logistique : envoyez les commandes et leur expédition, Missive prévient le client par email ou par notification.",
    events: ["order", "shipped", "contact"],
    label: "Mon back-office",
  },
  other: {
    icon: Code2,
    title: "Brancher n'importe quel outil",
    intro: "Tout ce qui sait faire un appel web peut alimenter Missive, dans n'importe quel langage.",
    events: ["contact", "order", "shipped", "tag"],
    label: "Mon outil",
  },
};

const EVENTS: Record<EventId, { label: string; path: string; body: Record<string, unknown>; effect: string }> = {
  contact: {
    label: "Nouveau client",
    path: "/contacts",
    body: { email: "camille@exemple.fr", first_name: "Camille", last_name: "Martin", tags: ["newsletter"] },
    effect: "Crée le contact (ou le met à jour s'il existe déjà) et lance l'automatisation « Nouveau contact ».",
  },
  order: {
    label: "Commande passée",
    path: "/orders",
    body: { email: "camille@exemple.fr", first_name: "Camille", order_id: "CMD-1042", total: 59.9, currency: "EUR" },
    effect: "Ajoute la commande à la fiche (total dépensé, nombre de commandes) et lance « Commande passée ». Le même order_id envoyé deux fois n'est compté qu'une fois.",
  },
  shipped: {
    label: "Commande expédiée",
    path: "/orders",
    body: { email: "camille@exemple.fr", order_id: "CMD-1042", status: "fulfilled", carrier: "Colissimo", tracking_number: "6A12345678901", tracking_url: "https://suivi.exemple.fr/6A12345678901" },
    effect: "Lance « Commande expédiée » pour un client déjà connu (envoyez d'abord la commande). C'est un message transactionnel : il atteint aussi les clients désabonnés du marketing. Le même envoi répété n'est compté qu'une fois.",
  },
  tag: {
    label: "Ajouter un tag",
    path: "/contacts",
    body: { email: "camille@exemple.fr", tags: ["vip"] },
    effect: "Ajoute le tag sans effacer les autres et lance l'automatisation « Tag ajouté » correspondante.",
  },
};

/** Where to place the call, in the words of each kind of tool. */
const WHERE: Record<ApiKind, Partial<Record<EventId, string>>> = {
  site: {
    contact: "Dans le code qui traite votre formulaire d'inscription ou de newsletter, juste après l'enregistrement.",
    order: "Sur la page de confirmation de paiement, ou mieux dans le webhook de votre prestataire de paiement (Stripe, PayPal…).",
    shipped: "Là où vous passez la commande en « expédiée », par exemple quand l'étiquette transporteur est créée.",
  },
  crm: {
    contact: "Dans le webhook ou l'automatisation de votre CRM qui se déclenche à la création d'une fiche.",
    tag: "Quand une fiche change d'étape ou de statut (client, VIP, à relancer) : envoyez l'étape comme tag.",
  },
  pos: {
    order: "À la validation du ticket, uniquement si le client a donné son email (ou via l'export quotidien de votre logiciel de caisse).",
    contact: "Quand un client crée sa carte de fidélité en boutique.",
  },
  backoffice: {
    order: "Quand une commande est créée dans votre outil, quel que soit le canal de vente.",
    shipped: "Quand le statut passe à « expédiée » : ajoutez le numéro de suivi, il sera disponible dans le message.",
    contact: "Quand un nouveau client est créé dans votre base.",
  },
  other: {},
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
  -d '${JSON.stringify(body)}'`;
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
  const [event, setEvent] = useState<EventId>(meta.events[0]);
  const [lang, setLang] = useState<Lang>("cURL");
  useEffect(() => setEvent(KINDS[kind].events[0]), [kind]);

  const received = usePoll(!!key && !done, async () => {
    const keys = await api.apiKeys.list();
    return !!keys.find((k) => k.id === key?.id)?.last_used_at;
  });
  useEffect(() => {
    if (!received) return;
    onDone("Premier appel reçu de votre outil. Vérifiez le contact dans Contacts : c'est branché !");
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

  const ev = EVENTS[event];
  const where = WHERE[kind][event];

  return (
    <>
      <GuideHead icon={meta.icon} title={meta.title} text={meta.intro} done={done || undefined} />
      <Steps>
        <Step n={1} title="Créez la clé secrète de votre outil" done={!!key}>
          {!key ? (
            <>
              <p>Elle identifie votre compte. Gardez-la côté serveur : jamais dans une page web ni dans une app mobile.</p>
              <Button icon={KeyRound} loading={busy} onClick={() => void generate()}>
                Générer ma clé API
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center dark:bg-slate-800/60">
                <KeyRound className="size-4 shrink-0 text-brand-500" />
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white">{key.key}</code>
                <CopyButton text={key.key} />
              </div>
              <p className="text-xs text-slate-500">Copiez-la maintenant : elle ne sera plus affichée en entier. Vous gérez vos clés dans Paramètres.</p>
            </>
          )}
        </Step>

        <Step n={2} title="Choisissez ce que votre outil envoie">
          <Tabs label="Événement" value={event} onChange={setEvent} options={meta.events.map((id) => ({ id, label: EVENTS[id].label }))} />
          <p>{ev.effect}</p>
          {where && (
            <Hint>
              <span className="font-semibold text-slate-900 dark:text-white">Où placer l'appel : </span>
              {where}
            </Hint>
          )}
        </Step>

        <Step n={3} title="Copiez le code dans votre outil">
          <Tabs label="Langage" value={lang} onChange={setLang} options={["cURL", "Node.js", "PHP", "Python"] as const} />
          <Code code={snippet(lang, key?.key ?? "VOTRE_CLE_API", ev.path, ev.body)} />
          <p className="text-xs text-slate-500">
            Seul <code>email</code> est obligatoire{ev.path === "/orders" ? ", avec order_id pour les commandes" : ""}. Un autre langage (Java, C#, Ruby, Go…) ? C'est le même appel web : POST en JSON avec la clé dans l'en-tête Authorization.
          </p>
        </Step>

        <Step n={4} title="Faites un essai" done={!!done} last>
          {done ? (
            <p>Tout fonctionne. Activez maintenant un scénario dans Automatisations pour que les messages partent tout seuls.</p>
          ) : key ? (
            <Waiting>Lancez le code une fois (ou la commande cURL dans un terminal) : on vous confirme ici dès que Missive reçoit l'appel.</Waiting>
          ) : (
            <p>Générez la clé à l'étape 1 : on détectera votre premier appel en direct, ici.</p>
          )}
        </Step>
      </Steps>

      {onUseFile && (
        <p className="mt-7 border-t border-slate-900/10 pt-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          Pas de développeur sous la main ? Exportez vos clients depuis votre outil et{" "}
          <button type="button" onClick={onUseFile} className="font-semibold text-brand-500 hover:text-brand-600">
            importez le fichier
          </button>{" "}
          : c'est prêt en une minute.
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
    if (received) onDone("Nouveau téléphone enregistré : vous pouvez lui envoyer des notifications");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  const k = appKey ?? "msvapp_…";

  return (
    <>
      <GuideHead
        icon={Smartphone}
        title="Brancher votre app mobile"
        text="Notifications sur l'écran verrouillé, centre de notifications dans l'app et écran de permission : tout est déjà construit, il suffit de le brancher."
        done={done || undefined}
      />
      <div className="mb-6">
        <Tabs
          label="Technologie de l'app"
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
          <Step n={1} title="Installez le kit Missive">
            <Code code="npx expo install @missive/expo-push expo-notifications" />
          </Step>
          <Step n={2} title="Initialisez-le au démarrage de l'app">
            <p>Votre clé d'application est déjà remplie. Elle est publique : elle peut rester dans l'app.</p>
            <Code
              code={`// App.tsx
import { Missive, MissivePermissionPrompt } from "@missive/expo-push";

Missive.init({ appKey: "${k}", apiUrl: "${API_URL}" });`}
            />
          </Step>
          <Step n={3} title="Reliez le téléphone au client, puis demandez la permission">
            <p>À la connexion du client, pour que ses notifications et ses automatisations le suivent :</p>
            <Code
              code={`await Missive.identify({ email: user.email });
await Missive.requestPermission();

// Une seule fois, à la racine de l'app :
<MissivePermissionPrompt />`}
            />
            <Hint>
              Missive affiche d'abord un écran à vos couleurs (réglable dans Notifications push) avant la fenêtre du système : bien plus de clients disent oui.
            </Hint>
          </Step>
          <Step n={4} title="Option : le centre de notifications">
            <Code code={`import { MissiveInbox } from "@missive/expo-push";\n\n<MissiveInbox />`} />
          </Step>
          <Step n={5} title="Testez sur un vrai téléphone" done={!!done} last>
            {done ? (
              <p>Envoyez-lui une notification de test depuis Notifications push.</p>
            ) : appKey ? (
              <Waiting>Lancez l'app sur un téléphone et acceptez les notifications : on vous confirme ici dès qu'il est enregistré.</Waiting>
            ) : failed ? (
              <p className="text-red-600 dark:text-red-400">Impossible de charger votre clé d'application. Rechargez la page.</p>
            ) : (
              <Waiting>Chargement de votre clé d'application…</Waiting>
            )}
          </Step>
        </Steps>
      ) : (
        <Steps>
          <Step n={1} title="Récupérez le jeton de notification">
            <p>Comme d'habitude sur chaque plateforme : APNs sur iOS, Firebase Cloud Messaging sur Android ou Flutter.</p>
          </Step>
          <Step n={2} title="Enregistrez le téléphone chez Missive">
            <p>Un appel web, avec votre clé d'application et l'email du client connecté :</p>
            <Code
              code={`POST ${API_URL}/api/v1/push/app/devices
Authorization: Bearer ${k}
Content-Type: application/json

{
  "token": "<jeton APNs ou FCM>",
  "platform": "ios",
  "email": "camille@exemple.fr"
}`}
            />
            <p className="text-xs text-slate-500">platform vaut ios ou android. Une app iOS qui passe par Firebase ajoute "provider": "fcm".</p>
          </Step>
          <Step n={3} title="Testez sur un vrai téléphone" done={!!done} last>
            {done ? <p>Envoyez-lui une notification de test depuis Notifications push.</p> : <Waiting>On vous confirme ici dès que le premier téléphone est enregistré.</Waiting>}
          </Step>
        </Steps>
      )}

      <p className="mt-7 border-t border-slate-900/10 pt-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        {devices ? `${devices.toLocaleString("fr-FR")} appareil(s) déjà enregistré(s). ` : ""}
        Clés iOS et Android, écran de permission et tests :{" "}
        <Link to="/notifications" className="font-semibold text-brand-500 hover:text-brand-600">
          Notifications push
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
  { id: "mailchimp", label: "Mailchimp", how: "Audience › All contacts › Export Audience, puis téléchargez le fichier CSV." },
  { id: "brevo", label: "Brevo", how: "Contacts › cochez tous les contacts › Exporter, au format CSV." },
  { id: "klaviyo", label: "Klaviyo", how: "Audience › Lists & Segments › ouvrez la liste › Manage list › Export list to CSV." },
  { id: "excel", label: "Excel", how: "Fichier › Enregistrer sous › CSV UTF-8 (délimité par des virgules). Ou copiez directement les cellules." },
  { id: "sheets", label: "Google Sheets", how: "Fichier › Télécharger › Valeurs séparées par des virgules (.csv)." },
  { id: "other", label: "Autre outil", how: "Cherchez « Exporter » dans la liste de vos contacts ou clients : presque tous les outils proposent un export CSV ou Excel." },
] as const;

export function FileGuide({ done, onDone }: GuideProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<(typeof EXPORTS)[number]["id"]>("mailchimp");
  return (
    <>
      <GuideHead
        icon={FileSpreadsheet}
        title="Importer un fichier de contacts"
        text="Vous changez d'outil ou vos clients sont dans un tableur ? Importez-les en une minute, sans perdre les tags."
        done={done || undefined}
      />
      <Steps>
        <Step n={1} title="Exportez vos contacts">
          <Tabs label="Outil d'origine" value={from} onChange={setFrom} options={EXPORTS.map((e) => ({ id: e.id, label: e.label }))} />
          <Hint>{EXPORTS.find((e) => e.id === from)!.how}</Hint>
        </Step>
        <Step n={2} title="Vérifiez les colonnes">
          <p>
            Seule la colonne <Kbd>email</Kbd> est obligatoire. Missive reconnaît aussi <code>first_name</code>, <code>last_name</code>, <code>phone</code>, <code>status</code> et{" "}
            <code>tags</code> (séparés par des points-virgules).
          </p>
          <Code code={`email,first_name,last_name,tags\ncamille@exemple.fr,Camille,Martin,vip;newsletter`} />
          <p className="text-xs text-slate-500">Les contacts déjà présents sont mis à jour, jamais dupliqués.</p>
        </Step>
        <Step n={3} title="Importez le fichier" done={!!done} last>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full flex-col items-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 px-6 py-8 text-center transition hover:border-brand-500 hover:bg-brand-50/40 dark:border-slate-700"
          >
            <Upload className="size-6 text-brand-500" />
            <span className="font-display text-base font-bold text-slate-900 dark:text-white">{done ? "Importer un autre fichier" : "Choisir mon fichier"}</span>
            <span className="text-xs text-slate-500">CSV, ou copier-coller depuis Excel</span>
          </button>
        </Step>
      </Steps>
      <ImportContactsModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={(r) => {
          setOpen(false);
          const n = (x: number) => x.toLocaleString("fr-FR");
          onDone(`Import terminé : ${n(r.created)} contact${r.created > 1 ? "s" : ""} ajouté${r.created > 1 ? "s" : ""}, ${n(r.updated)} mis à jour`);
        }}
      />
    </>
  );
}

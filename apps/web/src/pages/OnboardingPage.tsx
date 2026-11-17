import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { API_URL, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx } from "../lib/format";
import type { AutomationInput } from "../lib/types";
import { Button, Field, Input } from "../components/ui/primitives";
import { CopyButton } from "../components/CopyButton";
import { useToast } from "../components/ui/Toast";
import { ImportContactsModal } from "./contacts/ImportContactsModal";
import { DEFAULT_EMAIL_HTML } from "./campaigns/defaultTemplate";

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

type SourceId = "shopify" | "api" | "app" | "file";

const SOURCES: Array<{ id: SourceId; icon: LucideIcon; title: string; text: string; effort: string }> = [
  { id: "shopify", icon: ShoppingBag, title: "Ma boutique Shopify", text: "Clients, commandes et paniers abandonnés synchronisés.", effort: "1 clic" },
  { id: "api", icon: Code2, title: "Mon site ou mon logiciel", text: "CRM, back-office, caisse, site sur mesure : tout ce qui sait appeler une API.", effort: "≈ 5 min" },
  { id: "app", icon: Smartphone, title: "Mon app iOS / Android", text: "Notifications sur l'écran verrouillé et centre de notifications dans l'app.", effort: "SDK prêt" },
  { id: "file", icon: FileSpreadsheet, title: "Un fichier de contacts", text: "Export Excel ou CSV de votre ancien outil.", effort: "1 min" },
];

const STORE_KEY = "missive_onboarding";

interface Saved {
  selected: SourceId[];
  step: "choose" | "connect" | "scenario" | "done";
  index: number;
}

function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Polls `check` every 3 s while `active`, until it returns true. */
function usePoll(active: boolean, check: () => Promise<boolean>) {
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

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/** First screen after sign-up: pick what to connect, connect it, start a first scenario. */
export function OnboardingPage() {
  const { account } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const saved = loadSaved();
  const [selected, setSelected] = useState<SourceId[]>(saved?.selected ?? []);
  const [step, setStep] = useState<Saved["step"]>(saved?.step ?? "choose");
  const [index, setIndex] = useState(saved?.index ?? 0);
  const [done, setDone] = useState<Partial<Record<SourceId, string>>>({});

  useEffect(() => save({ selected, step, index }), [selected, step, index]);
  // Back from Shopify's OAuth page.
  useEffect(() => {
    if (params.get("shopify") === "connected") setDone((d) => ({ ...d, shopify: "Boutique connectée" }));
  }, [params]);

  const toggle = (id: SourceId) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...SOURCES.map((x) => x.id).filter((x) => s.includes(x) || x === id)]));
  const current = selected[index];
  const markDone = (id: SourceId, label: string) => setDone((d) => ({ ...d, [id]: label }));

  function finish() {
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    navigate("/", { replace: true });
  }

  const stepNo = step === "choose" ? 1 : step === "connect" ? 2 : 3;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <span className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-slate-900 uppercase dark:text-white">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand-500 text-white">
            <Mail className="size-4" />
          </span>
          Missive
        </span>
        <div className="flex items-center gap-4">
          <ol className="hidden items-center gap-2 text-xs font-semibold sm:flex" aria-label="Étapes">
            {["Vos outils", "Branchement", "Premier scénario"].map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cx(
                    "flex size-6 items-center justify-center rounded-full",
                    i + 1 < stepNo ? "bg-brand-500 text-white" : i + 1 === stepNo ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-200 text-slate-500 dark:bg-slate-800",
                  )}
                >
                  {i + 1 < stepNo ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={i + 1 === stepNo ? "text-slate-900 dark:text-white" : "text-slate-400"}>{label}</span>
                {i < 2 && <span className="h-px w-6 bg-slate-300 dark:bg-slate-700" />}
              </li>
            ))}
          </ol>
          <button type="button" onClick={finish} className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
            Passer
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        {step === "choose" && (
          <section className="animate-rise">
            <p className="eyebrow">Bienvenue{account?.name ? `, ${account.name}` : ""}</p>
            <h1 className="display mt-4 text-[40px] leading-[0.92] text-slate-900 sm:text-[60px] dark:text-white">
              Qu'est-ce que vous voulez <em className="text-brand-500">brancher&nbsp;?</em>
            </h1>
            <p className="mt-4 max-w-xl text-[17px] text-slate-600 dark:text-slate-300">
              Choisissez un ou plusieurs outils. Missive s'adapte à ce que vous utilisez déjà, et vous pourrez en ajouter d'autres plus tard.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {SOURCES.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={cx(
                      "group relative flex gap-4 rounded-[22px] bg-white p-6 text-left ring-1 transition dark:bg-slate-900",
                      on ? "ring-2 ring-brand-500 shadow-[0_18px_40px_-24px_rgba(20,92,255,0.7)]" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10",
                    )}
                  >
                    <span className={cx("flex size-12 shrink-0 items-center justify-center rounded-2xl", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-500 dark:bg-brand-900/30")}>
                      <s.icon className="size-6" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-lg font-bold text-slate-900 dark:text-white">{s.title}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{s.effort}</span>
                      </span>
                      <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{s.text}</span>
                    </span>
                    <span
                      className={cx(
                        "absolute top-4 right-4 flex size-6 items-center justify-center rounded-full ring-1",
                        on ? "bg-brand-500 text-white ring-brand-500" : "ring-slate-300 dark:ring-slate-600",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-10 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setStep("scenario")} className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
                Je n'ai rien à brancher pour l'instant
              </button>
              <Button
                size="lg"
                disabled={!selected.length}
                onClick={() => {
                  setIndex(0);
                  setStep("connect");
                }}
              >
                Continuer {selected.length > 1 ? `(${selected.length} outils)` : ""}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}

        {step === "connect" && current && (
          <section className="grid animate-rise gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label="Outils à brancher" className="space-y-2">
              {selected.map((id, i) => {
                const s = SOURCES.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition",
                      i === index ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/10 dark:bg-slate-900 dark:text-white dark:ring-white/10" : "text-slate-500 hover:text-slate-900 dark:hover:text-white",
                    )}
                  >
                    {done[id] ? <CheckCircle2 className="size-5 text-emerald-500" /> : <s.icon className="size-5" strokeWidth={1.75} />}
                    {s.title}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 rounded-[26px] bg-white p-6 ring-1 ring-slate-900/10 sm:p-8 dark:bg-slate-900 dark:ring-white/10">
              {current === "shopify" && <ShopifyStep done={done.shopify} onDone={(l) => markDone("shopify", l)} />}
              {current === "api" && <ApiStep done={done.api} onDone={(l) => markDone("api", l)} />}
              {current === "app" && <AppStep done={done.app} onDone={(l) => markDone("app", l)} />}
              {current === "file" && <FileStep done={done.file} onDone={(l) => markDone("file", l)} />}

              <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-900/10 pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => (index === 0 ? setStep("choose") : setIndex(index - 1))}>
                  Retour
                </Button>
                <Button onClick={() => (index < selected.length - 1 ? setIndex(index + 1) : setStep("scenario"))}>
                  {done[current] ? "Continuer" : "Je le ferai plus tard"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === "scenario" && <ScenarioStep selected={selected} brand={account?.name ?? ""} onBack={() => setStep(selected.length ? "connect" : "choose")} onFinish={finish} />}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

function StepHead({ icon: Icon, title, text, done }: { icon: LucideIcon; title: string; text: ReactNode; done?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-300">{text}</p>
      {done && <Success>{done}</Success>}
    </div>
  );
}

function Success({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
      <CheckCircle2 className="size-5 shrink-0" /> {children}
    </p>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <Loader2 className="size-4 shrink-0 animate-spin text-brand-500" /> {children}
    </p>
  );
}

function Code({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 pt-12 text-[12.5px] leading-relaxed text-slate-200">{code}</pre>
      <div className="absolute top-2.5 right-2.5">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function ShopifyStep({ done, onDone }: { done?: string; onDone: (label: string) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<{ connected: boolean; shop: string | null; oauth: boolean } | null>(null);
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.integrations.shopify
      .status()
      .then((r) => {
        const connected = !!r.integration && r.integration.connected !== false;
        setStatus({ connected, shop: r.integration?.shop_domain ?? null, oauth: r.oauth_available });
        if (connected) onDone(`Boutique ${r.integration?.shop_domain ?? ""} connectée : clients et commandes en cours de synchronisation`);
      })
      .catch(() => setStatus({ connected: false, shop: null, oauth: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domain = () => (shop.trim().includes(".") ? shop.trim() : `${shop.trim()}.myshopify.com`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (status?.oauth) {
        // Back to this screen after Shopify's authorisation page.
        sessionStorage.setItem("missive_onboarding_return", "1");
        window.location.href = await api.integrations.shopify.installUrl(domain());
        return;
      }
      await api.integrations.shopify.connect({ shop_domain: domain(), access_token: token.trim() });
      onDone(`Boutique ${domain()} connectée : clients et commandes en cours de synchronisation`);
      setStatus((s) => (s ? { ...s, connected: true, shop: domain() } : s));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHead
        icon={ShoppingBag}
        title="Connecter Shopify"
        text="Vos clients, leurs commandes et les paniers abandonnés arrivent automatiquement dans Missive, et restent à jour."
        done={done}
      />
      {!status ? (
        <Waiting>Vérification…</Waiting>
      ) : status.connected ? null : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="Adresse de votre boutique" htmlFor="ob-shop">
            <div className="flex items-center rounded-xl ring-1 ring-slate-900/15 focus-within:ring-2 focus-within:ring-brand-500 dark:ring-white/15">
              <input
                id="ob-shop"
                required
                value={shop}
                onChange={(e) => setShop(e.target.value.replace(/^https?:\/\//, ""))}
                placeholder="ma-boutique"
                className="h-11 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none dark:text-white"
                autoComplete="off"
              />
              {!shop.includes(".") && <span className="pr-4 text-sm text-slate-400">.myshopify.com</span>}
            </div>
          </Field>
          {!status.oauth && (
            <>
              <Field label="Jeton d'accès Admin API" htmlFor="ob-token">
                <Input id="ob-token" type="password" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" autoComplete="off" />
              </Field>
              <ol className="space-y-1.5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <li>1. Dans Shopify : Paramètres › Applications › Développer des applications.</li>
                <li>2. Créez une application « Missive ».</li>
                <li>
                  3. Donnez-lui les accès <code>read_customers</code>, <code>read_orders</code> et <code>read_checkouts</code>.
                </li>
                <li>4. Installez-la et collez ici le jeton Admin API.</li>
              </ol>
            </>
          )}
          <Button type="submit" size="lg" icon={Link2} loading={busy}>
            {status.oauth ? "Connecter en 1 clic" : "Connecter la boutique"}
          </Button>
        </form>
      )}
    </>
  );
}

function ApiStep({ done, onDone }: { done?: string; onDone: (label: string) => void }) {
  const toast = useToast();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"cURL" | "Node.js" | "PHP" | "Python">("cURL");
  const baseline = useRef<number | null>(null);
  const [firstEmail, setFirstEmail] = useState<string | null>(null);

  useEffect(() => {
    api.contacts
      .list({ limit: 1 })
      .then((r) => (baseline.current = r.total))
      .catch(() => (baseline.current = 0));
  }, []);

  const received = usePoll(!!key && !done, async () => {
    const r = await api.contacts.list({ limit: 1 });
    if (baseline.current !== null && r.total > baseline.current) {
      setFirstEmail(r.data[0]?.email ?? null);
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (received) onDone(`Connexion réussie${firstEmail ? ` : ${firstEmail} est arrivé dans vos contacts` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  async function generate() {
    setBusy(true);
    try {
      const created = await api.apiKeys.create("Mon site / logiciel");
      setKey(created.key ?? null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const k = key ?? "VOTRE_CLE";
  const url = `${API_URL}/api/v1/contacts`;
  const snippets = {
    cURL: `curl -X POST ${url} \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "camille@exemple.fr", "first_name": "Camille" }'`,
    "Node.js": `await fetch("${url}", {
  method: "POST",
  headers: { Authorization: "Bearer ${k}", "Content-Type": "application/json" },
  body: JSON.stringify({ email: client.email, first_name: client.prenom }),
});`,
    PHP: `$ch = curl_init("${url}");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer ${k}", "Content-Type: application/json"],
  CURLOPT_POSTFIELDS => json_encode(["email" => $client["email"], "first_name" => $client["prenom"]]),
]);
curl_exec($ch);`,
    Python: `import requests
requests.post("${url}",
  headers={"Authorization": "Bearer ${k}"},
  json={"email": client.email, "first_name": client.prenom})`,
  };

  return (
    <>
      <StepHead
        icon={Code2}
        title="Brancher votre site ou votre logiciel"
        text="Un seul appel quand un client s'inscrit ou achète chez vous : il arrive dans Missive et vos automatisations démarrent. N'importe quel langage fonctionne."
        done={done}
      />
      {!key ? (
        <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/60">
          <p className="text-sm text-slate-600 dark:text-slate-300">Étape 1 : créez la clé secrète de votre logiciel. Elle reste sur votre serveur, jamais dans une page web.</p>
          <Button className="mt-4" icon={KeyRound} loading={busy} onClick={() => void generate()}>
            Générer ma clé API
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center dark:bg-slate-800/60">
            <KeyRound className="size-4 shrink-0 text-brand-500" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white">{key}</code>
            <CopyButton text={key} />
          </div>
          <p className="text-xs text-slate-500">Copiez-la maintenant : elle ne sera plus affichée en entier. Vous la retrouverez dans Paramètres › Clés API.</p>
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {(Object.keys(snippets) as Array<keyof typeof snippets>).map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={lang === l}
                onClick={() => setLang(l)}
                className={cx("rounded-full px-3 py-1.5 text-xs font-semibold", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:text-slate-900")}
              >
                {l}
              </button>
            ))}
          </div>
          <Code code={snippets[lang]} />
          {!done && <Waiting>Envoyez un contact avec ce code : on vous confirme ici dès qu'il arrive.</Waiting>}
        </div>
      )}
    </>
  );
}

function AppStep({ done, onDone }: { done?: string; onDone: (label: string) => void }) {
  const [appKey, setAppKey] = useState<string | null>(null);
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    api.push
      .config()
      .then((c) => {
        setAppKey(c.app_key);
        baseline.current = c.devices.total;
      })
      .catch(() => undefined);
  }, []);

  const received = usePoll(!!appKey && !done, async () => {
    const c = await api.push.config();
    return baseline.current !== null && c.devices.total > baseline.current;
  });
  useEffect(() => {
    if (received) onDone("Premier téléphone enregistré : vous pouvez lui envoyer des notifications");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [received]);

  const code = `npx expo install @missive/expo-push expo-notifications

// App.tsx
import { Missive, MissiveInbox, MissivePermissionPrompt } from "@missive/expo-push";

Missive.init({ appKey: "${appKey ?? "msvapp_…"}", apiUrl: "${API_URL}" });

// À la connexion du client
await Missive.identify({ email: user.email });
await Missive.requestPermission();`;

  return (
    <>
      <StepHead
        icon={Smartphone}
        title="Brancher votre app mobile"
        text="Collez ces lignes dans votre app React Native / Expo : notifications sur l'écran verrouillé, centre de notifications et écran de permission sont déjà construits."
        done={done}
      />
      <div className="space-y-4">
        {appKey ? <Code code={code} /> : <Waiting>Chargement de votre clé d'application…</Waiting>}
        <p className="text-sm text-slate-500 dark:text-slate-400">
          App native en Swift, Kotlin ou Flutter ? Elle s'enregistre avec un simple appel web : tout est détaillé dans{" "}
          <Link to="/notifications" className="font-semibold text-brand-500">
            Notifications push › Configuration
          </Link>
          .
        </p>
        {appKey && !done && <Waiting>Lancez l'app sur un téléphone : on vous confirme ici dès qu'il est enregistré.</Waiting>}
      </div>
    </>
  );
}

function FileStep({ done, onDone }: { done?: string; onDone: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <StepHead
        icon={FileSpreadsheet}
        title="Importer vos contacts"
        text="Exportez vos contacts depuis votre ancien outil (Excel, CSV, Mailchimp, Brevo…) : Missive reconnaît les colonnes email, prénom, nom et tags."
        done={done}
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full flex-col items-center gap-3 rounded-[22px] border-2 border-dashed border-slate-300 px-6 py-10 text-center transition hover:border-brand-500 hover:bg-brand-50/40 dark:border-slate-700"
      >
        <Upload className="size-7 text-brand-500" />
        <span className="font-display text-lg font-bold text-slate-900 dark:text-white">{done ? "Importer un autre fichier" : "Choisir mon fichier"}</span>
        <span className="text-sm text-slate-500">CSV ou copier-coller depuis Excel</span>
      </button>
      <ImportContactsModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={() => {
          setOpen(false);
          void api.contacts.list({ limit: 1 }).then((r) => onDone(`Import terminé : ${r.total.toLocaleString("fr-FR")} contact(s) dans Missive`));
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* First scenario                                                             */
/* -------------------------------------------------------------------------- */

function emailHtml(body: string): string {
  return DEFAULT_EMAIL_HTML.replace(
    "Écrivez ici votre message. Présentez votre offre, votre nouveauté ou votre actualité en quelques phrases.",
    body,
  ).replace("Ou partez d'un de nos modèles prêts à l'emploi.", "À très vite !");
}

interface Template {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
  needs?: SourceId[];
  input: (brand: string) => AutomationInput;
}

const TEMPLATES: Template[] = [
  {
    id: "welcome",
    icon: Sparkles,
    title: "Bienvenue",
    text: "Un email chaleureux dès qu'un nouveau contact arrive.",
    input: (brand) => ({
      name: "Bienvenue",
      trigger: "contact_created",
      steps: [
        {
          type: "email",
          subject: `Bienvenue chez ${brand || "nous"}, {{first_name|}} !`,
          html: emailHtml(`Merci de nous avoir rejoints ! Vous recevrez nos nouveautés et nos offres en avant-première. Une question ? Répondez simplement à cet email.`),
        },
      ],
    }),
  },
  {
    id: "cart",
    icon: ShoppingBag,
    title: "Panier abandonné",
    text: "Une relance 1 h après, puis une seconde le lendemain si rien n'est commandé.",
    needs: ["shopify"],
    input: () => ({
      name: "Relance panier abandonné",
      trigger: "cart_abandoned",
      steps: [
        { type: "email", subject: "Vous avez oublié quelque chose, {{first_name|}} ?", html: emailHtml("Votre panier vous attend. Finalisez votre commande en un clic, nous l'avons gardé de côté pour vous.") },
        { type: "wait", hours: 24 },
        { type: "exit_if", condition: "ordered" },
        { type: "email", subject: "Votre panier est toujours là", html: emailHtml("Dernier rappel : vos articles sont toujours dans votre panier, mais les stocks partent vite.") },
      ],
    }),
  },
  {
    id: "thanks",
    icon: Mail,
    title: "Merci pour votre commande",
    text: "Un remerciement juste après chaque achat.",
    needs: ["shopify"],
    input: () => ({
      name: "Merci pour votre commande",
      trigger: "order_created",
      steps: [{ type: "email", subject: "Merci pour votre commande, {{first_name|}} !", html: emailHtml("Nous préparons votre commande avec soin. Vous recevrez un message dès son expédition.") }],
    }),
  },
  {
    id: "shipped",
    icon: BellRing,
    title: "Commande expédiée",
    text: "Une notification sur le téléphone du client dès l'expédition.",
    needs: ["shopify", "app"],
    input: () => ({
      name: "Commande expédiée",
      trigger: "order_fulfilled",
      steps: [{ type: "push", title: "Votre commande est en route 🚚", body: "{{first_name|Bonne nouvelle}}, votre colis vient de partir. Suivez-le depuis l'app.", in_app: true }],
    }),
  },
  {
    id: "app",
    icon: Smartphone,
    title: "Bienvenue dans l'app",
    text: "Une notification à la première connexion d'un client dans votre app.",
    needs: ["app"],
    input: () => ({
      name: "Bienvenue dans l'app",
      trigger: "app_signed_in",
      steps: [{ type: "push", title: "Bienvenue {{first_name|}} 👋", body: "Retrouvez ici vos commandes, nos nouveautés et vos offres réservées à l'app.", in_app: true }],
    }),
  },
];

function ScenarioStep({ selected, brand, onBack, onFinish }: { selected: SourceId[]; brand: string; onBack: () => void; onFinish: () => void }) {
  const toast = useToast();
  const available = TEMPLATES.filter((t) => !t.needs || t.needs.every((n) => selected.includes(n)));
  const [chosen, setChosen] = useState<string[]>(() => available.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[] | null>(null);

  async function create() {
    setBusy(true);
    const names: string[] = [];
    try {
      for (const t of available.filter((x) => chosen.includes(x.id))) {
        const a = await api.automations.create(t.input(brand));
        names.push(a.name);
      }
      setCreated(names);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <section className="mx-auto max-w-2xl animate-rise text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-brand-500 text-white">
          <Check className="size-8" />
        </span>
        <h1 className="display mt-6 text-[40px] leading-[0.92] text-slate-900 sm:text-[56px] dark:text-white">
          C'est <em className="text-brand-500">branché.</em>
        </h1>
        <p className="mt-4 text-[17px] text-slate-600 dark:text-slate-300">
          {created.length ? `${created.length} scénario(s) actif(s) : ${created.join(", ")}. Les textes se modifient à tout moment dans Automatisations.` : "Vous pourrez créer vos scénarios dans Automatisations."}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={onFinish}>
            Aller au tableau de bord <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise">
      <p className="eyebrow">Dernière étape</p>
      <h1 className="display mt-4 text-[40px] leading-[0.92] text-slate-900 sm:text-[60px] dark:text-white">
        Vos premiers scénarios, <em className="text-brand-500">prêts à tourner.</em>
      </h1>
      <p className="mt-4 max-w-xl text-[17px] text-slate-600 dark:text-slate-300">Choisissez selon ce que vous avez branché. Ils partent tout seuls, et vous pourrez modifier les textes quand vous voulez.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {available.map((t) => {
          const on = chosen.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}
              className={cx(
                "relative flex gap-4 rounded-[22px] bg-white p-5 text-left ring-1 transition dark:bg-slate-900",
                on ? "ring-2 ring-brand-500" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10",
              )}
            >
              <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-2xl", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-500 dark:bg-brand-900/30")}>
                <t.icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 pr-6">
                <span className="block font-display text-base font-bold text-slate-900 dark:text-white">{t.title}</span>
                <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{t.text}</span>
              </span>
              <span className={cx("absolute top-4 right-4 flex size-6 items-center justify-center rounded-full ring-1", on ? "bg-brand-500 text-white ring-brand-500" : "ring-slate-300 dark:ring-slate-600")}>
                {on && <Check className="size-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Retour
        </Button>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={onFinish} className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
            Plus tard
          </button>
          <Button size="lg" loading={busy} disabled={!chosen.length} onClick={() => void create()}>
            Activer {chosen.length > 1 ? `ces ${chosen.length} scénarios` : "ce scénario"}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

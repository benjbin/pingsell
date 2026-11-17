import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  Mail,
  ShoppingBag,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx } from "../lib/format";
import type { AutomationInput } from "../lib/types";
import { Button } from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import { ApiGuide, AppGuide, FileGuide, ShopifyGuide } from "../components/connect/ConnectGuides";
import { PingsellLogo } from "../components/brand/PingsellLogo";
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
        <PingsellLogo className="h-8 w-auto" />
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
              Choisissez un ou plusieurs outils. Pingsell s'adapte à ce que vous utilisez déjà, et vous pourrez en ajouter d'autres plus tard.
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
              {current === "shopify" && <ShopifyGuide returnTo="onboarding" done={done.shopify} onDone={(l) => markDone("shopify", l)} />}
              {current === "api" && <ApiGuide kind="other" done={done.api} onDone={(l) => markDone("api", l)} />}
              {current === "app" && <AppGuide done={done.app} onDone={(l) => markDone("app", l)} />}
              {current === "file" && <FileGuide done={done.file} onDone={(l) => markDone("file", l)} />}

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
  /** Every group must be connected; within a group, any source will do. */
  needs?: SourceId[][];
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
    needs: [["shopify"]],
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
    needs: [["shopify", "api"]],
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
    needs: [["shopify", "api"], ["app"]],
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
    needs: [["app"]],
    input: () => ({
      name: "Bienvenue dans l'app",
      trigger: "app_signed_in",
      steps: [{ type: "push", title: "Bienvenue {{first_name|}} 👋", body: "Retrouvez ici vos commandes, nos nouveautés et vos offres réservées à l'app.", in_app: true }],
    }),
  },
];

function ScenarioStep({ selected, brand, onBack, onFinish }: { selected: SourceId[]; brand: string; onBack: () => void; onFinish: () => void }) {
  const toast = useToast();
  const available = TEMPLATES.filter((t) => !t.needs || t.needs.every((group) => group.some((n) => selected.includes(n))));
  const [chosen, setChosen] = useState<string[]>(() => available.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[] | null>(null);
  // Templates already saved, so a retry after a failure never creates them twice.
  const saved = useRef<Map<string, string>>(new Map());

  async function create() {
    setBusy(true);
    try {
      for (const t of available.filter((x) => chosen.includes(x.id))) {
        if (saved.current.has(t.id)) continue;
        const a = await api.automations.create(t.input(brand));
        saved.current.set(t.id, a.name);
      }
      setCreated([...saved.current.values()]);
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
          {created.length ? `${created.length > 1 ? `${created.length} scénarios actifs` : "1 scénario actif"} : ${created.join(", ")}. Les textes se modifient à tout moment dans Automatisations.` : "Vous pourrez créer vos scénarios dans Automatisations."}
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

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
import { t } from "../lib/i18n";

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

type SourceId = "shopify" | "api" | "app" | "file";

const SOURCES: Array<{ id: SourceId; icon: LucideIcon; title: string; text: string; effort: string }> = [
  { id: "shopify", icon: ShoppingBag, title: t("Ma boutique Shopify", "My Shopify store"), text: t("Clients, commandes et paniers abandonnés synchronisés.", "Customers, orders and abandoned carts, in sync."), effort: t("1 clic", "1 click") },
  { id: "api", icon: Code2, title: t("Mon site ou mon logiciel", "My website or software"), text: t("CRM, back-office, caisse, site sur mesure : tout ce qui sait appeler une API.", "CRM, back office, POS, custom site: anything that can call an API."), effort: t("≈ 5 min", "≈ 5 min") },
  { id: "app", icon: Smartphone, title: t("Mon app iOS / Android", "My iOS / Android app"), text: t("Notifications sur l'écran verrouillé et centre de notifications dans l'app.", "Lock-screen notifications and an in-app notification center."), effort: t("SDK prêt", "SDK ready") },
  { id: "file", icon: FileSpreadsheet, title: t("Un fichier de contacts", "A contact file"), text: t("Export Excel ou CSV de votre ancien outil.", "An Excel or CSV export from your old tool."), effort: t("1 min", "1 min") },
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
    if (params.get("shopify") === "connected") setDone((d) => ({ ...d, shopify: t("Boutique connectée", "Store connected") }));
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
          <ol className="hidden items-center gap-2 text-xs font-semibold sm:flex" aria-label={t("Étapes", "Steps")}>
            {[t("Vos outils", "Your tools"), t("Branchement", "Connect"), t("Premier scénario", "First workflow")].map((label, i) => (
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
            {t("Passer", "Skip")}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        {step === "choose" && (
          <section className="animate-rise">
            <p className="eyebrow">{t("Bienvenue", "Welcome")}{account?.name ? `, ${account.name}` : ""}</p>
            <h1 className="display mt-4 text-[40px] leading-[0.92] text-slate-900 sm:text-[60px] dark:text-white">
              {t(
                <>
                  Qu'est-ce que vous voulez <em className="text-brand-500">brancher&nbsp;?</em>
                </>,
                <>
                  What do you want to <em className="text-brand-500">connect?</em>
                </>,
              )}
            </h1>
            <p className="mt-4 max-w-xl text-[17px] text-slate-600 dark:text-slate-300">
              {t(
                "Choisissez un ou plusieurs outils. Pingsell s'adapte à ce que vous utilisez déjà, et vous pourrez en ajouter d'autres plus tard.",
                "Pick one or more tools. Pingsell works with what you already use, and you can add more later.",
              )}
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
                {t("Je n'ai rien à brancher pour l'instant", "I have nothing to connect right now")}
              </button>
              <Button
                size="lg"
                disabled={!selected.length}
                onClick={() => {
                  setIndex(0);
                  setStep("connect");
                }}
              >
                {t("Continuer", "Continue")} {selected.length > 1 ? t(`(${selected.length} outils)`, `(${selected.length} tools)`) : ""}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        )}

        {step === "connect" && current && (
          <section className="grid animate-rise gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label={t("Outils à brancher", "Tools to connect")} className="space-y-2">
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
                  {t("Retour", "Back")}
                </Button>
                <Button onClick={() => (index < selected.length - 1 ? setIndex(index + 1) : setStep("scenario"))}>
                  {done[current] ? t("Continuer", "Continue") : t("Je le ferai plus tard", "I'll do it later")}
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
    t(
      "Écrivez ici votre message. Présentez votre offre, votre nouveauté ou votre actualité en quelques phrases.",
      "Write your message here. Introduce your offer, new product or latest news in a few sentences.",
    ),
    body,
  ).replace(t("Ou partez d'un de nos modèles prêts à l'emploi.", "Or start from one of our ready-made templates."), t("À très vite !", "See you soon!"));
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
    title: t("Bienvenue", "Welcome"),
    text: t("Un email chaleureux dès qu'un nouveau contact arrive.", "A warm email as soon as a new contact joins."),
    input: (brand) => ({
      name: t("Bienvenue", "Welcome"),
      trigger: "contact_created",
      steps: [
        {
          type: "email",
          subject: t(`Bienvenue chez ${brand || "nous"}, {{first_name|}} !`, `Welcome to ${brand || "the family"}, {{first_name|}}!`),
          html: emailHtml(
            t(
              `Merci de nous avoir rejoints ! Vous recevrez nos nouveautés et nos offres en avant-première. Une question ? Répondez simplement à cet email.`,
              `Thanks for joining us! You'll be the first to hear about new arrivals and offers. Questions? Just reply to this email.`,
            ),
          ),
        },
      ],
    }),
  },
  {
    id: "cart",
    icon: ShoppingBag,
    title: t("Panier abandonné", "Abandoned cart"),
    text: t("Une relance 1 h après, puis une seconde le lendemain si rien n'est commandé.", "A reminder 1 hour later, then a second one the next day if nothing is ordered."),
    needs: [["shopify"]],
    input: () => ({
      name: t("Relance panier abandonné", "Abandoned cart reminder"),
      trigger: "cart_abandoned",
      steps: [
        {
          type: "email",
          subject: t("Vous avez oublié quelque chose, {{first_name|}} ?", "Forgot something, {{first_name|}}?"),
          html: emailHtml(t("Votre panier vous attend. Finalisez votre commande en un clic, nous l'avons gardé de côté pour vous.", "Your cart is waiting. Complete your order in one click, we've saved it for you.")),
        },
        { type: "wait", hours: 24 },
        { type: "exit_if", condition: "ordered" },
        {
          type: "email",
          subject: t("Votre panier est toujours là", "Your cart is still here"),
          html: emailHtml(t("Dernier rappel : vos articles sont toujours dans votre panier, mais les stocks partent vite.", "Last reminder: your items are still in your cart, but stock is going fast.")),
        },
      ],
    }),
  },
  {
    id: "thanks",
    icon: Mail,
    title: t("Merci pour votre commande", "Thanks for your order"),
    text: t("Un remerciement juste après chaque achat.", "A thank-you right after every purchase."),
    needs: [["shopify", "api"]],
    input: () => ({
      name: t("Merci pour votre commande", "Thanks for your order"),
      trigger: "order_created",
      steps: [
        {
          type: "email",
          subject: t("Merci pour votre commande, {{first_name|}} !", "Thanks for your order, {{first_name|}}!"),
          html: emailHtml(t("Nous préparons votre commande avec soin. Vous recevrez un message dès son expédition.", "We're carefully preparing your order. We'll let you know as soon as it ships.")),
        },
      ],
    }),
  },
  {
    id: "shipped",
    icon: BellRing,
    title: t("Commande expédiée", "Order shipped"),
    text: t("Une notification sur le téléphone du client dès l'expédition.", "A notification on the customer's phone as soon as it ships."),
    needs: [["shopify", "api"], ["app"]],
    input: () => ({
      name: t("Commande expédiée", "Order shipped"),
      trigger: "order_fulfilled",
      steps: [
        {
          type: "push",
          title: t("Votre commande est en route 🚚", "Your order is on its way 🚚"),
          body: t("{{first_name|Bonne nouvelle}}, votre colis vient de partir. Suivez-le depuis l'app.", "{{first_name|Good news}}, your package just shipped. Track it in the app."),
          in_app: true,
        },
      ],
    }),
  },
  {
    id: "app",
    icon: Smartphone,
    title: t("Bienvenue dans l'app", "Welcome to the app"),
    text: t("Une notification à la première connexion d'un client dans votre app.", "A notification the first time a customer signs in to your app."),
    needs: [["app"]],
    input: () => ({
      name: t("Bienvenue dans l'app", "Welcome to the app"),
      trigger: "app_signed_in",
      steps: [
        {
          type: "push",
          title: t("Bienvenue {{first_name|}} 👋", "Welcome {{first_name|}} 👋"),
          body: t("Retrouvez ici vos commandes, nos nouveautés et vos offres réservées à l'app.", "Find your orders, new arrivals and app-only offers right here."),
          in_app: true,
        },
      ],
    }),
  },
];

function ScenarioStep({ selected, brand, onBack, onFinish }: { selected: SourceId[]; brand: string; onBack: () => void; onFinish: () => void }) {
  const toast = useToast();
  const available = TEMPLATES.filter((tpl) => !tpl.needs || tpl.needs.every((group) => group.some((n) => selected.includes(n))));
  const [chosen, setChosen] = useState<string[]>(() => available.map((tpl) => tpl.id));
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[] | null>(null);
  // Templates already saved, so a retry after a failure never creates them twice.
  const saved = useRef<Map<string, string>>(new Map());

  async function create() {
    setBusy(true);
    try {
      for (const tpl of available.filter((x) => chosen.includes(x.id))) {
        if (saved.current.has(tpl.id)) continue;
        const a = await api.automations.create(tpl.input(brand));
        saved.current.set(tpl.id, a.name);
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
          {t(
            <>
              C'est <em className="text-brand-500">branché.</em>
            </>,
            <>
              You're <em className="text-brand-500">connected.</em>
            </>,
          )}
        </h1>
        <p className="mt-4 text-[17px] text-slate-600 dark:text-slate-300">
          {created.length
            ? t(
                `${created.length > 1 ? `${created.length} scénarios actifs` : "1 scénario actif"} : ${created.join(", ")}. Les textes se modifient à tout moment dans Automatisations.`,
                `${created.length > 1 ? `${created.length} active workflows` : "1 active workflow"}: ${created.join(", ")}. You can edit the copy anytime in Automations.`,
              )
            : t("Vous pourrez créer vos scénarios dans Automatisations.", "You can create your workflows in Automations.")}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={onFinish}>
            {t("Aller au tableau de bord", "Go to dashboard")} <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise">
      <p className="eyebrow">{t("Dernière étape", "Last step")}</p>
      <h1 className="display mt-4 text-[40px] leading-[0.92] text-slate-900 sm:text-[60px] dark:text-white">
        {t(
          <>
            Vos premiers scénarios, <em className="text-brand-500">prêts à tourner.</em>
          </>,
          <>
            Your first workflows, <em className="text-brand-500">ready to run.</em>
          </>,
        )}
      </h1>
      <p className="mt-4 max-w-xl text-[17px] text-slate-600 dark:text-slate-300">
        {t(
          "Choisissez selon ce que vous avez branché. Ils partent tout seuls, et vous pourrez modifier les textes quand vous voulez.",
          "Pick based on what you connected. They run on their own, and you can edit the copy whenever you like.",
        )}
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {available.map((tpl) => {
          const on = chosen.includes(tpl.id);
          return (
            <button
              key={tpl.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen((c) => (on ? c.filter((x) => x !== tpl.id) : [...c, tpl.id]))}
              className={cx(
                "relative flex gap-4 rounded-[22px] bg-white p-5 text-left ring-1 transition dark:bg-slate-900",
                on ? "ring-2 ring-brand-500" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10",
              )}
            >
              <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-2xl", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-500 dark:bg-brand-900/30")}>
                <tpl.icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 pr-6">
                <span className="block font-display text-base font-bold text-slate-900 dark:text-white">{tpl.title}</span>
                <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{tpl.text}</span>
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
          {t("Retour", "Back")}
        </Button>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={onFinish} className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
            {t("Plus tard", "Later")}
          </button>
          <Button size="lg" loading={busy} disabled={!chosen.length} onClick={() => void create()}>
            {chosen.length > 1 ? t(`Activer ces ${chosen.length} scénarios`, `Activate these ${chosen.length} workflows`) : t("Activer ce scénario", "Activate this workflow")}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

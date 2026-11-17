import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import {
  ArrowRight,
  Check,
  Code2,
  Contact,
  FileSpreadsheet,
  Globe,
  Layers,
  LayoutDashboard,
  MousePointerClick,
  Plug,
  ShoppingBag,
  Smartphone,
  Store,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { t } from "../i18n";

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Everything that can feed Pingsell today (store connector, CSV import, REST API, mobile SDK). */
const SOURCES: Array<{ icon: LucideIcon; label: string; how: string }> = [
  { icon: ShoppingBag, label: t("Votre boutique en ligne", "Your online store"), how: t("Sans code", "No code") },
  { icon: Globe, label: t("Votre site", "Your website"), how: "API" },
  { icon: Contact, label: t("Votre CRM", "Your CRM"), how: "API" },
  { icon: Smartphone, label: t("Votre app iOS & Android", "Your iOS & Android app"), how: "SDK" },
  { icon: Store, label: t("Votre caisse", "Your POS"), how: "API" },
  { icon: LayoutDashboard, label: t("Votre back-office", "Your back office"), how: "API" },
  { icon: FileSpreadsheet, label: t("Un fichier Excel / CSV", "An Excel / CSV file"), how: "Import" },
  { icon: Wrench, label: t("Vos outils maison", "Your in-house tools"), how: "API" },
];

const PATHS = [
  {
    icon: MousePointerClick,
    badge: t("1 clic", "1 click"),
    title: t("Sans une ligne de code", "Without a line of code"),
    text: t(
      "Connectez votre boutique : clients, commandes et paniers arrivent tout seuls. Ou importez votre fichier de contacts.",
      "Connect your store: customers, orders and carts flow in on their own. Or import your contact file.",
    ),
    points: [t("Boutique connectée sans code", "Store connected with no code"), t("Import Excel / CSV", "Excel / CSV import"), t("Scénarios prêts à l'emploi", "Ready-to-use flows")],
  },
  {
    icon: Code2,
    badge: "≈ 5 minutes",
    title: t("Avec quelques lignes", "With a few lines"),
    text: t(
      "Une clé API et un appel web : votre site, votre CRM ou votre caisse alimentent Pingsell, dans n'importe quel langage.",
      "One API key and one web request: your website, CRM or POS feeds Pingsell, in any language.",
    ),
    points: ["PHP, Node, Python, Java…", t("Exemples prêts à copier", "Copy-paste examples"), t("Déclenche vos automatisations", "Triggers your automations")],
  },
  {
    icon: Smartphone,
    badge: t("SDK prêt", "SDK ready"),
    title: t("Dans votre app mobile", "In your mobile app"),
    text: t(
      "Notifications sur l'écran verrouillé, centre de notifications et écran de permission, déjà construits pour vous.",
      "Lock screen notifications, notification center and permission screen, already built for you.",
    ),
    points: ["React Native & Expo", t("Apps natives via l'API", "Native apps via the API"), t("Votre marque, vos couleurs", "Your brand, your colors")],
  },
];

const STEPS = [
  [t("Créez votre compte", "Create your account"), t("Gratuit, sans carte bancaire.", "Free, no credit card required.")],
  [t("Branchez votre source", "Connect your source"), t("Votre boutique, un fichier ou quelques lignes de code.", "Your store, a file or a few lines of code.")],
  [
    t("Activez un scénario", "Turn on a flow"),
    t("Bienvenue, panier abandonné, commande expédiée : ça tourne.", "Welcome, abandoned cart, order shipped: it just runs."),
  ],
];

/** Positions of the sources around the hub, on a circle (percent of the square). */
const point = (i: number, n: number, r = 40) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
};

function Hub() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const animate = inView && !reduce;

  return (
    <div ref={ref} className="relative mx-auto aspect-square w-full max-w-[520px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <circle cx="50" cy="50" r="40" fill="none" stroke="#dbe3f1" strokeWidth="0.25" strokeDasharray="0.8 1.2" />
        {SOURCES.map((_, i) => {
          const p = point(i, SOURCES.length);
          return (
            <g key={i}>
              <line x1={p.x} y1={p.y} x2="50" y2="50" stroke="#c9d6f3" strokeWidth="0.3" />
              {animate && (
                <motion.circle
                  r="0.9"
                  fill="#145cff"
                  initial={{ cx: p.x, cy: p.y, opacity: 0 }}
                  animate={{ cx: [p.x, 50], cy: [p.y, 50], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.8, delay: i * 0.35, repeat: Infinity, repeatDelay: SOURCES.length * 0.35 - 1.8 + 0.6, ease: "easeIn" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Hub */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.div
          className="absolute inset-0 rounded-[26px] bg-brand-500/30"
          animate={animate ? { scale: [1, 1.35], opacity: [0.6, 0] } : undefined}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
        <div className="relative flex size-[92px] flex-col items-center justify-center rounded-[26px] bg-brand-500 text-white shadow-[0_20px_50px_-15px_rgba(20,92,255,0.8)] sm:size-[112px]">
          <svg viewBox="0 0 24 24" className="size-7 sm:size-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7l8 6 8-6" />
            <rect x="3" y="5" width="18" height="14" rx="3" />
          </svg>
          <span className="mt-1.5 font-display text-[11px] font-extrabold tracking-wide uppercase sm:text-xs">Pingsell</span>
        </div>
      </div>

      {/* Sources */}
      {SOURCES.map((s, i) => {
        const p = point(i, SOURCES.length);
        return (
          <motion.div
            key={s.label}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            initial={reduce ? false : { opacity: 0, scale: 0.7 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 + i * 0.06, ease: EASE }}
          >
            <div className="flex w-[86px] flex-col items-center gap-1 text-center sm:w-[118px]">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-[0_8px_24px_-12px_rgba(11,33,74,0.35)] ring-1 ring-slate-900/[0.07] sm:size-12">
                <s.icon className="size-[18px] sm:size-5" strokeWidth={1.75} />
              </span>
              <span className="text-[11px] leading-tight font-semibold text-slate-800 sm:text-[13px]">{s.label}</span>
              <span className="rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-bold text-brand-600 sm:text-[11px]">{s.how}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** "Pingsell s'adapte à vous": the first thing to understand, right after the hero. */
export function AdaptSection() {
  return (
    <section id="adapte" className="relative overflow-hidden border-y border-slate-900/[0.07] bg-slate-50 py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div className="reveal min-w-0">
            <p className="eyebrow">{t("Intégration", "Integration")}</p>
            <h2 className="display mt-4 text-[38px] leading-[0.92] sm:text-[56px]">
              {t(
                <>
                  Pingsell s'adapte à vous. <em className="text-brand-500">Pas l'inverse.</em>
                </>,
                <>
                  Pingsell adapts to you. <em className="text-brand-500">Not the other way around.</em>
                </>,
              )}
            </h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-slate-600">
              {t(
                "Boutique en ligne, site sur mesure, CRM, logiciel de caisse, app mobile ou simple fichier Excel : vous gardez vos outils et votre façon de travailler. Pingsell se branche dessus, en un clic ou en quelques lignes.",
                "Online store, custom website, CRM, POS software, mobile app or a simple Excel file: keep your tools and the way you work. Pingsell plugs right in, in one click or a few lines of code.",
              )}
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                [Plug, t("Dans votre logiciel", "Inside your software"), t("Vos équipes restent dans leur outil, Pingsell envoie en coulisses.", "Your teams stay in their tool while Pingsell sends behind the scenes.")],
                [Layers, t("Ou à côté", "Or alongside it"), t("Un espace email et push complet, alimenté par tous vos outils.", "A complete email and push workspace, fed by all your tools.")],
              ].map(([Icon, title, d]) => {
                const I = Icon as LucideIcon;
                return (
                  <div key={title as string} className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
                    <I className="size-4 text-brand-500" strokeWidth={1.75} />
                    <p className="mt-2.5 font-display text-[15px] font-bold">{title as string}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{d as string}</p>
                  </div>
                );
              })}
            </div>

            <ol className="mt-8 space-y-3">
              {STEPS.map(([title, d], i) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-900 font-display text-xs font-bold text-white">{i + 1}</span>
                  <p className="pt-0.5 text-[15px] text-slate-600">
                    <span className="font-semibold text-slate-900">{title}.</span> {d}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="reveal min-w-0">
            <Hub />
          </div>
        </div>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {PATHS.map((p, i) => (
            <div key={p.title} className="reveal flex flex-col rounded-[22px] bg-white p-7 ring-1 ring-slate-900/[0.07]" style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                  <p.icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="rounded-full bg-slate-900 px-3 py-1 font-display text-xs font-bold text-white">{p.badge}</span>
              </div>
              <h3 className="display mt-8 text-[26px] leading-none">{p.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{p.text}</p>
              <ul className="mt-5 space-y-2 border-t border-slate-900/[0.07] pt-5">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-center gap-2 text-sm text-slate-700">
                    <Check className="size-4 shrink-0 text-brand-500" /> {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="reveal mt-8 flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-6">
          <p className="text-[15px] text-slate-600">
            {t(
              "Pas de développeur ? La connexion sans code et l'import suffisent pour démarrer.",
              "No developer? The no-code connection and import are all you need to get started.",
            )}
          </p>
          <a href="#integration" className="group inline-flex items-center gap-1.5 font-display text-sm font-bold text-brand-500">
            {t("Voir l'API et les exemples de code", "See the API and code examples")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  );
}

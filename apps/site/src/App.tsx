import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Code2,
  Menu,
  Palette,
  ShoppingBag,
  Smartphone,
  Target,
  Type,
  Users,
  Workflow,
  X,
  Zap,
  Eye,
  Gift,
  Heart,
  ShoppingCart,
  Tag,
} from "lucide-react";
import { BLOCKS, FAQ, LOGIN_URL, PRICING, SIGNUP_URL, monthlyPrice } from "./content";
import { BrandMock, FlowMock, PhoneMock, ReportMock } from "./Mocks";
import { Hero } from "./sections/Hero";
import { EditorDemo } from "./sections/EditorDemo";
import { BrandShowcase } from "./sections/BrandShowcase";
import { MagneticLink, useFinePointer } from "./sections/motion-kit";

const NAV = [
  ["Fonctionnalités", "#fonctionnalites"],
  ["Éditeur", "#editeur"],
  ["Shopify", "#shopify"],
  ["Tarifs", "#tarifs"],
  ["FAQ", "#faq"],
] as const;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#top" className={`flex items-center gap-2 font-display text-lg font-extrabold tracking-tight uppercase ${light ? "text-white" : "text-slate-900"}`}>
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand-500 text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7l8 6 8-6" />
          <rect x="3" y="5" width="18" height="14" rx="3" />
        </svg>
      </span>
      Missive
    </a>
  );
}

function CTA({ children = "Essai gratuit", dark = false, className = "" }: { children?: React.ReactNode; dark?: boolean; className?: string }) {
  const fine = useFinePointer();
  const reduce = useReducedMotion() ?? false;
  return (
    <MagneticLink
      href={SIGNUP_URL}
      enabled={fine && !reduce}
      className={`group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full px-6 font-display text-sm font-semibold transition-colors ${
        dark ? "bg-white text-slate-900 hover:bg-brand-50" : "bg-brand-500 text-white shadow-[0_10px_30px_-10px_rgba(20,92,255,0.7)] hover:bg-brand-600"
      } ${className}`}
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/30 blur-sm transition-transform duration-700 ease-out group-hover:translate-x-[450%]" />
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
    </MagneticLink>
  );
}

/** Thin brand bar under the header showing reading progress. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  return <motion.div aria-hidden className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-brand-500" style={{ scaleX }} />;
}

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition ${scrolled || open ? "border-b border-slate-900/[0.07] bg-white/85 backdrop-blur-xl" : ""}`}>
      <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-7 lg:flex">
          {NAV.map(([l, h]) => (
            <a key={h} href={h} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
              {l}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-5 sm:flex">
          <a href={LOGIN_URL} className="text-sm font-semibold text-slate-900 hover:text-brand-500">
            Se connecter
          </a>
          <CTA className="h-10 px-5" />
        </div>
        <button className="ml-auto flex size-10 items-center justify-center rounded-full lg:hidden sm:ml-0" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-900/[0.07] bg-white px-4 pt-2 pb-6 lg:hidden">
          {NAV.map(([l, h]) => (
            <a key={h} href={h} onClick={() => setOpen(false)} className="block border-b border-slate-900/[0.06] py-3.5 font-display text-lg font-bold text-slate-900">
              {l}
            </a>
          ))}
          <div className="mt-5 flex flex-col gap-3">
            <CTA />
            <a href={LOGIN_URL} className="flex h-12 items-center justify-center rounded-full font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15">
              Se connecter
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

function Integrations() {
  const items = [
    [ShoppingBag, "Shopify", "Clients et commandes synchronisés"],
    [Code2, "API & back-office", "Branchez votre site ou votre CRM"],
    [Smartphone, "App iOS & Android", "Vos chiffres dans la poche"],
  ] as const;
  return (
    <section className="border-y border-slate-900/[0.07] bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
        {items.map(([Icon, t, d]) => (
          <div key={t} className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-500 ring-1 ring-slate-900/[0.07]">
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="font-display text-sm font-bold">{t}</p>
              <p className="text-sm text-slate-500">{d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, text, center = false, light = false }: { eyebrow: string; title: React.ReactNode; text?: string; center?: boolean; light?: boolean }) {
  return (
    <div className={`reveal max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      <p className={`eyebrow ${light ? "!text-brand-300" : ""}`}>{eyebrow}</p>
      <h2 className={`display mt-4 text-[38px] leading-[0.92] sm:text-[52px] ${light ? "text-white" : ""}`}>{title}</h2>
      {text && <p className={`mt-5 text-[17px] leading-relaxed ${light ? "text-white/70" : "text-slate-600"}`}>{text}</p>}
    </div>
  );
}

function Pillars() {
  const items = [
    {
      icon: Palette,
      n: "01",
      title: "Créer",
      text: `Un éditeur glisser-déposer avec ${BLOCKS.length} blocs, vos couleurs, vos polices et l'aperçu mobile. Vos emails ressemblent à votre marque, pas à un modèle.`,
    },
    {
      icon: Target,
      n: "02",
      title: "Cibler",
      text: "Segmentez par tags, statut, achats ou date d'inscription. Avec Shopify, vos clients et leurs commandes arrivent tout seuls.",
    },
    {
      icon: Workflow,
      n: "03",
      title: "Automatiser",
      text: "Bienvenue, remerciement après achat, relance de panier abandonné : des scénarios qui travaillent pendant que vous dormez.",
    },
  ];
  return (
    <section id="fonctionnalites" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <SectionHead eyebrow="Fonctionnalités" title={<>Tout pour vendre <em className="text-brand-500">par email.</em></>} />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {items.map((it, i) => (
          <div key={it.n} className="reveal rounded-[22px] bg-slate-100 p-7" style={{ transitionDelay: `${i * 80}ms` }}>
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-full bg-white text-brand-500">
                <it.icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="font-display text-sm font-bold text-slate-400">{it.n}</span>
            </div>
            <h3 className="display mt-10 text-3xl">{it.title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{it.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Personalisation() {
  const points = [
    [Palette, "Style de marque", "Enregistrez couleurs, polices et boutons une fois ; chaque nouvelle campagne part de votre style."],
    [Type, "Vos propres polices", "Choisissez dans Google Fonts ou importez vos fichiers de police, avec une police de secours pour les messageries qui ne les chargent pas."],
    [Eye, "Aperçu ordinateur et mobile", "Vérifiez le rendu sur les deux formats et envoyez-vous un test avant de programmer."],
    [Zap, "Personnalisation bloc par bloc", "Chaque bloc a ses réglages : marges, fond, couleurs, police, taille du texte, alignement."],
  ] as const;
  return (
    <section className="overflow-hidden bg-slate-950 py-24 text-white lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          light
          eyebrow="Personnalisation"
          title={<>Réglé <em className="text-brand-400">au pixel près.</em></>}
          text="Pas besoin de graphiste ni de code. Glissez vos blocs, écrivez directement dans l'email, changez tout ce que vous voulez."
        />
      </div>
      <div className="mx-auto mt-16 grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div className="grid gap-8 sm:grid-cols-2">
          {points.map(([Icon, t, d]) => (
            <div key={t} className="reveal">
              <Icon className="size-5 text-brand-400" strokeWidth={1.75} />
              <h3 className="mt-3 font-display text-lg font-bold">{t}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-white/60">{d}</p>
            </div>
          ))}
        </div>
        <div className="reveal">
          <BrandMock />
        </div>
      </div>
    </section>
  );
}

function Shopify() {
  const flows = [
    [Heart, "Bienvenue", "à l'inscription"],
    [Gift, "Merci pour votre commande", "après un achat"],
    [ShoppingCart, "Panier abandonné", "relance en 2 temps"],
    [Tag, "Tag ajouté", "à n'importe quel contact"],
  ] as const;
  return (
    <section id="shopify" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHead
            eyebrow="Shopify & automatisations"
            title={<>Branchez votre boutique, <em className="text-brand-500">en un clic.</em></>}
            text="Vos clients et leurs commandes se synchronisent. Déclenchez les bons emails au bon moment, et suivez le chiffre d'affaires généré directement dans vos rapports."
          />
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {flows.map(([Icon, t, d]) => (
              <div key={t} className="reveal flex items-center gap-3 rounded-2xl bg-slate-100 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-500">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="font-display text-sm font-bold">{t}</p>
                  <p className="text-xs text-slate-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="reveal mt-6 flex items-start gap-2 text-sm text-slate-500">
            <Code2 className="mt-0.5 size-4 shrink-0 text-brand-500" />
            Pas sur Shopify ? L'API Missive se branche sur votre back-office pour ajouter des contacts et déclencher des scénarios.
          </p>
        </div>
        <div className="reveal rounded-[28px] bg-[radial-gradient(#c3cddf_1px,transparent_1px)] bg-slate-50 bg-[size:16px_16px] p-6 ring-1 ring-slate-900/[0.06] sm:p-10">
          <FlowMock />
        </div>
      </div>
    </section>
  );
}

function Reports() {
  return (
    <section className="bg-slate-100 py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        <div className="reveal order-2 lg:order-1">
          <ReportMock />
        </div>
        <div className="order-1 lg:order-2">
          <SectionHead
            eyebrow="Rapports"
            title={<>Sachez ce qui <em className="text-brand-500">rapporte.</em></>}
            text="Ouvertures, clics, désinscriptions, et le chiffre d'affaires Shopify sur votre tableau de bord. Vous voyez quelles campagnes marchent, et vous refaites celles-là."
          />
          <ul className="reveal mt-8 space-y-3">
            {["Statistiques par campagne et par lien", "Désinscriptions prises en compte immédiatement", "Tableau de bord du mois en un coup d'œil"].map((t) => (
              <li key={t} className="flex items-center gap-2.5 text-[15px] text-slate-700">
                <BarChart3 className="size-4 text-brand-500" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TeamMobile() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="reveal flex flex-col rounded-[28px] bg-slate-900 p-8 text-white sm:p-10">
          <Users className="size-6 text-brand-400" strokeWidth={1.75} />
          <h3 className="display mt-6 text-[34px] leading-[0.92] sm:text-[42px]">
            À plusieurs,
            <br />
            <em className="text-brand-400">sans supplément.</em>
          </h3>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/65">
            Invitez un associé, un freelance ou votre agence. Chacun a son propre accès, vous choisissez son rôle.
          </p>
          <div className="mt-auto space-y-2 pt-10">
            {[
              ["Propriétaire", "Tout, y compris l'équipe"],
              ["Administrateur", "Campagnes, contacts, réglages et équipe"],
              ["Éditeur", "Campagnes, contacts et automatisations"],
            ].map(([r, d]) => (
              <div key={r} className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                <span className="font-display text-sm font-bold">{r}</span>
                <span className="text-right text-xs text-white/55">{d}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="reveal grid items-center gap-8 rounded-[28px] bg-brand-500 p-8 text-white sm:grid-cols-[1fr_auto] sm:p-10">
          <div>
            <Smartphone className="size-6 text-white/80" strokeWidth={1.75} />
            <h3 className="display mt-6 text-[34px] leading-[0.92] sm:text-[42px]">
              Votre boutique
              <br />
              dans la poche.
            </h3>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/80">
              L'app Missive sur iOS et Android : vos chiffres du mois, vos campagnes et vos contacts, où que vous soyez.
            </p>
          </div>
          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

function Why() {
  const rows = [
    ["Facturation", "Au nombre de contacts, même inactifs", "Aux emails réellement envoyés"],
    ["Fonctionnalités", "Débloquées selon la formule", "Toutes incluses, dès le gratuit"],
    ["Équipe", "Utilisateurs supplémentaires payants", "Invitations sans supplément"],
    ["Personnalisation", "Modèles figés, polices limitées", "Vos couleurs, vos polices, bloc par bloc"],
    ["E-commerce", "Intégrations à configurer", "Shopify en un clic + API"],
  ];
  return (
    <section className="bg-slate-50 py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <SectionHead center eyebrow="Pourquoi Missive" title={<>Pensé pour <em className="text-brand-500">les boutiques.</em></>} />
        <div className="reveal mt-12 overflow-hidden rounded-[22px] bg-white ring-1 ring-slate-900/[0.08]">
          <div className="grid grid-cols-[1fr_1fr] gap-px bg-slate-900/[0.06] text-sm sm:grid-cols-[0.8fr_1fr_1fr]">
            <div className="hidden bg-white p-4 sm:block" />
            <div className="bg-white p-4 font-display text-xs font-bold tracking-wider text-slate-400 uppercase">Outils classiques</div>
            <div className="bg-brand-500 p-4 font-display text-xs font-bold tracking-wider text-white uppercase">Missive</div>
            {rows.map(([k, a, b]) => (
              <div key={k} className="contents">
                <div className="col-span-2 bg-slate-50 px-4 pt-3 pb-1 font-display text-xs font-bold text-slate-900 sm:col-span-1 sm:bg-white sm:p-4 sm:text-sm">{k}</div>
                <div className="bg-white p-4 text-slate-500">{a}</div>
                <div className="flex items-start gap-2 bg-brand-50 p-4 font-medium text-slate-900">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand-500" /> {b}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [3000, 5000, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 250000, 500000, 1000000];

function Pricing() {
  const [i, setI] = useState(3);
  const emails = STEPS[i];
  const price = useMemo(() => monthlyPrice(emails), [emails]);
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  return (
    <section id="tarifs" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <SectionHead
        center
        eyebrow="Tarifs"
        title={<>Payez ce que <em className="text-brand-500">vous envoyez.</em></>}
        text="Un seul tarif, toutes les fonctionnalités pour tout le monde. Vos contacts sont illimités : seuls les emails envoyés comptent."
      />
      <div className="reveal mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-[1.3fr_1fr]">
        <div className="rounded-[22px] bg-slate-900 p-7 text-white sm:p-9">
          <label htmlFor="volume" className="eyebrow !text-white/60">
            Emails envoyés par mois
          </label>
          <p className="mt-3 font-display text-4xl font-extrabold tracking-tight">{fmt(emails)}</p>
          <input
            id="volume"
            type="range"
            min={0}
            max={STEPS.length - 1}
            value={i}
            onChange={(e) => setI(Number(e.target.value))}
            className="mt-6 w-full accent-brand-500"
          />
          <div className="mt-1 flex justify-between text-xs text-white/40">
            <span>3 000</span>
            <span>1 000 000</span>
          </div>
          <div className="mt-8 flex items-end gap-2 border-t border-white/10 pt-6">
            <span className="display text-6xl leading-none">{price === 0 ? "0" : fmt(price)} €</span>
            <span className="pb-1.5 text-sm text-white/60">/ mois HT</span>
          </div>
          <p className="mt-2 text-sm text-white/60">{price === 0 ? "Gratuit, pour toujours." : `Soit ${(price / (emails / 1000)).toFixed(2).replace(".", ",")} € les 1 000 emails en moyenne.`}</p>
          <CTA dark className="mt-8 w-full">
            Commencer gratuitement
          </CTA>
        </div>
        <div className="rounded-[22px] bg-slate-100 p-7 sm:p-9">
          <p className="font-display text-sm font-bold">Inclus pour tous</p>
          <ul className="mt-4 space-y-2.5 text-[15px] text-slate-700">
            {[
              `${fmt(PRICING.freeEmails)} emails offerts chaque mois`,
              "Contacts illimités",
              `Éditeur complet, ${BLOCKS.length} blocs`,
              "Polices et style de marque",
              "Automatisations",
              "Shopify et API",
              "Équipe sans supplément",
              "App mobile",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-500" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-slate-900/10 pt-5 text-xs leading-relaxed text-slate-500">
            {PRICING.tiers.map((t, k) => {
              const from = k === 0 ? PRICING.freeEmails : PRICING.tiers[k - 1].upTo;
              return (
                <p key={k} className="flex justify-between gap-3">
                  <span>{t.upTo === Infinity ? `Au-delà de ${fmt(from)}` : `De ${fmt(from)} à ${fmt(t.upTo)}`}</span>
                  <span className="font-semibold text-slate-700">{t.per1000.toFixed(2).replace(".", ",")} € / 1 000</span>
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="bg-slate-50 py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="FAQ" title={<>Vos <em className="text-brand-500">questions.</em></>} />
        <div className="reveal divide-y divide-slate-900/10 border-y border-slate-900/10">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-[17px] font-bold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-slate-900/10 transition group-open:rotate-45">
                  <span className="text-lg leading-none text-brand-500">+</span>
                </span>
              </summary>
              <p className="mt-3 pr-12 text-[15px] leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="px-4 py-24 sm:px-6 lg:py-32">
      <div className="reveal relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-slate-950 px-6 py-16 text-center text-white sm:px-12 sm:py-24">
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-brand-500/40 blur-[120px]" />
        <div className="relative">
          <h2 className="display text-[44px] leading-[0.9] sm:text-[72px]">
            Votre prochaine
            <br />
            <em className="text-brand-400">campagne</em> commence ici.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[17px] text-white/70">
            Créez votre compte en une minute. {PRICING.freeEmails.toLocaleString("fr-FR")} emails offerts chaque mois, sans carte bancaire.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <CTA>Commencer gratuitement</CTA>
            <a href={LOGIN_URL} className="inline-flex h-12 items-center justify-center rounded-full px-6 font-display text-sm font-semibold text-white ring-1 ring-white/20 hover:ring-white/50">
              J'ai déjà un compte
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-900/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-500">L'emailing pensé pour les e-commerçants.</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2.5 text-sm sm:grid-cols-3">
          {NAV.map(([l, h]) => (
            <a key={h} href={h} className="text-slate-600 hover:text-slate-900">
              {l}
            </a>
          ))}
          <a href={LOGIN_URL} className="text-slate-600 hover:text-slate-900">
            Se connecter
          </a>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl border-t border-slate-900/[0.07] px-4 py-6 text-xs text-slate-400 sm:px-6">© {new Date().getFullYear()} Missive</div>
    </footer>
  );
}

export function App() {
  useReveal();
  return (
    <>
      <ScrollProgress />
      <Header />
      <main>
        <Hero />
        <Integrations />
        <Pillars />
        <EditorDemo />
        <BrandShowcase />
        <Personalisation />
        <Shopify />
        <Reports />
        <TeamMobile />
        <Why />
        <Pricing />
        <Faq />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

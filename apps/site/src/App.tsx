import { useEffect, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Code2,
  Menu,
  Palette,
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
import { BLOCKS, FAQ, LOGIN_URL, PLANS, PRICING, SIGNUP_URL, VOLUMES } from "./content";
import { LANG, LANGS, LOCALE, setLang, t } from "./i18n";

const PRO_FROM = PLANS.find((p) => p.id === "pro")?.prices?.[VOLUMES[0]] ?? 0;
import { BrandMock, FlowMock, PhoneMock, ReportMock } from "./Mocks";
import { Hero } from "./sections/Hero";
import { PingsellLogo } from "./PingsellLogo";
import { EditorDemo } from "./sections/EditorDemo";
import { BrandShowcase } from "./sections/BrandShowcase";
import { ApiSection } from "./sections/ApiSection";
import { AdaptSection } from "./sections/AdaptSection";
import { PushSection } from "./sections/PushSection";
import { PricingSection } from "./sections/PricingSection";
import { MagneticLink, useFinePointer } from "./sections/motion-kit";

const NAV = [
  [t("Fonctionnalités", "Features"), "#fonctionnalites"],
  [t("Éditeur", "Editor"), "#editeur"],
  ["Push", "#push"],
  [t("Intégrations", "Integrations"), "#adapte"],
  [t("Tarifs", "Pricing"), "#tarifs"],
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
    <a href="#top" className="flex items-center" aria-label={t("Pingsell, retour en haut", "Pingsell, back to top")}>
      <PingsellLogo tone={light ? "light" : "dark"} className="h-8 w-auto" />
    </a>
  );
}

function CTA({ children = t("Essai gratuit", "Free trial"), dark = false, className = "" }: { children?: React.ReactNode; dark?: boolean; className?: string }) {
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

/** Section currently under the header, so the nav can show where you are. */
function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const on = () => {
      const line = 120;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line && el.getBoundingClientRect().bottom > line) current = id;
      }
      setActive(current);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [ids]);
  return active;
}

const NAV_IDS = NAV.map(([, h]) => h.slice(1));

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = useActiveSection(NAV_IDS);
  const reduce = useReducedMotion() ?? false;
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pill = hovered ?? active;
  const island = scrolled || open;

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
      <div
        className={`mx-auto flex h-14 items-center gap-6 rounded-full pr-2 pl-5 transition-all duration-500 ease-out ${
          island
            ? "max-w-5xl bg-white/80 shadow-[0_12px_40px_-16px_rgba(11,33,74,0.35)] ring-1 ring-slate-900/[0.07] backdrop-blur-xl"
            : "max-w-6xl bg-transparent ring-1 ring-transparent"
        }`}
      >
        <Logo />

        <nav className="mx-auto hidden items-center lg:flex" onMouseLeave={() => setHovered(null)} aria-label={t("Navigation principale", "Main navigation")}>
          {NAV.map(([label, href]) => {
            const id = href.slice(1);
            const isActive = active === id;
            return (
              <a
                key={href}
                href={href}
                onMouseEnter={() => setHovered(id)}
                aria-current={isActive ? "location" : undefined}
                className={`relative isolate rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors duration-200 ${
                  isActive || hovered === id ? "text-slate-900" : "text-slate-500"
                }`}
              >
                {pill === id && (
                  <motion.span
                    layoutId="nav-pill"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    className={`absolute inset-0 -z-10 rounded-full ${isActive && !hovered ? "bg-brand-50" : "bg-slate-900/[0.05]"}`}
                  />
                )}
                {label}
                {isActive && <span aria-hidden className="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-brand-500" />}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex lg:ml-0">
          <a
            href={LOGIN_URL}
            className="rounded-full px-4 py-2 text-[14px] font-semibold text-slate-900 transition-colors hover:bg-slate-900/[0.05]"
          >
            {t("Se connecter", "Log in")}
          </a>
          <LangSwitch />
          <CTA className="h-10 px-5" />
        </div>

        <button
          className="ml-auto flex size-10 items-center justify-center rounded-full text-slate-900 transition hover:bg-slate-900/[0.05] sm:ml-0 lg:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? t("Fermer le menu", "Close menu") : t("Ouvrir le menu", "Open menu")}
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="mx-auto mt-2 max-w-5xl origin-top rounded-[28px] bg-white/95 p-3 shadow-[0_24px_60px_-20px_rgba(11,33,74,0.45)] ring-1 ring-slate-900/[0.07] backdrop-blur-xl lg:hidden"
        >
          <nav aria-label={t("Navigation principale", "Main navigation")}>
            {NAV.map(([label, href], i) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 font-display text-lg font-bold transition-colors hover:bg-slate-50 ${
                  active === href.slice(1) ? "text-brand-500" : "text-slate-900"
                }`}
              >
                <span className="w-6 font-display text-[11px] font-semibold tracking-[0.15em] text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                {label}
                <ArrowRight className="ml-auto size-4 text-slate-300" />
              </a>
            ))}
          </nav>
          <div className="mt-2 grid gap-2 border-t border-slate-900/[0.06] p-2 pt-4 sm:hidden">
            <CTA className="w-full" />
            <a href={LOGIN_URL} className="flex h-12 items-center justify-center rounded-full font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15">
              {t("Se connecter", "Log in")}
            </a>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-900/[0.06] px-4 pt-3 pb-1">
            <span className="text-[13px] font-medium text-slate-500">{t("Langue", "Language")}</span>
            <LangSwitch />
          </div>
        </motion.div>
      )}
    </header>
  );
}

/** FR / EN switch: a small segmented pill matching the floating header. Switching reloads the page. */
function LangSwitch() {
  return (
    <div role="group" aria-label={t("Langue", "Language")} className="flex items-center rounded-full bg-slate-900/[0.05] p-0.5 ring-1 ring-slate-900/[0.06]">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={LANG === l}
          lang={l}
          title={l === "fr" ? "Français" : "English"}
          className={`rounded-full px-2.5 py-1 font-display text-[11px] font-bold tracking-[0.08em] uppercase transition-colors ${
            LANG === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
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
      title: t("Créer", "Create"),
      text: t(
        `Un éditeur glisser-déposer avec ${BLOCKS.length} blocs, vos couleurs, vos polices et l'aperçu mobile. Vos emails ressemblent à votre marque, pas à un modèle.`,
        `A drag-and-drop editor with ${BLOCKS.length} blocks, your colors, your fonts and a mobile preview. Your emails look like your brand, not a template.`,
      ),
    },
    {
      icon: Target,
      n: "02",
      title: t("Cibler", "Target"),
      text: t(
        "Segmentez par tags, statut, achats ou date d'inscription. Branchez votre site : vos clients et leurs commandes arrivent tout seuls.",
        "Segment by tags, status, purchases or signup date. Connect your website and your customers and their orders flow in on their own.",
      ),
    },
    {
      icon: Workflow,
      n: "03",
      title: t("Automatiser", "Automate"),
      text: t(
        "Bienvenue, remerciement après achat, relance de panier abandonné : des scénarios qui travaillent pendant que vous dormez.",
        "Welcome, post-purchase thank-you, abandoned cart follow-up: flows that work while you sleep.",
      ),
    },
  ];
  return (
    <section id="fonctionnalites" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <SectionHead
        eyebrow={t("Fonctionnalités", "Features")}
        title={t(<>Tout pour vendre <em className="text-brand-500">par email.</em></>, <>Everything you need to sell <em className="text-brand-500">by email.</em></>)}
      />
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
    [
      Palette,
      t("Style de marque", "Brand style"),
      t(
        "Enregistrez couleurs, polices et boutons une fois ; chaque nouvelle campagne part de votre style.",
        "Save your colors, fonts and buttons once; every new campaign starts from your style.",
      ),
    ],
    [
      Type,
      t("Vos propres polices", "Your own fonts"),
      t(
        "Choisissez dans Google Fonts ou importez vos fichiers de police, avec une police de secours pour les messageries qui ne les chargent pas.",
        "Pick from Google Fonts or upload your own font files, with a fallback font for email clients that don't load them.",
      ),
    ],
    [
      Eye,
      t("Aperçu ordinateur et mobile", "Desktop and mobile preview"),
      t(
        "Vérifiez le rendu sur les deux formats et envoyez-vous un test avant de programmer.",
        "Check how it looks on both and send yourself a test before scheduling.",
      ),
    ],
    [
      Zap,
      t("Personnalisation bloc par bloc", "Block-by-block customization"),
      t(
        "Chaque bloc a ses réglages : marges, fond, couleurs, police, taille du texte, alignement.",
        "Every block has its own settings: spacing, background, colors, font, text size, alignment.",
      ),
    ],
  ] as const;
  return (
    <section className="overflow-hidden bg-slate-950 py-24 text-white lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          light
          eyebrow={t("Personnalisation", "Customization")}
          title={t(<>Réglé <em className="text-brand-400">au pixel près.</em></>, <>Tuned <em className="text-brand-400">down to the pixel.</em></>)}
          text={t(
            "Pas besoin de graphiste ni de code. Glissez vos blocs, écrivez directement dans l'email, changez tout ce que vous voulez.",
            "No designer or code needed. Drag in your blocks, type right into the email, change anything you like.",
          )}
        />
      </div>
      <div className="mx-auto mt-16 grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div className="grid gap-8 sm:grid-cols-2">
          {points.map(([Icon, title, d]) => (
            <div key={title} className="reveal">
              <Icon className="size-5 text-brand-400" strokeWidth={1.75} />
              <h3 className="mt-3 font-display text-lg font-bold">{title}</h3>
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

function Boutique() {
  const flows = [
    [Heart, t("Bienvenue", "Welcome"), t("à l'inscription", "on signup")],
    [Gift, t("Merci pour votre commande", "Thanks for your order"), t("après un achat", "after a purchase")],
    [ShoppingCart, t("Panier abandonné", "Abandoned cart"), t("relance en 2 temps", "2-step follow-up")],
    [Tag, t("Tag ajouté", "Tag added"), t("à n'importe quel contact", "to any contact")],
  ] as const;
  return (
    <section id="boutique" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHead
            eyebrow={t("Votre site & automatisations", "Your website & automations")}
            title={t(
              <>Branchez votre site, <em className="text-brand-500">sans y passer la semaine.</em></>,
              <>Connect your website <em className="text-brand-500">without losing a week.</em></>,
            )}
            text={t(
              "Vos clients et leurs commandes se synchronisent. Déclenchez les bons emails au bon moment, et suivez le chiffre d'affaires généré directement dans vos rapports.",
              "Your customers and their orders sync automatically. Trigger the right emails at the right time, and track revenue generated right in your reports.",
            )}
          />
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {flows.map(([Icon, title, d]) => (
              <div key={title} className="reveal flex items-center gap-3 rounded-2xl bg-slate-100 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-500">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="font-display text-sm font-bold">{title}</p>
                  <p className="text-xs text-slate-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="reveal mt-6 flex items-start gap-2 text-sm text-slate-500">
            <Code2 className="mt-0.5 size-4 shrink-0 text-brand-500" />
            {t(
              "Site sur mesure, plateforme e-commerce ou back-office maison : l'API Pingsell ajoute vos contacts et déclenche vos scénarios.",
              "Custom site, e-commerce platform or in-house back office: the Pingsell API adds your contacts and triggers your flows.",
            )}
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
            eyebrow={t("Rapports", "Reports")}
            title={t(<>Sachez ce qui <em className="text-brand-500">rapporte.</em></>, <>Know what <em className="text-brand-500">pays off.</em></>)}
            text={t(
              "Ouvertures, clics, désinscriptions, et le chiffre d'affaires de votre boutique sur votre tableau de bord. Vous voyez quelles campagnes marchent, et vous refaites celles-là.",
              "Opens, clicks, unsubscribes and your store's revenue, all on your dashboard. See which campaigns work, and do more of those.",
            )}
          />
          <ul className="reveal mt-8 space-y-3">
            {[
              t("Statistiques par campagne et par lien", "Stats per campaign and per link"),
              t("Désinscriptions prises en compte immédiatement", "Unsubscribes applied instantly"),
              t("Tableau de bord du mois en un coup d'œil", "Your month's dashboard at a glance"),
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[15px] text-slate-700">
                <BarChart3 className="size-4 text-brand-500" /> {item}
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
            {t(
              <>
                À plusieurs,
                <br />
                <em className="text-brand-400">en toute sécurité.</em>
              </>,
              <>
                Work as a team,
                <br />
                <em className="text-brand-400">safely.</em>
              </>,
            )}
          </h3>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/65">
            {t(
              "Invitez un associé, un freelance ou votre agence : jusqu'à 3 utilisateurs en Pro, sans limite en Business. Chacun a son accès, vous choisissez son rôle.",
              "Invite a partner, a freelancer or your agency: up to 3 users on Pro, unlimited on Business. Everyone gets their own login, and you pick their role.",
            )}
          </p>
          <div className="mt-auto space-y-2 pt-10">
            {[
              [t("Propriétaire", "Owner"), t("Tout, y compris l'équipe", "Everything, including the team")],
              [t("Administrateur", "Admin"), t("Campagnes, contacts, réglages et équipe", "Campaigns, contacts, settings and team")],
              [t("Éditeur", "Editor"), t("Campagnes, contacts et automatisations", "Campaigns, contacts and automations")],
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
              {t(
                <>
                  Votre boutique
                  <br />
                  dans la poche.
                </>,
                <>
                  Your store
                  <br />
                  in your pocket.
                </>,
              )}
            </h3>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/80">
              {t(
                "L'app Pingsell sur iOS et Android : vos chiffres du mois, vos campagnes et vos contacts, où que vous soyez.",
                "The Pingsell app for iOS and Android: your monthly numbers, campaigns and contacts, wherever you are.",
              )}
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
    [t("Facturation", "Billing"), t("Au nombre de contacts, même inactifs", "By number of contacts, even inactive ones"), t("Aux emails réellement envoyés", "By emails actually sent")],
    [
      t("Formule gratuite", "Free plan"),
      t("Très limitée, sans vraie personnalisation", "Very limited, no real customization"),
      t("Éditeur complet, vos polices et la connexion à votre site inclus", "Full editor, your fonts and website connection included"),
    ],
    [
      t("Automatisations", "Automations"),
      t("Réservées aux formules les plus chères", "Locked to the priciest plans"),
      t(`Incluses dès ${PRO_FROM.toLocaleString(LOCALE)} € par mois`, `Included from €${PRO_FROM.toLocaleString(LOCALE)} per month`),
    ],
    [t("Équipe", "Team"), t("Chaque utilisateur en plus est payant", "Every extra user costs more"), t("3 utilisateurs en Pro, illimités en Business", "3 users on Pro, unlimited on Business")],
    [t("Personnalisation", "Customization"), t("Modèles figés, polices limitées", "Rigid templates, limited fonts"), t("Vos couleurs, vos polices, bloc par bloc", "Your colors, your fonts, block by block")],
    ["E-commerce", t("Intégrations à configurer", "Integrations to set up"), t("Votre site branché sans code ou par API", "Your website connected with no code or via API")],
  ];
  return (
    <section className="bg-slate-50 py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <SectionHead
          center
          eyebrow={t("Pourquoi Pingsell", "Why Pingsell")}
          title={t(<>Pensé pour <em className="text-brand-500">les boutiques.</em></>, <>Built for <em className="text-brand-500">online stores.</em></>)}
        />
        <div className="reveal mt-12 overflow-hidden rounded-[22px] bg-white ring-1 ring-slate-900/[0.08]">
          <div className="grid grid-cols-[1fr_1fr] gap-px bg-slate-900/[0.06] text-sm sm:grid-cols-[0.8fr_1fr_1fr]">
            <div className="hidden bg-white p-4 sm:block" />
            <div className="bg-white p-4 font-display text-xs font-bold tracking-wider text-slate-400 uppercase">{t("Outils classiques", "Typical tools")}</div>
            <div className="bg-brand-500 p-4 font-display text-xs font-bold tracking-wider text-white uppercase">Pingsell</div>
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

function Faq() {
  return (
    <section id="faq" className="bg-slate-50 py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="FAQ" title={t(<>Vos <em className="text-brand-500">questions.</em></>, <>Your <em className="text-brand-500">questions.</em></>)} />
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
            {t(
              <>
                Votre prochaine
                <br />
                <em className="text-brand-400">campagne</em> commence ici.
              </>,
              <>
                Your next
                <br />
                <em className="text-brand-400">campaign</em> starts here.
              </>,
            )}
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[17px] text-white/70">
            {t(
              `Créez votre compte en une minute. ${PRICING.freeEmails.toLocaleString(LOCALE)} emails offerts chaque mois, sans carte bancaire.`,
              `Create your account in a minute. ${PRICING.freeEmails.toLocaleString(LOCALE)} free emails every month, no credit card required.`,
            )}
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <CTA>{t("Commencer gratuitement", "Start for free")}</CTA>
            <a href={LOGIN_URL} className="inline-flex h-12 items-center justify-center rounded-full px-6 font-display text-sm font-semibold text-white ring-1 ring-white/20 hover:ring-white/50">
              {t("J'ai déjà un compte", "I already have an account")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLUMNS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: t("Produit", "Product"),
    links: [
      [t("Fonctionnalités", "Features"), "#fonctionnalites"],
      [t("Éditeur d'emails", "Email editor"), "#editeur"],
      [t("Notifications push", "Push notifications"), "#push"],
      [t("Tarifs", "Pricing"), "#tarifs"],
    ],
  },
  {
    title: t("Intégrations", "Integrations"),
    links: [
      [t("Votre site", "Your website"), "#boutique"],
      [t("Toutes vos sources", "All your sources"), "#adapte"],
      ["API & SDK", "#integration"],
    ],
  },
  {
    title: t("Compte", "Account"),
    links: [
      [t("Créer un compte", "Create an account"), SIGNUP_URL],
      [t("Se connecter", "Log in"), LOGIN_URL],
      [t("Questions fréquentes", "FAQ"), "#faq"],
    ],
  },
];

function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-slate-900/[0.07] bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Logo />
            <p className="mt-5 font-display text-2xl leading-tight font-bold tracking-[-0.02em] text-slate-900">
              {t(
                <>
                  Chaque notif,
                  <br />
                  <span className="text-brand-500">une vente.</span>
                </>,
                <>
                  Every ping,
                  <br />
                  <span className="text-brand-500">a sale.</span>
                </>,
              )}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              {t(
                "Emails, notifications push et automatisations pour les e-commerçants. Chaque message, son chiffre d'affaires.",
                "Emails, push notifications and automations for online merchants. Every message, its revenue.",
              )}
            </p>
          </div>

          <nav aria-label={t("Pied de page", "Footer")} className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="font-display text-[11px] font-semibold tracking-[0.2em] text-slate-400 uppercase">{col.title}</p>
                <ul className="mt-4 space-y-3">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href} className="text-[15px] text-slate-600 transition-colors hover:text-brand-500">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-slate-900/[0.07] py-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Pingsell. {t("Conçu en France.", "Designed in France.")}</p>
          <a href="#top" className="inline-flex items-center gap-1.5 transition-colors hover:text-slate-900">
            {t("Retour en haut", "Back to top")}
            <ArrowRight className="size-3.5 -rotate-90" />
          </a>
        </div>
      </div>

      {/* Oversized wordmark, cropped at the bottom edge as a signature. */}
      <div aria-hidden className="pointer-events-none mx-auto max-w-6xl px-4 sm:px-6">
        <PingsellLogo tone="mono" className="-mb-[3%] h-auto w-full translate-y-[18%] text-slate-900/[0.05]" />
      </div>
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
        <AdaptSection />
        <Pillars />
        <EditorDemo />
        <BrandShowcase />
        <Personalisation />
        <Boutique />
        <ApiSection />
        <PushSection />
        <Reports />
        <TeamMobile />
        <Why />
        <PricingSection />
        <Faq />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

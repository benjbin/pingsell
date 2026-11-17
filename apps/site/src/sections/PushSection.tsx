import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useInView, useReducedMotion, type Transition } from "motion/react";
import {
  Bell,
  Camera,
  ChartColumn,
  Check,
  ChevronDown,
  Clock,
  Flashlight,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Megaphone,
  Package,
  Shirt,
  ShoppingCart,
  Signal,
  Users,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import { API_URL } from "../content";
import { Line } from "./ApiSection";

type OS = "ios" | "android";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const DROP: Transition = { type: "spring", stiffness: 380, damping: 26, mass: 0.9 };
const MORPH: Transition = { type: "spring", stiffness: 300, damping: 32 };
const FLOAT_Y = { y: [0, -8, 0] };

/** Fictional shop used in the mock lock screen. */
const NOTIFS = [
  {
    id: "cart",
    icon: Shirt,
    thumb: "from-[#c9b8a3] to-[#8a6f55]",
    title: "Vous avez oublié quelque chose ?",
    body: "Votre pull en mérinos vous attend. Plus que 2 en taille M.",
  },
  {
    id: "flash",
    icon: Zap,
    thumb: "from-[#ffcf4d] to-[#f08a00]",
    title: "Vente flash : -30 % sur l'hiver",
    body: "Fin dans {t}. Les manteaux partent vite.",
  },
  {
    id: "ship",
    icon: Package,
    thumb: "from-[#85a8ff] to-[#145cff]",
    title: "Votre commande est en route",
    body: "Colis AN-20418 expédié, livraison prévue jeudi.",
  },
] as const;

const PROVIDERS = [
  ["Firebase Cloud Messaging", "Android et iOS"],
  ["APNs", "Apple Push Notification service"],
  ["Expo", "Expo Push"],
] as const;

const FEATURES = [
  {
    icon: Megaphone,
    title: "Écran verrouillé et dans l'app",
    text: "Sur l'écran verrouillé avec son et badge, et en même temps dans le centre de notifications de votre app. Un lien ouvre la bonne page ; segment, tag ou toute la base, avec test avant envoi.",
  },
  {
    icon: Workflow,
    title: "Dans vos automatisations",
    text: "Une étape « Notification push » se place entre vos emails, dans les mêmes scénarios.",
  },
  {
    icon: ChartColumn,
    title: "Statistiques",
    text: "Envoyées, ouvertures et lectures dans l'app. Un SDK React Native / Expo prêt à intégrer, et des jetons invalides nettoyés tout seuls.",
  },
] as const;

const SCENARIO = [
  { icon: ShoppingCart, label: "Panier abandonné", sub: "Déclencheur" },
  { icon: Clock, label: "Attendre 1 h", sub: "Délai" },
  { icon: Bell, label: "Notification push", sub: "« Vous avez oublié quelque chose ? »" },
  { icon: Clock, label: "Attendre 24 h", sub: "Délai" },
  { icon: Mail, label: "Email de relance", sub: "Avec le contenu du panier" },
] as const;

const SNIPPET = `// Dans votre app, une fois le jeton push obtenu
await fetch("${API_URL}/push/app/devices", {
  method: "POST",
  headers: {
    Authorization: "Bearer msvapp_••••••••",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    token: pushToken,
    platform: Platform.OS, // "ios" | "android"
    email: "camille@exemple.fr",
  }),
});`;

const COUNTDOWN_START = 1 * 3600 + 59 * 60 + 59;
const fmt = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");

/** Drops the notifications one by one, holds, clears, repeats. Paused while off screen. */
function useNotifLoop(active: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const delay = count === 0 ? 900 : count < NOTIFS.length ? 1900 : 4200;
    const id = window.setTimeout(() => setCount((c) => (c < NOTIFS.length ? c + 1 : 0)), delay);
    return () => window.clearTimeout(id);
  }, [active, count]);
  return count;
}

function useCountdown(active: boolean) {
  const [left, setLeft] = useState(COUNTDOWN_START);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setLeft((s) => (s > 0 ? s - 1 : COUNTDOWN_START)), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return left;
}

/** « Vos clients, jusque sur leur écran d'accueil » : push notifications to the merchant's own iOS / Android app. */
export function PushSection() {
  const reduce = useReducedMotion() ?? false;
  const [os, setOs] = useState<OS>("ios");
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.3 });
  const loop = inView && !reduce;
  const count = useNotifLoop(loop);
  const left = useCountdown(inView);
  const shown = reduce ? NOTIFS.length : count;

  return (
    <section id="push" className="relative isolate overflow-hidden bg-white py-24 lg:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(45%_40%_at_78%_30%,#dce6ff_0%,transparent_70%),radial-gradient(30%_30%_at_5%_90%,#eef3ff_0%,transparent_70%)]" />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(#c3cddf 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            maskImage: "radial-gradient(50% 45% at 75% 35%, black, transparent 75%)",
            WebkitMaskImage: "radial-gradient(50% 45% at 75% 35%, black, transparent 75%)",
          }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:gap-10">
        {/* Copy */}
        <div className="min-w-0">
          <div className="reveal">
            <p className="eyebrow flex items-center gap-2">
              <span className="relative flex size-1.5">
                {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/60" />}
                <span className="relative size-1.5 rounded-full bg-brand-500" />
              </span>
              Notifications push
            </p>
            <h2 className="display mt-4 text-[38px] leading-[0.92] sm:text-[52px]">
              Vos clients, jusque sur <em className="text-brand-500">leur écran d'accueil.</em>
            </h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-slate-600">
              Vous avez votre propre app iOS ou Android ? Connectez-la à Missive et envoyez-lui des notifications push depuis le même endroit que vos emails : mêmes
              contacts, mêmes segments, mêmes automatisations.
            </p>
          </div>

          <ul className="mt-9 space-y-5">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="reveal flex gap-4" style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                  <f.icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-[17px] font-bold">{f.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="reveal mt-9">
            <p className="text-[13px] text-slate-500">Compatible avec :</p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {PROVIDERS.map(([name, sub]) => (
                <li key={name} title={sub} className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-900 shadow-sm ring-1 ring-slate-900/10">
                  <span className="size-1.5 rounded-full bg-brand-500" /> {name}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
              App native, React Native, Flutter ou Expo : si votre app sait obtenir un jeton push, elle se branche.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white">
              <Check className="size-3.5 text-brand-300" /> Inclus en Pro et Business
            </p>
          </div>
        </div>

        {/* Stage */}
        <div ref={stageRef} className="relative mx-auto flex w-full min-w-0 flex-col items-center">
          <OsToggle os={os} setOs={setOs} reduce={reduce} />
          <div className="relative mt-6">
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 40, rotate: -4, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 1, ease: EASE }}
            >
              <Phone os={os} shown={shown} left={left} reduce={reduce} />
            </motion.div>

            {/* Floating callouts (desktop only, inside the stage bounds) */}
            <motion.div
              aria-hidden
              className="absolute top-[19%] -left-[140px] z-10 hidden w-[164px] rounded-2xl bg-white p-3 shadow-[0_20px_50px_-20px_rgba(7,23,51,0.35)] ring-1 ring-slate-900/[0.07] xl:block"
              animate={loop ? FLOAT_Y : undefined}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                <Link2 className="size-3 text-brand-500" /> Lien profond
              </p>
              <p className="mt-1.5 font-mono text-[10.5px] whitespace-nowrap text-slate-900">atelier-nord://panier</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">Ouvre directement le panier dans l'app.</p>
            </motion.div>
            <motion.div
              aria-hidden
              className="absolute bottom-[3%] -right-[124px] z-10 hidden w-[150px] rounded-2xl bg-white p-3 shadow-[0_20px_50px_-20px_rgba(7,23,51,0.35)] ring-1 ring-slate-900/[0.07] xl:block"
              animate={loop ? FLOAT_Y : undefined}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                <Users className="size-3 text-brand-500" /> Audience
              </p>
              <p className="mt-1.5 text-[12px] font-semibold text-slate-900">Tag « client-vip »</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">Ou tous les utilisateurs de l'app, ou un segment.</p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scenario + integration */}
      <div className="mx-auto mt-20 grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <Scenario reduce={reduce} />
        <CodeCard reduce={reduce} />
      </div>
    </section>
  );
}

function OsToggle({ os, setOs, reduce }: { os: OS; setOs: (o: OS) => void; reduce: boolean }) {
  return (
    <div role="group" aria-label="Aperçu" className="flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-900/[0.06]">
      {(
        [
          ["ios", "iPhone"],
          ["android", "Android"],
        ] as const
      ).map(([k, label]) => {
        const on = os === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => setOs(k)}
            className={`relative rounded-full px-4 py-1.5 font-display text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "text-white" : "text-slate-600 hover:text-slate-900"}`}
          >
            {on && (
              <motion.span
                layoutId="push-os"
                className="absolute inset-0 rounded-full bg-slate-900"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const WALL: Record<OS, string> = {
  ios: "radial-gradient(120% 70% at 15% 0%, #4d82ff 0%, transparent 55%), radial-gradient(90% 60% at 100% 100%, rgba(245,179,1,0.55) 0%, transparent 60%), linear-gradient(180deg, #0a3fcc 0%, #071733 100%)",
  android:
    "radial-gradient(100% 60% at 85% 5%, #85a8ff 0%, transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(16,185,129,0.55) 0%, transparent 60%), linear-gradient(180deg, #142a55 0%, #071733 100%)",
};

function Phone({ os, shown, left, reduce }: { os: OS; shown: number; left: number; reduce: boolean }) {
  const ios = os === "ios";
  const t = reduce ? { duration: 0 } : MORPH;
  const list = NOTIFS.slice(0, shown).reverse();
  return (
    <motion.div
      className="relative h-[560px] w-[272px] bg-slate-950 p-[9px] shadow-[0_50px_100px_-40px_rgba(7,23,51,0.75),inset_0_0_0_1.5px_rgba(255,255,255,0.08)] sm:h-[600px] sm:w-[292px]"
      initial={false}
      animate={{ borderRadius: ios ? 50 : 38 }}
      transition={t}
      role="img"
      aria-label="Écran verrouillé d'un téléphone recevant des notifications de la boutique Atelier Nord"
    >
      <motion.div className="relative h-full w-full overflow-hidden" initial={false} animate={{ borderRadius: ios ? 42 : 30 }} transition={t}>
        {(["ios", "android"] as const).map((k) => (
          <motion.div
            key={k}
            className="absolute inset-0"
            style={{ backgroundImage: WALL[k] }}
            initial={false}
            animate={{ opacity: os === k ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.6 }}
          />
        ))}

        {/* Status bar */}
        <div className="relative flex h-11 items-center justify-between px-6 text-[11px] font-semibold text-white">
          <span className={ios ? "opacity-0" : ""}>09:41</span>
          <motion.span
            className="absolute top-[10px] left-1/2 -translate-x-1/2 bg-black"
            initial={false}
            animate={ios ? { width: 88, height: 26, borderRadius: 14 } : { width: 12, height: 12, borderRadius: 6, y: 4 }}
            transition={t}
          />
          <span className="flex items-center gap-1">
            <Signal className="size-3" strokeWidth={2.5} />
            <Wifi className="size-3" strokeWidth={2.5} />
            <span className="ml-0.5 h-[9px] w-[18px] rounded-[3px] p-px ring-1 ring-white/70">
              <span className="block h-full w-3/4 rounded-[1.5px] bg-white" />
            </span>
          </span>
        </div>

        {/* Clock */}
        <div className="relative h-[132px] text-center text-white">
          <AnimatePresence initial={false} mode="wait">
            {ios ? (
              <motion.div key="ios" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: reduce ? 0 : 0.25 }}>
                <Lock className="mx-auto size-3.5 text-white/80" strokeWidth={2.5} />
                <p className="mt-2 text-[13px] font-semibold text-white/85">mardi 17 novembre</p>
                <p className="font-display text-[76px] leading-[0.95] font-semibold tracking-[-0.03em]">9:41</p>
              </motion.div>
            ) : (
              <motion.div key="android" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: reduce ? 0 : 0.25 }}>
                <p className="pt-1 font-sans text-[62px] leading-[0.86] font-light tracking-[-0.02em]">
                  09
                  <br />
                  <span className="text-brand-200">41</span>
                </p>
                <p className="mt-2 text-[12px] font-medium text-white/80">mar. 17 nov.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notifications */}
        <LayoutGroup>
          <div className="relative mt-3 flex flex-col gap-2 px-2.5" aria-live="off">
            <AnimatePresence initial={false} mode="popLayout">
              {list.map((n) => (
                <motion.div
                  key={n.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -60, scale: 0.9 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    borderRadius: ios ? 20 : 24,
                    backgroundColor: ios ? "rgba(255,255,255,0.66)" : "rgba(238,241,250,0.96)",
                  }}
                  exit={{ opacity: 0, scale: 0.92, y: -10, transition: { duration: 0.28, ease: EASE } }}
                  transition={reduce ? { duration: 0 } : DROP}
                  className="overflow-hidden shadow-[0_8px_24px_-12px_rgba(7,23,51,0.5)] backdrop-blur-xl"
                >
                  <NotifBody n={n} os={os} left={left} reduce={reduce} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>

        {/* Bottom */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-2">
          <AnimatePresence initial={false}>
            {ios && (
              <motion.div
                key="quick"
                className="mb-4 flex w-full justify-between px-9"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: reduce ? 0 : 0.25 }}
              >
                {[Flashlight, Camera].map((I, i) => (
                  <span key={i} className="flex size-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-md">
                    <I className="size-4" strokeWidth={2} />
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.span className="block h-[5px] rounded-full bg-white/85" initial={false} animate={{ width: ios ? 112 : 84, height: ios ? 5 : 4 }} transition={t} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function NotifBody({ n, os, left, reduce }: { n: (typeof NOTIFS)[number]; os: OS; left: number; reduce: boolean }) {
  const body = n.body.includes("{t}") ? n.body.replace("{t}", fmt(left)) : n.body;
  const pos = reduce ? false : ("position" as const);
  const icon = (
    <motion.span
      layout={pos}
      layoutId={reduce ? undefined : `push-icon-${n.id}`}
      className={`flex shrink-0 items-center justify-center bg-slate-950 font-display font-extrabold text-white ${os === "ios" ? "size-[34px] rounded-[9px] text-[13px]" : "size-[18px] rounded-full text-[8px]"}`}
    >
      N
    </motion.span>
  );
  const thumb = (
    <motion.span
      layout={pos}
      layoutId={reduce ? undefined : `push-thumb-${n.id}`}
      className={`flex shrink-0 items-center justify-center bg-gradient-to-br text-white ${n.thumb} ${os === "ios" ? "size-[38px] rounded-[8px]" : "size-[42px] rounded-[12px]"}`}
    >
      <n.icon className="size-4" strokeWidth={2} />
    </motion.span>
  );
  const time = n.id === "cart" ? "il y a 2 min" : n.id === "flash" ? "il y a 1 min" : "maintenant";

  if (os === "ios") {
    return (
      <div className="flex items-center gap-2.5 p-2.5">
        {icon}
        <motion.div layout={pos} className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-tight font-bold text-slate-950">{n.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-800 tabular-nums">{body}</p>
        </motion.div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-stretch">
          <span className="text-[9.5px] whitespace-nowrap text-slate-600">{time.replace("il y a ", "")}</span>
          {thumb}
        </div>
      </div>
    );
  }
  return (
    <div className="p-3">
      <motion.div layout={pos} className="flex items-center gap-1.5 text-[10px] text-slate-600">
        {icon}
        <span className="font-semibold text-slate-800">Atelier Nord</span>
        <span>·</span>
        <span>{time.replace("il y a ", "")}</span>
        <ChevronDown className="ml-auto size-3.5" />
      </motion.div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <motion.div layout={pos} className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-tight font-semibold text-[#1b1b1f]">{n.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-600 tabular-nums">{body}</p>
        </motion.div>
        {thumb}
      </div>
    </div>
  );
}

function Scenario({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % (SCENARIO.length + 2)), step >= SCENARIO.length - 1 ? 1600 : 1100);
    return () => window.clearTimeout(id);
  }, [inView, reduce, step]);
  const active = reduce ? SCENARIO.length - 1 : Math.min(step, SCENARIO.length - 1);

  return (
    <div ref={ref} className="reveal flex min-w-0 flex-col rounded-[28px] bg-slate-50 p-6 ring-1 ring-slate-900/[0.06] sm:p-8">
      <p className="eyebrow">Exemple de scénario</p>
      <h3 className="display mt-3 text-[28px] leading-[0.95] sm:text-[32px]">
        Push d'abord, <em className="text-brand-500">email ensuite.</em>
      </h3>

      <ol className="relative mt-7 space-y-3">
        <span aria-hidden className="absolute top-5 bottom-5 left-5 w-px bg-slate-900/10" />
        <motion.span
          aria-hidden
          className="absolute top-5 left-5 w-px origin-top bg-brand-500"
          style={{ height: "calc(100% - 40px)" }}
          initial={false}
          animate={{ scaleY: active / (SCENARIO.length - 1) }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 22 }}
        />
        {SCENARIO.map((s, i) => {
          const done = i <= active;
          const now = i === active && !reduce;
          const push = s.icon === Bell;
          return (
            <li key={i} className="relative flex items-center gap-3.5">
              <motion.span
                className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300 ${
                  done ? (push ? "bg-brand-500 text-white ring-brand-500" : "bg-slate-900 text-white ring-slate-900") : "bg-white text-slate-400 ring-slate-900/10"
                }`}
                animate={now ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <s.icon className="size-4" strokeWidth={1.9} />
                {now && push && <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/40" />}
              </motion.span>
              <div
                className={`min-w-0 flex-1 rounded-2xl px-4 py-2.5 transition-all duration-300 ${
                  push ? "bg-white shadow-sm ring-1 ring-brand-200" : "ring-1 ring-transparent"
                } ${done ? "opacity-100" : "opacity-55"}`}
              >
                <p className="flex items-center gap-2 font-display text-[15px] font-bold">
                  {s.label}
                  {push && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-sans text-[10px] font-semibold text-brand-600">Nouveau</span>}
                </p>
                <p className="truncate text-[12.5px] text-slate-500">{s.sub}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-7 grid grid-cols-3 gap-2 border-t border-slate-900/[0.07] pt-6">
        {[
          ["Envoyées", "1 240"],
          ["Échecs", "12"],
          ["Ouvertures", "318"],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-900/[0.06]">
            <p className="truncate text-[11px] text-slate-500">{k}</p>
            <p className="font-display text-lg font-extrabold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-slate-500">Exemple de statistiques d'une notification. Les jetons invalides sont retirés tout seuls.</p>
    </div>
  );
}

function CodeCard({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const shown = reduce || inView;
  const lines = SNIPPET.split("\n");
  return (
    <div ref={ref} className="flex min-w-0 flex-col overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-[0_40px_100px_-50px_rgba(20,92,255,0.8)] ring-1 ring-white/10">
      <div className="p-6 pb-0 sm:p-8 sm:pb-0">
        <p className="eyebrow !text-brand-300">Branchez votre app</p>
        <h3 className="display mt-3 text-[28px] leading-[0.95] sm:text-[32px]">
          Un appel, <em className="text-brand-400">et l'appareil est relié.</em>
        </h3>
        <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-white/65">
          Votre app enregistre le jeton push avec une clé publique d'app, faite pour être intégrée à l'app. L'email relie l'appareil au contact existant.
        </p>
      </div>

      <div className="mx-4 mt-6 min-w-0 overflow-hidden rounded-[18px] bg-[#0a1630] ring-1 ring-white/10 sm:mx-6">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-2.5">
          <span className="hidden gap-1.5 sm:flex">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
          </span>
          <span className="truncate font-mono text-[10px] text-white/40">POST /push/app/devices</span>
        </div>
        <div className="overflow-x-auto px-4 py-4">
          <pre className="font-mono text-[11px] leading-[1.75] text-white/85 sm:text-[12px]">
            {lines.map((l, i) => (
              <motion.span
                key={i}
                className="block whitespace-pre"
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={shown ? { opacity: 1, x: 0 } : undefined}
                transition={{ duration: 0.35, delay: reduce ? 0 : 0.2 + i * 0.045, ease: EASE }}
              >
                <span className="mr-4 inline-block w-4 text-right text-white/20 select-none">{i + 1}</span>
                <Line text={l} />
              </motion.span>
            ))}
          </pre>
        </div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={shown ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: reduce ? 0 : 0.25 + lines.length * 0.045, ease: EASE }}
          className="border-t border-white/[0.07] bg-white/[0.03] px-4 py-3"
        >
          <p className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-semibold text-emerald-300">201 Created</span>
            <span className="text-white/60">Appareil relié à camille@exemple.fr</span>
          </p>
        </motion.div>
      </div>

      <ul className="mt-auto space-y-2.5 p-6 text-[13.5px] text-white/75 sm:p-8">
        <li className="flex items-start gap-2.5">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-brand-400" strokeWidth={1.75} />
          <span>
            Clé <code className="font-mono text-[12px] text-brand-300">msvapp_</code> publique dans l'app ; vos clés secrètes{" "}
            <code className="font-mono text-[12px] text-brand-300">msv_</code> peuvent aussi enregistrer des appareils depuis votre back-office.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Check className="mt-0.5 size-4 shrink-0 text-brand-400" strokeWidth={1.75} />
          <span>Firebase Cloud Messaging (Android et iOS), APNs et Expo.</span>
        </li>
      </ul>
    </div>
  );
}

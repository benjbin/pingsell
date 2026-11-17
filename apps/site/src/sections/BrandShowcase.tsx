import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { BLOCKS } from "../content";
import { B_EMAILS } from "./b-emails";
import { useFinePointer } from "./motion-kit";

const CARD_NAMES = ["Maison Brume", "Atelier Nord", "Ferme Colibri", "Pétale Labo"];
const CYCLE_MS = 3000;

/** Resting fan: x offset, rotation (pivot below the cards), depth, scroll drift. */
const FAN = [
  { x: -118, r: -13, z: 0, dy: 90 },
  { x: -40, r: -4.5, z: 30, dy: 30 },
  { x: 40, r: 4.5, z: 60, dy: 30 },
  { x: 118, r: 13, z: 90, dy: 90 },
];

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.03 0 0 0 0 0.09 0 0 0 0 0.2 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const BRAND_LINES = [
  "Mode, serif élégant et grandes photos.",
  "Soldes avec code promo et compte à rebours.",
  "Épicerie fine, relance de panier abandonné.",
  "Cosmétique, remerciement et code fidélité.",
];

/** "Un email pour chaque boutique": 3D fan of example emails, cycling (or picked) one by one. */
export function BrandShowcase() {
  const reduced = useReducedMotion() ?? false;
  const fine = useFinePointer();
  const interactive = fine && !reduced;
  const section = useRef<HTMLElement>(null);
  const seen = useInView(section, { once: true, amount: 0.25 });

  const [active, setActive] = useState(1);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (reduced || !auto || !seen) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % B_EMAILS.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [reduced, auto, seen]);

  const { scrollYProgress } = useScroll({ target: section, offset: ["start end", "end start"] });
  const still = useMotionValue(0);
  const spread = useTransform(scrollYProgress, [0.55, 1], [0, 0.8], { clamp: true });
  const progress = reduced ? still : spread;

  return (
    <section ref={section} className="relative isolate overflow-hidden bg-white">
      <Aura reduced={reduced} />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.18] mix-blend-multiply" style={{ backgroundImage: GRAIN }} />
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-32">
        <div>
          <p className="eyebrow">Exemples</p>
          <h2 className="display mt-4 text-[38px] leading-[0.92] sm:text-[52px]">
            Un email pour <em className="text-brand-500">chaque boutique.</em>
          </h2>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-slate-600">
            Mode, cosmétique, épicerie, déco : partez d'une page vierge ou d'un modèle, et faites-en votre style. Ici, quatre marques fictives.
          </p>
          <div role="group" aria-label="Exemples d'emails" className="mt-8 space-y-1.5">
            {CARD_NAMES.map((n, i) => {
              const on = active === i;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setAuto(false);
                    setActive(i);
                  }}
                  className={`relative flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {on && (
                    <motion.span
                      layoutId="b-brand"
                      className="absolute inset-0 -z-10 rounded-2xl bg-white shadow-[0_12px_30px_-14px_rgba(11,33,74,0.35)] ring-1 ring-slate-900/[0.07]"
                      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">0{i + 1}</span>
                  <span>
                    <span className="block font-display text-[15px] font-bold">{n}</span>
                    <span className="block text-[13px] text-slate-500">{BRAND_LINES[i]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-w-0">
          {seen ? (
            <CardStage active={active} reduced={reduced} interactive={interactive} progress={progress} />
          ) : (
            <div className="h-[300px] sm:h-[420px] lg:h-[470px]" />
          )}
        </div>
      </div>
      <BlockTicker />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Aura({ reduced }: { reduced: boolean }) {
  const loop = (d: number) => ({ duration: d, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fc_55%,#ffffff_100%)]" />
      <motion.div
        className="absolute top-[18%] right-[-20%] size-[70vw] max-w-[820px] min-w-[380px] rounded-full bg-[radial-gradient(circle,#b9cdff_0%,rgba(185,205,255,0)_68%)]"
        animate={reduced ? undefined : { x: [0, -60, 20], y: [0, 40, -20], scale: [1, 1.08, 0.96] }}
        transition={loop(14)}
      />
      <motion.div
        className="absolute top-[45%] right-[10%] size-[42vw] max-w-[520px] min-w-[260px] rounded-full bg-[radial-gradient(circle,rgba(77,130,255,0.35)_0%,rgba(77,130,255,0)_70%)]"
        animate={reduced ? undefined : { x: [0, 50, -30], y: [0, -30, 30] }}
        transition={loop(11)}
      />
      <motion.div
        className="absolute top-[30%] left-[30%] size-[34vw] max-w-[420px] min-w-[220px] rounded-full bg-[radial-gradient(circle,rgba(244,179,194,0.35)_0%,rgba(244,179,194,0)_70%)]"
        animate={reduced ? undefined : { x: [0, 70, 0], y: [0, 30, -40] }}
        transition={loop(17)}
      />
      {/* Hairline grid, editorial */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(11,33,74,0.045)_1px,transparent_1px)] bg-[size:calc(100%/6)_100%] [mask-image:linear-gradient(180deg,transparent,black_20%,black_70%,transparent)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CardStage({ active, reduced, interactive, progress }: { active: number; reduced: boolean; interactive: boolean; progress: MotionValue<number> }) {
  // Mouse tilt (whole viewport), spring-smoothed.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 70, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 70, damping: 18, mass: 0.6 });
  const rotateY = useTransform(sx, (v) => -12 + v * 22);
  const rotateX = useTransform(sy, (v) => 10 - v * 16);

  useEffect(() => {
    if (!interactive) {
      mx.set(0);
      my.set(0);
      return;
    }
    const on = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => window.removeEventListener("pointermove", on);
  }, [interactive, mx, my]);

  // Hover opens the fan a little.
  const hoverRaw = useMotionValue(0);
  const hover = useSpring(hoverRaw, { stiffness: 120, damping: 20 });

  // Entrance delays only apply once.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 1400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="relative h-[300px] [perspective:1400px] sm:h-[420px] lg:h-[470px]"
      onPointerEnter={(e) => interactive && e.pointerType === "mouse" && hoverRaw.set(1)}
      onPointerLeave={() => hoverRaw.set(0)}
    >
      {/* Rotating dashed ring + glow */}
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 size-[300px] -translate-x-1/2 -translate-y-1/2 sm:size-[420px] lg:size-[460px]">
        <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(20,92,255,0.22)_0%,rgba(20,92,255,0)_70%)] blur-2xl" />
        <motion.svg
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full text-slate-900/15"
          animate={reduced ? undefined : { rotate: 360 }}
          transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
        >
          <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="0.25" strokeDasharray="0.8 1.6" />
          <circle cx="50" cy="1" r="0.9" className="fill-brand-500" />
        </motion.svg>
      </div>

      <motion.div
        className="absolute top-[47%] left-1/2 h-[350px] w-[240px] -translate-x-1/2 -translate-y-1/2 scale-[0.66] sm:scale-[0.88] lg:scale-100"
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      >
        {B_EMAILS.map((Email, i) => (
          <FanCard key={i} i={i} active={active === i} entered={entered} reduced={reduced} hover={hover} progress={progress}>
            <Email />
          </FanCard>
        ))}

      </motion.div>
    </div>
  );
}

function FanCard({
  i,
  active,
  entered,
  reduced,
  hover,
  progress,
  children,
}: {
  i: number;
  active: boolean;
  entered: boolean;
  reduced: boolean;
  hover: MotionValue<number>;
  progress: MotionValue<number>;
  children: React.ReactNode;
}) {
  const f = FAN[i];
  const x = useTransform([hover, progress], ([h, s]: number[]) => f.x * (1 + 0.32 * h + 1.3 * s));
  const rotate = useTransform([hover, progress], ([h, s]: number[]) => f.r * (1 + 0.4 * h + 1.1 * s));
  const y = useTransform(progress, (s) => s * f.dy);

  const spring = { type: "spring" as const, stiffness: 110, damping: 17, mass: 0.9 };
  const delay = entered ? 0 : 0.35 + i * 0.1;

  return (
    <motion.div className="absolute inset-0" style={{ x, y, rotate, z: f.z, transformOrigin: "50% 125%", transformStyle: "preserve-3d" }}>
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
        initial={reduced ? false : { opacity: 0, y: 220, rotate: -f.r * 1.5, z: 0 }}
        animate={{ opacity: 1, y: active ? -30 : 0, rotate: 0, z: active ? 140 : 0, scale: active ? 1.05 : 1 }}
        transition={{ ...spring, delay, opacity: { duration: 0.5, delay } }}
      >
        <motion.div
          className="absolute inset-0"
          animate={reduced ? undefined : { y: [0, -7, 0] }}
          transition={{ duration: 4.8 + i * 0.7, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
        >
          {children}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[18px] ring-2 ring-brand-500"
            animate={{ opacity: active ? 1 : 0 }}
            transition={{ duration: 0.4 }}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

function BlockTicker() {
  const items = [...BLOCKS, ...BLOCKS];
  return (
    <div className="relative border-y border-slate-900/[0.07] bg-white/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center">
        <p className="relative z-10 hidden shrink-0 border-r border-slate-900/[0.07] bg-white px-6 py-3.5 font-mono text-[10px] tracking-[0.18em] text-slate-500 uppercase sm:block lg:px-8">
          {BLOCKS.length} blocs
        </p>
        <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <ul className="marquee flex w-max items-center gap-6 py-3.5 pr-6" aria-label="Blocs de l'éditeur">
            {items.map((b, i) => (
              <li key={i} aria-hidden={i >= BLOCKS.length} className="flex items-center gap-6 font-display text-[13px] font-bold tracking-tight whitespace-nowrap text-slate-700 uppercase">
                {b}
                <span className="size-1 rounded-full bg-brand-500" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

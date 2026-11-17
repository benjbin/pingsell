import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import {
  Check,
  Eye,
  Image as ImageIcon,
  LayoutGrid,
  MousePointerClick,
  Send,
  ShoppingBag,
  TextAlignStart,
  Ticket,
  Timer,
  Type,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

type Kind = "idle" | "go" | "grab" | "carry" | "drop" | "palette" | "pick" | "picked" | "toSend" | "press" | "fly" | "sent" | "results" | "reset";
type Step = { k: Kind; i?: number; d: number };

/** The stage is drawn at a fixed design size, then scaled to fit its container. */
const W = 520;
const H = 460;

const PALETTE = [
  { label: "Titre", icon: Type },
  { label: "Bannière", icon: ImageIcon },
  { label: "Texte", icon: TextAlignStart },
  { label: "Code promo", icon: Ticket },
  { label: "Compte à rebours", icon: Timer },
  { label: "Bouton", icon: MousePointerClick },
  { label: "Produit", icon: ShoppingBag },
  { label: "Galerie", icon: LayoutGrid },
];
const itemTop = (idx: number) => 80 + idx * 36;

/** Email card geometry (stage coordinates). */
const CARD_X = 188;
const CARD_Y = 64;
const CARD_W = 272;
const SLOTS = [
  { top: 40, h: 110 }, // bannière
  { top: 150, h: 46 }, // texte
  { top: 196, h: 60 }, // code promo
  { top: 256, h: 50 }, // compte à rebours
  { top: 306, h: 50 }, // bouton
];
/** Which palette entry each slot is dragged from. */
const DRAG_FROM = [1, 2, 3, 4, 5];

const STEPS: Step[] = [{ k: "idle", d: 1000 }];
DRAG_FROM.forEach((_, i) => {
  const fast = i > 1;
  STEPS.push(
    { k: "go", i, d: fast ? 480 : 620 },
    { k: "grab", i, d: 200 },
    { k: "carry", i, d: fast ? 560 : 680 },
    { k: "drop", i, d: i === 0 ? 1350 : 330 },
  );
});
STEPS.push(
  { k: "palette", d: 700 },
  { k: "pick", d: 180 },
  { k: "picked", d: 900 },
  { k: "toSend", d: 650 },
  { k: "press", d: 200 },
  { k: "fly", d: 750 },
  { k: "sent", d: 550 },
  { k: "results", d: 3600 },
  { k: "reset", d: 650 },
);

const at = (k: Kind, i?: number) => STEPS.findIndex((s) => s.k === k && (i === undefined || s.i === i));
const IDX = {
  palette: at("palette"),
  pick: at("pick"),
  picked: at("picked"),
  toSend: at("toSend"),
  press: at("press"),
  fly: at("fly"),
  sent: at("sent"),
  results: at("results"),
  reset: at("reset"),
};

/** 0 = compose, 1 = send, 2 = sell — used by the headline. */
export function phaseOf(step: number): 0 | 1 | 2 {
  if (step >= IDX.results && step < IDX.reset) return 2;
  if (step >= IDX.toSend && step < IDX.results) return 1;
  return 0;
}

/** Drives the loop with chained timeouts, only while `active` (in view, motion allowed). */
export function useHeroTimeline(active: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEPS[step].d);
    return () => window.clearTimeout(t);
  }, [step, active]);
  return step;
}

/** The final, fully composed state, shown when motion is reduced. */
export const STATIC_STEP = IDX.picked;

const BRAND = "#ff5a36"; // the merchant's colour, picked in the demo
const EASE = [0.65, 0, 0.35, 1] as const;
const SPRING = { type: "spring", stiffness: 420, damping: 30 } as const;

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

export function EditorStage({ step, reduce, onInView }: { step: number; reduce: boolean; onInView: (v: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const inView = useInView(boxRef, { amount: 0.2 });
  useEffect(() => onInView(inView), [inView, onInView]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s = reduce ? STATIC_STEP : step;
  const cur = STEPS[s];
  const animated = !reduce;

  const filled = (i: number) => s >= at("drop", i) && s < IDX.reset;
  const brand = s >= IDX.pick && s < IDX.reset;
  const cardGone = s >= IDX.fly;
  const sentLabel = s >= IDX.fly;
  const showPopover = animated && s >= IDX.palette && s < IDX.toSend;
  const showResults = animated && s === IDX.results;
  const showSentPill = animated && s >= IDX.sent && s < IDX.reset;
  const typing = animated && cur.k === "drop" && cur.i === 0;

  return (
    <div
      ref={boxRef}
      className="relative aspect-[520/460] w-full"
      role="img"
      aria-label="Démonstration de l'éditeur Pingsell : des blocs sont glissés dans un email, l'email prend les couleurs de la marque, puis il est envoyé et les premiers résultats apparaissent."
    >
      <div aria-hidden className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {/* Window */}
        <div className="absolute inset-0 overflow-hidden rounded-[22px] bg-white shadow-[0_50px_120px_-40px_rgba(11,33,74,0.55),0_0_0_1px_rgba(11,33,74,0.08)]">
          <TopBar pressed={cur.k === "press"} sent={sentLabel} pressKey={s === IDX.press} />

          {/* Palette */}
          <div className="absolute top-12 bottom-0 left-0 w-32 border-r border-slate-900/[0.07] bg-white">
            <p className="absolute top-[14px] left-3 font-display text-[9px] font-bold tracking-[0.2em] text-slate-400 uppercase">Blocs</p>
            {PALETTE.map((p, idx) => {
              const active = (cur.k === "go" || cur.k === "grab" || cur.k === "carry") && DRAG_FROM[cur.i ?? -1] === idx;
              return (
                <div key={p.label} className="absolute left-2.5 h-[30px] w-[108px]" style={{ top: itemTop(idx) - 48 }}>
                  <div className="absolute inset-0 flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 text-[10.5px] font-semibold text-slate-700">
                    <p.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{p.label}</span>
                  </div>
                  <motion.div
                    className="absolute inset-0 flex items-center gap-2 rounded-lg bg-brand-500 px-2.5 text-[10.5px] font-semibold text-white"
                    initial={false}
                    animate={{ opacity: active ? 1 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{p.label}</span>
                  </motion.div>
                </div>
              );
            })}
          </div>

          {/* Canvas */}
          <div className="absolute top-12 right-0 bottom-0 left-32 bg-slate-50" style={{ backgroundImage: "radial-gradient(#dde4f0 1px, transparent 1px)", backgroundSize: "14px 14px" }} />

          {/* Email card */}
          <motion.div
            className="absolute overflow-hidden rounded-xl bg-white shadow-[0_18px_40px_-18px_rgba(11,33,74,0.35)] ring-1 ring-slate-900/[0.06]"
            style={{ left: CARD_X, top: CARD_Y, width: CARD_W, height: 364 }}
            initial={false}
            animate={
              cardGone
                ? { x: [0, -8, 250], y: [0, 14, -330], scale: [1, 0.84, 0.3], rotate: [0, -3, 16], opacity: [1, 1, 0] }
                : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }
            }
            transition={
              cardGone
                ? { duration: 0.75, times: [0, 0.38, 1], ease: EASE }
                : { x: { duration: 0 }, y: { duration: 0 }, rotate: { duration: 0 }, scale: { type: "spring", stiffness: 260, damping: 24 }, opacity: { duration: 0.35 } }
            }
          >
            <p className="flex h-10 items-center justify-center font-display text-[12px] font-extrabold tracking-[0.04em] text-slate-900 uppercase">
              Atelier Nord
            </p>
            {SLOTS.map((slot, i) => (
              <Slot key={i} top={slot.top} h={slot.h} filled={filled(i)} target={cur.k === "carry" && cur.i === i} animated={animated}>
                {i === 0 && <Banner brand={brand} animated={animated} typing={typing} />}
                {i === 1 && <BodyText />}
                {i === 2 && <Promo brand={brand} />}
                {i === 3 && <Countdown brand={brand} />}
                {i === 4 && <CtaButton brand={brand} />}
              </Slot>
            ))}
            {/* Brand flash */}
            <motion.div
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(circle at 0% 100%, ${BRAND}55, transparent 70%)` }}
              initial={false}
              animate={{ opacity: s === IDX.pick ? 1 : 0 }}
              transition={{ duration: s === IDX.pick ? 0.15 : 0.9 }}
            />
          </motion.div>

          {/* Brand colour popover */}
          <AnimatePresence>{showPopover && <ColourPopover picked={s >= IDX.pick} key="pop" />}</AnimatePresence>

          {/* Results layer */}
          <motion.div className="pointer-events-none absolute inset-x-0 top-12 bottom-0 bg-white/70" initial={false} animate={{ opacity: showResults ? 1 : 0 }} transition={{ duration: 0.4 }} />
          <AnimatePresence>
            {showSentPill && (
              <motion.div
                key="sent"
                className="absolute flex items-center gap-2 rounded-full bg-slate-900 py-2 pr-4 pl-2 text-[11px] font-semibold text-white shadow-xl"
                style={{ left: 196, top: 92 }}
                initial={{ opacity: 0, y: 14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.3 } }}
                transition={SPRING}
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-emerald-400 text-slate-900">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                Envoyée à 8 412 contacts
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>{showResults && <Results key="res" />}</AnimatePresence>

          {/* Static extras for reduced motion */}
          {reduce && (
            <>
              <Notif left={10} top={302} w={196} icon={Eye} label="Ouvertures" tone="light">
                <Counter to={46.2} decimals={1} suffix=" %" play={false} final />
              </Notif>
              <Notif left={10} top={376} w={206} icon={ShoppingBag} label="Commande · Shopify" tone="dark">
                <Counter to={1240} prefix="+" suffix=" €" play={false} final />
              </Notif>
            </>
          )}
        </div>

        {/* Cursor (outside the window clip so it can travel over the edges) */}
        {animated && <Cursor step={cur} stepIdx={s} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function TopBar({ pressed, sent, pressKey }: { pressed: boolean; sent: boolean; pressKey: boolean }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-12 items-center gap-3 border-b border-slate-900/[0.07] px-4">
      <span className="flex gap-1.5">
        <span className="size-2.5 rounded-full bg-slate-200" />
        <span className="size-2.5 rounded-full bg-slate-200" />
        <span className="size-2.5 rounded-full bg-slate-200" />
      </span>
      <span className="font-display text-[11px] font-extrabold tracking-tight text-slate-900 uppercase">Soldes d'hiver</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500">Brouillon</span>
      <motion.span
        className="relative ml-auto flex h-7 w-[82px] items-center justify-center"
        animate={{ scale: pressed ? 0.9 : 1 }}
        transition={{ type: "spring", stiffness: 600, damping: 22 }}
      >
        <span className="absolute inset-0 rounded-full bg-brand-500 shadow-[0_8px_20px_-8px_rgba(20,92,255,0.8)]" />
        <motion.span className="absolute inset-0 rounded-full bg-emerald-500" initial={false} animate={{ opacity: sent ? 1 : 0 }} transition={{ duration: 0.3 }} />
        {pressKey && (
          <motion.span
            className="absolute inset-0 rounded-full ring-2 ring-brand-400"
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        )}
        <span className="relative grid font-display text-[10px] font-semibold text-white">
          <motion.span className="col-start-1 row-start-1 flex items-center gap-1" initial={false} animate={{ opacity: sent ? 0 : 1, y: sent ? -6 : 0 }}>
            <Send className="size-3" strokeWidth={2.2} /> Envoyer
          </motion.span>
          <motion.span className="col-start-1 row-start-1 flex items-center gap-1" initial={false} animate={{ opacity: sent ? 1 : 0, y: sent ? 0 : 6 }}>
            <Check className="size-3" strokeWidth={2.6} /> Envoyée
          </motion.span>
        </span>
      </motion.span>
    </div>
  );
}

function Slot({ top, h, filled, target, animated, children }: { top: number; h: number; filled: boolean; target: boolean; animated: boolean; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0" style={{ top, height: h }}>
      {/* Placeholder */}
      <motion.div
        className="absolute inset-x-3 inset-y-1.5 rounded-lg border-[1.5px] border-dashed border-slate-200"
        initial={false}
        animate={{ opacity: filled ? 0 : 1 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        className="absolute inset-x-3 inset-y-1.5 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-brand-500 bg-brand-500/[0.06] text-[9px] font-semibold text-brand-500"
        initial={false}
        animate={{ opacity: target && !filled ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      >
        Déposer ici
      </motion.div>
      <AnimatePresence>
        {filled && (
          <motion.div
            key="c"
            className="absolute inset-0"
            initial={animated ? { opacity: 0, scale: 0.92, y: -6 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Stacked neutral + brand layers, crossfaded by opacity only. */
function Tint({ brand, neutral, branded, className = "" }: { brand: boolean; neutral: string; branded: string; className?: string }) {
  return (
    <>
      <span className={`absolute inset-0 ${className}`} style={{ background: neutral }} />
      <motion.span className={`absolute inset-0 ${className}`} style={{ background: branded }} initial={false} animate={{ opacity: brand ? 1 : 0 }} transition={{ duration: 0.6 }} />
    </>
  );
}

const TITLE = ["-30 % sur", "tout l'hiver"];

function Banner({ brand, animated, typing }: { brand: boolean; animated: boolean; typing: boolean }) {
  let n = 0;
  return (
    <div className="absolute inset-x-3 inset-y-1.5 overflow-hidden rounded-lg">
      <Tint brand={brand} neutral="linear-gradient(135deg,#2e3f63,#66738f)" branded={`linear-gradient(135deg,#0b214a 0%,#7a2a3a 45%,${BRAND} 100%)`} />
      <div className="absolute -top-7 -right-7 size-24 rounded-full border-[12px] border-white/15" />
      <div className="absolute right-5 bottom-4 size-8 rounded-full bg-white/10" />
      <p className="absolute bottom-3.5 left-3.5 font-display text-[19px] leading-[0.95] font-extrabold text-white uppercase">
        {TITLE.map((line, li) => (
          <span key={li} className="block">
            {Array.from(line).map((ch, ci) => {
              const d = 0.3 + n++ * 0.045;
              return (
                <motion.span key={ci} initial={animated ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: d, duration: 0.01 }}>
                  {ch === " " ? " " : ch}
                </motion.span>
              );
            })}
            {li === 1 && typing && <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[1px] animate-pulse bg-white align-baseline" />}
          </span>
        ))}
      </p>
    </div>
  );
}

function BodyText() {
  return (
    <p className="absolute inset-x-4 inset-y-1.5 flex items-center text-[10px] leading-relaxed text-slate-600">
      <span>
        Bonjour <span className="rounded bg-brand-500/10 px-1 font-semibold text-brand-500">Prénom</span>, nos pièces d'hiver passent en soldes jusqu'à dimanche.
      </span>
    </p>
  );
}

function Promo({ brand }: { brand: boolean }) {
  return (
    <div className="absolute inset-x-4 inset-y-2 flex flex-col items-center justify-center rounded-lg">
      <span className="absolute inset-0 rounded-lg border-[1.5px] border-dashed border-slate-300" />
      <motion.span className="absolute inset-0 rounded-lg border-[1.5px] border-dashed" style={{ borderColor: BRAND, background: `${BRAND}0d` }} initial={false} animate={{ opacity: brand ? 1 : 0 }} transition={{ duration: 0.6 }} />
      <p className="relative text-[7.5px] tracking-[0.2em] text-slate-400 uppercase">Votre code</p>
      <p className="relative font-mono text-[15px] font-bold tracking-[0.14em] text-slate-900">HIVER30</p>
    </div>
  );
}

function Countdown({ brand }: { brand: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2">
      {["02", "14", "37"].map((v, i) => (
        <span key={i} className="relative w-11 overflow-hidden rounded-md py-1.5 text-center">
          <Tint brand={brand} neutral="#eef2f8" branded={`${BRAND}1f`} />
          <span className="relative block font-display text-[14px] leading-none font-extrabold text-slate-900">{v}</span>
          <span className="relative text-[6.5px] tracking-wider text-slate-500 uppercase">{["jours", "heures", "min"][i]}</span>
        </span>
      ))}
    </div>
  );
}

function CtaButton({ brand }: { brand: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="relative overflow-hidden rounded-full px-6 py-2.5 text-[10.5px] font-bold text-white">
        <Tint brand={brand} neutral="#2e3f63" branded={BRAND} />
        <span className="relative">J'en profite</span>
      </span>
    </div>
  );
}

const SWATCHES = ["#0b214a", "#145cff", BRAND, "#0f766e", "#f5b400"];

function ColourPopover({ picked }: { picked: boolean }) {
  return (
    <motion.div
      className="absolute rounded-xl bg-white p-3 shadow-[0_20px_40px_-16px_rgba(11,33,74,0.45)] ring-1 ring-slate-900/10"
      style={{ left: 10, top: 372, width: 166 }}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.2 } }}
      transition={SPRING}
    >
      <p className="font-display text-[8.5px] font-bold tracking-[0.18em] text-slate-900 uppercase">Couleur de marque</p>
      <div className="relative mt-2.5 flex gap-2">
        {SWATCHES.map((c) => (
          <span key={c} className="size-[22px] rounded-full ring-1 ring-slate-900/10" style={{ background: c }} />
        ))}
        <motion.span
          className="absolute top-[-3px] left-[-3px] size-7 rounded-full ring-2 ring-slate-900"
          initial={false}
          animate={{ x: picked ? 2 * 30 : 30 }}
          transition={SPRING}
        />
      </div>
    </motion.div>
  );
}

/** Swatch centre in stage coordinates (popover origin + padding + index * pitch). */
const swatch = (i: number) => [10 + 12 + 11 + i * 30, 372 + 12 + 14 + 10 + 11] as const;

function Cursor({ step, stepIdx }: { step: Step; stepIdx: number }) {
  const slotCenter = (i: number) => [CARD_X + CARD_W / 2 + 18, CARD_Y + SLOTS[i].top + SLOTS[i].h / 2] as const;
  let pos: readonly [number, number] = [430, 330];
  switch (step.k) {
    case "go":
    case "grab":
      pos = [84, itemTop(DRAG_FROM[step.i!]) + 15];
      break;
    case "carry":
    case "drop":
      pos = slotCenter(step.i!);
      break;
    case "palette":
    case "pick":
    case "picked":
      pos = swatch(2);
      break;
    case "toSend":
    case "press":
    case "fly":
    case "sent":
    case "results":
    case "reset":
      pos = [474, 28];
      break;
  }
  const moving = step.k === "go" || step.k === "carry" || step.k === "palette" || step.k === "toSend" || step.k === "idle";
  const pressed = step.k === "grab" || step.k === "carry" || step.k === "pick" || step.k === "press";
  const hidden = stepIdx >= IDX.sent;
  const carrying = step.k === "grab" || step.k === "carry";
  const block = step.i !== undefined ? PALETTE[DRAG_FROM[step.i]] : null;

  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 z-20"
      initial={{ x: 430, y: 330, opacity: 0 }}
      animate={{ x: pos[0], y: pos[1], opacity: hidden ? 0 : 1 }}
      transition={{
        x: { duration: moving ? (step.d / 1000) * 0.88 : 0.2, ease: EASE },
        y: { duration: moving ? (step.d / 1000) * 0.88 : 0.2, ease: EASE },
        opacity: { duration: 0.3 },
      }}
    >
      <AnimatePresence>
        {carrying && block && (
          <motion.div
            key={block.label}
            className="absolute top-2 left-3 flex h-[30px] items-center gap-2 rounded-lg bg-brand-500 px-2.5 text-[10.5px] font-semibold whitespace-nowrap text-white shadow-[0_16px_30px_-10px_rgba(20,92,255,0.7)]"
            initial={{ opacity: 0, scale: 0.9, rotate: 0 }}
            animate={{ opacity: 0.95, scale: 1.04, rotate: -4 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.18 } }}
            transition={SPRING}
          >
            <block.icon className="size-3.5" strokeWidth={1.75} />
            {block.label}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        className="relative -translate-x-[3px] -translate-y-[2px] drop-shadow-[0_3px_4px_rgba(7,23,51,0.35)]"
        style={{ originX: 0.15, originY: 0.1 }}
        animate={{ scale: pressed ? 0.84 : 1 }}
        transition={{ type: "spring", stiffness: 700, damping: 28 }}
      >
        <path d="M4 2.5 L4 19 L8.6 14.8 L11.6 21.5 L14.6 20.2 L11.7 13.6 L18 13.6 Z" fill="#0b214a" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      </motion.svg>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function Counter({ to, decimals = 0, prefix = "", suffix = "", delay = 0, play, final = false }: { to: number; decimals?: number; prefix?: string; suffix?: string; delay?: number; play: boolean; final?: boolean }) {
  const mv = useMotionValue(final ? to : 0);
  const text = useTransform(mv, (v) => prefix + v.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix);
  useEffect(() => {
    if (!play) return;
    const c = animate(mv, to, { duration: 1.3, delay, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [play, to, delay, mv]);
  return <motion.span>{text}</motion.span>;
}

function Notif({
  left,
  top,
  w,
  icon: Icon,
  label,
  tone,
  delay = 0,
  animated = false,
  children,
  extra,
}: {
  left: number;
  top: number;
  w: number;
  icon: typeof Eye;
  label: string;
  tone: "light" | "dark";
  delay?: number;
  animated?: boolean;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <motion.div
      className={`absolute z-10 rounded-2xl p-3 shadow-[0_24px_50px_-18px_rgba(7,23,51,0.55)] ${dark ? "bg-slate-900 text-white" : "bg-white text-slate-900 ring-1 ring-slate-900/[0.08]"}`}
      style={{ left, top, width: w }}
      initial={animated ? { opacity: 0, y: 22, scale: 0.86, filter: "blur(6px)" } : false}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 360, damping: 24, delay }}
    >
      <div className="flex items-center gap-2.5">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-emerald-400 text-slate-900" : "bg-brand-500/10 text-brand-500"}`}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className={`truncate text-[9.5px] font-medium ${dark ? "text-white/60" : "text-slate-500"}`}>{label}</p>
          <p className="font-display text-[20px] leading-none font-extrabold tracking-tight tabular-nums">{children}</p>
        </div>
      </div>
      {extra}
    </motion.div>
  );
}

function Results() {
  const bars = [30, 55, 42, 78, 64, 90, 70];
  return (
    <>
      <Notif left={142} top={160} w={196} icon={Eye} label="Ouvertures" tone="light" animated delay={0.05}>
        <Counter to={46.2} decimals={1} suffix=" %" delay={0.15} play />
      </Notif>
      <Notif
        left={300}
        top={238}
        w={200}
        icon={MousePointerClick}
        label="Clics sur « J'en profite »"
        tone="light"
        animated
        delay={0.45}
        extra={
          <div className="mt-2.5 flex h-6 items-end gap-1">
            {bars.map((b, i) => (
              <motion.span
                key={i}
                className="flex-1 origin-bottom rounded-sm bg-brand-500"
                style={{ height: `${b}%` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: 0.6 + i * 0.06, type: "spring", stiffness: 300, damping: 20 }}
              />
            ))}
          </div>
        }
      >
        <Counter to={7.9} decimals={1} suffix=" %" delay={0.55} play />
      </Notif>
      <Notif left={150} top={334} w={232} icon={ShoppingBag} label="Nouvelles commandes · via Shopify" tone="dark" animated delay={0.9}>
        <Counter to={1240} prefix="+" suffix=" €" delay={1} play />
      </Notif>
    </>
  );
}

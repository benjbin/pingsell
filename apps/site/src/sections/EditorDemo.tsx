import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, type Transition, type Variants } from "motion/react";
import { ArrowRight, Check, Eye, Monitor, MousePointer2, MousePointerClick, RotateCcw, ShoppingBag, Smartphone } from "lucide-react";
import { BLOCKS, PRICING, SIGNUP_URL } from "../content";
import { EmailPreview } from "./c-email";
import { COLORS, FONTS, INITIAL, STEPS, THEMES, TYPES, alpha, byId, stepKey, tint, type DemoState, type Step } from "./c-tokens";

const EASE = [0.2, 0.8, 0.2, 1] as const;
// Hoisted so re-renders never restart the ambient loops.
const FLOAT_Y = { y: [0, -6, 0] };
const DRIFT_A = { x: [0, -60, 30, 0], y: [0, 40, -30, 0], scale: [1, 1.08, 0.96, 1] };
const DRIFT_B = { x: [0, 50, 0], y: [0, -30, 0] };

/** Fraunces and JetBrains Mono are only used by this demo: load them on demand. */
function useDemoFonts() {
  useEffect(() => {
    const id = "hero-c-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500..700;1,9..144,500..700&family=JetBrains+Mono:wght@500;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

type Register = (key: string) => (el: HTMLButtonElement | null) => void;

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function Pill({ id, spring, className }: { id: string; spring: Transition; className: string }) {
  return <motion.span layoutId={id} transition={spring} className={`absolute ${className}`} aria-hidden />;
}

function Group({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-2 flex items-baseline justify-between gap-2 font-sans text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
        {label}
        <span className="truncate font-display text-[11px] font-bold tracking-normal text-slate-900 normal-case">{value}</span>
      </p>
      {children}
    </div>
  );
}

function ResultChip({
  icon: Icon,
  label,
  delay,
  reduce,
  color,
  beat,
}: {
  icon: typeof Eye;
  label: string;
  delay: number;
  reduce: boolean;
  color: string;
  beat: number;
}) {
  const bars = [0.45, 0.7, 0.55, 0.9, 0.75];
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, scale: 0.85, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { delay, type: "spring", stiffness: 260, damping: 22 }}
    >
      <motion.div
        animate={reduce ? undefined : FLOAT_Y}
        transition={{ duration: 4 + delay * 1.5, repeat: Infinity, ease: "easeInOut" }}
        className="flex items-center gap-2.5 rounded-2xl bg-white py-2 pr-3 pl-2 shadow-[0_18px_40px_-16px_rgba(7,23,51,0.45)] ring-1 ring-slate-900/[0.07]"
      >
        <span className="flex size-8 items-center justify-center rounded-xl transition-colors duration-500" style={{ background: tint(color, 0.88), color }}>
          <Icon className="size-4" strokeWidth={2} aria-hidden />
        </span>
        <span className="font-display text-[13px] font-bold whitespace-nowrap text-slate-900">{label}</span>
        <span className="flex h-6 items-end gap-[3px]" aria-hidden>
          {bars.map((h, i) => (
            <motion.span
              key={`${beat}-${i}`}
              className="w-[4px] origin-bottom rounded-full transition-colors duration-500"
              style={{ height: `${h * 100}%`, background: i === 3 ? color : alpha(color, 0.3) }}
              initial={reduce ? false : { scaleY: 0.15 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 18 }}
            />
          ))}
        </span>
      </motion.div>
    </motion.li>
  );
}

/** Interactive editor demo: the visitor restyles a live email (autoplays until they take over). */
export function EditorDemo() {
  useDemoFonts();
  const reduce = useReducedMotion() ?? false;
  const [s, setS] = useState<DemoState>(INITIAL);
  const [auto, setAuto] = useState(true);
  const [beat, setBeat] = useState(0);
  const [cursor, setCursor] = useState({ x: 0, y: 0, show: false, click: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const inView = useInView(cardRef, { amount: 0.15 });

  const color = byId(COLORS, s.color);
  const font = byId(FONTS, s.font);
  const theme = byId(THEMES, s.theme);

  useEffect(() => {
    if (reduce) setAuto(false);
  }, [reduce]);

  const apply = useCallback((step: Step) => {
    setS((prev) => ({ ...prev, [step.group]: step.value }));
    setBeat((b) => b + 1);
  }, []);

  /** A real visitor action: stop the demo and apply the change. */
  const pick = (step: Step) => {
    setAuto(false);
    setCursor((c) => ({ ...c, show: false }));
    apply(step);
  };

  const register: Register = (key) => (el) => {
    refs.current[key] = el;
  };

  // Autoplay: a ghost cursor travels to a control, "clicks" it, and the preview reacts.
  useEffect(() => {
    if (!auto || reduce || !inView) {
      setCursor((c) => ({ ...c, show: false }));
      return;
    }
    let i = 0;
    const timers: number[] = [];
    const run = () => {
      const step = STEPS[i % STEPS.length];
      const el = refs.current[stepKey(step)];
      const card = cardRef.current;
      if (el && card) {
        const r = el.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        setCursor((c) => ({ ...c, show: true, x: r.left - cr.left + r.width * 0.55, y: r.top - cr.top + r.height * 0.55 }));
      }
      timers.push(
        window.setTimeout(() => {
          apply(step);
          setCursor((c) => ({ ...c, click: c.click + 1 }));
          i += 1;
          timers.push(window.setTimeout(run, 1500));
        }, 800),
      );
    };
    timers.push(window.setTimeout(run, 1400));
    return () => timers.forEach(clearTimeout);
  }, [auto, reduce, inView, apply]);

  const spring: Transition = reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 36 };

  const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } };
  const item: Variants = {
    hidden: { opacity: 0, y: 22, filter: "blur(8px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.75, ease: EASE } },
  };
  const init = reduce ? false : "hidden";

  const chip = (active: boolean) =>
    `relative inline-flex items-center justify-center rounded-full transition-colors ${focusRing} ${active ? "text-white" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <section id="editeur" className="relative isolate overflow-hidden">
      {/* Ambient background: grid + glow tinted by the chosen brand colour */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(11,33,74,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(11,33,74,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(70%_60%_at_60%_30%,black,transparent)]" />
        <motion.div
          className="absolute top-[6%] right-[-10%] size-[520px] sm:size-[680px]"
          animate={reduce ? undefined : DRIFT_A}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="size-full rounded-full opacity-30 blur-[110px]"
            style={{ background: color.hex, transition: reduce ? undefined : "background-color 900ms ease" }}
          />
        </motion.div>
        <motion.div
          className="absolute top-[40%] left-[-15%] size-[420px] rounded-full bg-brand-200 opacity-40 blur-[100px]"
          animate={reduce ? undefined : DRIFT_B}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12 lg:py-32">
        {/* Copy */}
        <motion.div variants={container} initial={init} whileInView="show" viewport={{ once: true, amount: 0.3 }} className="min-w-0">
          <motion.p variants={item} className="eyebrow flex items-center gap-2">
            <span className="relative flex size-2">
              {!reduce && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color.hex }} />}
              <span className="relative size-2 rounded-full transition-colors duration-500" style={{ background: color.hex }} />
            </span>
            L'éditeur · essayez-le
          </motion.p>
          <h2 className="display mt-5 text-[46px] leading-[0.88] sm:text-[68px] lg:text-[68px] xl:text-[76px]">
            <motion.span variants={item} className="block">
              Des emails
            </motion.span>
            <motion.span variants={item} className="block">
              à votre
            </motion.span>
            <motion.span variants={item} className="block">
              <motion.em initial={false} animate={{ color: color.hex }} transition={{ duration: reduce ? 0 : 0.6 }}>
                image.
              </motion.em>
            </motion.span>
          </h2>
          <motion.p variants={item} className="mt-6 max-w-md text-[16px] leading-relaxed text-slate-600 sm:text-[17px]">
            Couleurs, typographies, {BLOCKS.length} blocs : chaque email prend l'allure de votre boutique.{" "}
            <span className="font-semibold text-slate-900">Essayez ici même, l'aperçu réagit en direct.</span>
          </motion.p>
          <motion.div variants={item} className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={SIGNUP_URL}
              className={`group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-6 font-display text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(20,92,255,0.7)] transition hover:bg-brand-600 ${focusRing}`}
            >
              Commencer gratuitement
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#tarifs"
              className={`inline-flex h-12 items-center justify-center rounded-full bg-white/60 px-6 font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15 transition hover:ring-slate-900/40 ${focusRing}`}
            >
              Voir les tarifs
            </a>
          </motion.div>
          <motion.ul variants={item} className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
            {[`${PRICING.freeEmails.toLocaleString("fr-FR")} emails offerts / mois`, "Sans carte bancaire"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-brand-500" /> {t}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Live demo */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, scale: 0.97 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={reduce ? { duration: 0 } : { delay: 0.35, duration: 0.9, ease: EASE }}
          className="relative min-w-0"
        >
          <div
            ref={cardRef}
            className="relative rounded-[26px] bg-white/85 shadow-[0_50px_120px_-45px_rgba(11,33,74,0.55)] ring-1 ring-slate-900/10 backdrop-blur-xl"
          >
            {/* Toolbar: email type + device */}
            <div className="flex items-center gap-2 border-b border-slate-900/[0.07] p-2.5 sm:gap-3 sm:p-3">
              <div role="group" aria-label="Type d'email" className="grid min-w-0 flex-1 grid-cols-3 rounded-full bg-slate-100 p-1 sm:flex sm:flex-none">
                {TYPES.map((t) => {
                  const active = s.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      ref={register(stepKey({ group: "type", value: t.id }))}
                      aria-pressed={active}
                      onClick={() => pick({ group: "type", value: t.id })}
                      className={`${chip(active)} h-8 min-w-0 px-2 text-[11.5px] font-semibold sm:px-3.5 sm:text-xs`}
                    >
                      {active && <Pill id="c-type" spring={spring} className="inset-0 rounded-full bg-slate-900 shadow-sm" />}
                      <span className="relative truncate">
                        <span className="sm:hidden">{t.short}</span>
                        <span className="hidden sm:inline">{t.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div role="group" aria-label="Largeur de l'aperçu" className="ml-auto flex shrink-0 rounded-full bg-slate-100 p-1">
                {(
                  [
                    ["ordinateur", Monitor, "Aperçu ordinateur"],
                    ["mobile", Smartphone, "Aperçu mobile"],
                  ] as const
                ).map(([d, Icon, label]) => {
                  const active = s.device === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      ref={register(stepKey({ group: "device", value: d }))}
                      aria-pressed={active}
                      aria-label={label}
                      title={label}
                      onClick={() => pick({ group: "device", value: d })}
                      className={`${chip(active)} size-8`}
                    >
                      {active && <Pill id="c-device" spring={spring} className="inset-0 rounded-full bg-slate-900 shadow-sm" />}
                      <Icon className="relative size-4" strokeWidth={2} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid lg:grid-cols-[1fr_196px]">
              {/* Stage */}
              <div
                className="relative h-[400px] overflow-hidden p-4 sm:h-[440px] sm:p-6 lg:h-[470px]"
                style={{ background: theme.canvas, transition: reduce ? undefined : "background-color 600ms ease" }}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-60"
                  style={{
                    backgroundImage: `radial-gradient(${theme.id === "sombre" ? "rgba(255,255,255,0.08)" : "rgba(11,33,74,0.10)"} 1px, transparent 1px)`,
                    backgroundSize: "14px 14px",
                  }}
                  aria-hidden
                />
                <div className="relative h-full" aria-live={auto ? "off" : "polite"}>
                  <span className="sr-only">
                    Aperçu : email {byId(TYPES, s.type).label}, couleur {color.label}, typographie {font.label}, thème {theme.label}, format {s.device}.
                  </span>
                  <div aria-hidden className="h-full">
                    <EmailPreview s={s} reduce={reduce} />
                  </div>
                </div>
              </div>

              {/* Inspector */}
              <div className="grid gap-5 border-t border-slate-900/[0.07] p-4 sm:grid-cols-[auto_1fr] sm:gap-x-6 lg:block lg:space-y-5 lg:border-t-0 lg:border-l">
                <Group label="Couleur" value={color.label}>
                  <div className="flex flex-wrap gap-2.5 lg:gap-2">
                    {COLORS.map((c) => {
                      const active = s.color === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          ref={register(stepKey({ group: "color", value: c.id }))}
                          aria-pressed={active}
                          aria-label={`Couleur ${c.label}`}
                          title={c.label}
                          onClick={() => pick({ group: "color", value: c.id })}
                          className={`relative size-8 rounded-full transition-transform hover:scale-110 lg:size-[26px] ${focusRing}`}
                        >
                          {active && <Pill id="c-color" spring={spring} className="-inset-[4px] rounded-full ring-2 ring-slate-900" />}
                          <span className="absolute inset-0 rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.18)]" style={{ background: c.hex }} />
                        </button>
                      );
                    })}
                  </div>
                </Group>

                <Group label="Typographie" value={font.label}>
                  <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-2">
                    {FONTS.map((f) => {
                      const active = s.font === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          ref={register(stepKey({ group: "font", value: f.id }))}
                          aria-pressed={active}
                          onClick={() => pick({ group: "font", value: f.id })}
                          className={`relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 ring-1 transition-colors ${focusRing} ${
                            active ? "text-white ring-transparent" : "text-slate-700 ring-slate-900/10 hover:ring-slate-900/30"
                          }`}
                        >
                          {active && <Pill id="c-font" spring={spring} className="inset-0 rounded-xl bg-slate-900" />}
                          <span
                            className="relative text-[18px] leading-none"
                            style={{ fontFamily: f.heading, fontWeight: f.weight, fontStyle: f.id === "fraunces" ? "italic" : "normal" }}
                            aria-hidden
                          >
                            Aa
                          </span>
                          <span className="relative text-[10px] font-semibold">{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </Group>

                <div className="sm:col-span-2 lg:col-span-1">
                  <Group label="Thème" value={theme.label}>
                    <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-1">
                      {THEMES.map((t) => {
                        const active = s.theme === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            ref={register(stepKey({ group: "theme", value: t.id }))}
                            aria-pressed={active}
                            onClick={() => pick({ group: "theme", value: t.id })}
                            className={`relative flex h-9 items-center justify-center gap-2 rounded-xl px-2.5 text-[12px] font-semibold ring-1 transition-colors lg:justify-start ${focusRing} ${
                              active ? "text-white ring-transparent" : "text-slate-700 ring-slate-900/10 hover:ring-slate-900/30"
                            }`}
                          >
                            {active && <Pill id="c-theme" spring={spring} className="inset-0 rounded-xl bg-slate-900" />}
                            <span className="relative size-3.5 shrink-0 rounded-full ring-1 ring-slate-900/20" style={{ background: t.swatch }} aria-hidden />
                            <span className="relative">{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </Group>
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex min-h-11 items-center gap-3 border-t border-slate-900/[0.07] px-4 py-2 text-[12px] text-slate-500 sm:pt-2.5 sm:pb-8">
              <AnimatePresence mode="wait" initial={false}>
                {auto ? (
                  <motion.p key="auto" className="flex min-w-0 items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inset-0 animate-ping rounded-full bg-brand-500 opacity-60" />
                      <span className="relative size-2 rounded-full bg-brand-500" />
                    </span>
                    <span className="truncate">
                      Démo en cours<span className="hidden sm:inline"> · touchez un réglage pour prendre la main</span>
                    </span>
                  </motion.p>
                ) : (
                  <motion.p
                    key="manual"
                    className="flex min-w-0 items-center gap-2"
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <Check className="size-3.5 shrink-0 text-brand-500" />
                    <span className="truncate">
                      <span className="sm:hidden">Votre style, réutilisé partout.</span>
                      <span className="hidden sm:inline">Dans Missive, votre style est enregistré une fois pour toutes vos campagnes.</span>
                    </span>
                  </motion.p>
                )}
              </AnimatePresence>
              {!auto && !reduce && (
                <button
                  type="button"
                  onClick={() => {
                    setS(INITIAL);
                    setAuto(true);
                  }}
                  className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-900/10 transition hover:text-slate-900 hover:ring-slate-900/30 ${focusRing}`}
                >
                  <RotateCcw className="size-3.5" /> Rejouer
                </button>
              )}
            </div>

            {/* Ghost cursor of the autoplay */}
            <motion.div
              className="pointer-events-none absolute top-0 left-0 z-30"
              initial={false}
              animate={{ x: cursor.x, y: cursor.y, opacity: cursor.show ? 1 : 0 }}
              transition={{ x: { type: "spring", stiffness: 90, damping: 17 }, y: { type: "spring", stiffness: 90, damping: 17 }, opacity: { duration: 0.3 } }}
              aria-hidden
            >
              <AnimatePresence>
                {cursor.click > 0 && (
                  <motion.span
                    key={cursor.click}
                    className="absolute -top-4 -left-4 size-8 rounded-full"
                    style={{ background: alpha(color.hex, 0.35) }}
                    initial={{ scale: 0.2, opacity: 0.9 }}
                    animate={{ scale: 1.6, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                )}
              </AnimatePresence>
              <motion.span
                key={`press-${cursor.click}`}
                className="block"
                initial={{ scale: 0.82 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 15 }}
              >
                <MousePointer2 className="size-6 -translate-x-1 -translate-y-1 fill-slate-900 text-white drop-shadow-[0_4px_8px_rgba(7,23,51,0.35)]" strokeWidth={1.5} />
              </motion.span>
            </motion.div>
          </div>

          {/* Product UI: what Missive tracks once the email is sent */}
          <ul aria-label="Suivi après l'envoi" className="relative z-20 -mt-6 hidden justify-center gap-3 sm:flex">
            <ResultChip icon={Eye} label="Ouvertures" delay={1.1} reduce={reduce} color={color.hex} beat={beat} />
            <ResultChip icon={MousePointerClick} label="Clics" delay={1.25} reduce={reduce} color={color.hex} beat={beat} />
            <ResultChip icon={ShoppingBag} label="CA Shopify" delay={1.4} reduce={reduce} color={color.hex} beat={beat} />
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

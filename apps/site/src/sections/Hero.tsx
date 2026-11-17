import { useCallback, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { PRICING, SIGNUP_URL } from "../content";
import { EditorStage, phaseOf, useHeroTimeline } from "./a-stage";

const WORDS = ["Composez.", "Envoyez.", "Vendez."];
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Hero A — « l'email se construit tout seul ».
 * The editor stage plays a loop (drag blocks → brand colour → send → results);
 * the headline word matching the current phase lights up in sync.
 */
export function Hero() {
  const reduce = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const onInView = useCallback((v: boolean) => setInView(v), []);
  const step = useHeroTimeline(inView && !reduce);
  const phase = reduce ? 2 : phaseOf(step);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, -110]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);
  const stageY = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const stageScale = useTransform(scrollYProgress, [0, 1], [1, 0.9]);
  const stageRotate = useTransform(scrollYProgress, [0, 1], [0, 8]);
  const stageOpacity = useTransform(scrollYProgress, [0.35, 0.9], [1, 0]);
  const glowY = useTransform(scrollYProgress, [0, 1], [0, 160]);

  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay, ease: EASE_OUT } };

  return (
    <section ref={sectionRef} id="top" className="relative overflow-hidden pt-[72px]">
      {/* Background */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={reduce ? undefined : { y: glowY }}>
        <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_75%_25%,#dce6ff_0%,transparent_70%),radial-gradient(35%_30%_at_10%_80%,#eef3ff_0%,transparent_70%)]" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: "linear-gradient(#dde4f0 1px, transparent 1px), linear-gradient(90deg, #dde4f0 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(60% 55% at 70% 35%, black, transparent 75%)",
            WebkitMaskImage: "radial-gradient(60% 55% at 70% 35%, black, transparent 75%)",
          }}
        />
      </motion.div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 sm:pt-14 lg:grid-cols-[1fr_1.12fr] lg:gap-10 lg:pt-20 lg:pb-24">
        {/* Copy */}
        <motion.div style={reduce ? undefined : { y: textY, opacity: textOpacity }} className="min-w-0">
          <motion.p {...enter(0)} className="eyebrow flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-brand-500" /> Emailing pour e-commerçants
          </motion.p>

          <h1 className="display mt-5 text-[52px] leading-[0.9] sm:text-[76px] lg:text-[80px]">
            {WORDS.map((w, i) => (
              <span key={w} className="block overflow-hidden pb-[0.04em]">
                <motion.span
                  className="relative inline-block"
                  initial={reduce ? false : { y: "105%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.9, delay: 0.1 + i * 0.12, ease: EASE_OUT }}
                >
                  <motion.span className="block text-slate-900" initial={false} animate={{ opacity: phase === i ? 0 : 1 }} transition={{ duration: 0.45 }}>
                    {w}
                  </motion.span>
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 text-brand-500"
                    initial={false}
                    animate={{ opacity: phase === i ? 1 : 0 }}
                    transition={{ duration: 0.45 }}
                  >
                    {w}
                  </motion.span>
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p {...enter(0.45)} className="mt-6 max-w-md text-[17px] leading-relaxed text-slate-600">
            Emails, notifications push et automatisations, branchés sur les outils que vous utilisez déjà : Shopify en un clic, votre site, votre CRM ou votre app en
            quelques lignes. Pingsell s'adapte à votre façon de travailler.
          </motion.p>

          <motion.div {...enter(0.55)} className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={SIGNUP_URL}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-6 font-display text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(20,92,255,0.7)] transition hover:bg-brand-600"
            >
              Commencer gratuitement
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#adapte"
              className="inline-flex h-12 items-center justify-center rounded-full px-6 font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15 transition hover:ring-slate-900/40"
            >
              Voir comment ça se branche
            </a>
          </motion.div>

          <motion.ul {...enter(0.65)} className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
            {[`${PRICING.freeEmails.toLocaleString("fr-FR")} emails offerts / mois`, "Sans carte bancaire", "Branché en quelques minutes"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-brand-500" /> {t}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Stage */}
        <motion.div
          className="relative mx-auto w-full max-w-[600px] min-w-0"
          style={reduce ? undefined : { y: stageY, opacity: stageOpacity }}
        >
          <motion.div style={reduce ? undefined : { scale: stageScale, rotateX: stageRotate, transformPerspective: 1400, transformOrigin: "50% 0%" }}>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 40, rotateX: 14, scale: 0.96, transformPerspective: 1400 }}
              animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
              transition={{ duration: 1.1, delay: 0.25, ease: EASE_OUT }}
            >
              <EditorStage step={step} reduce={reduce} onInView={onInView} />
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

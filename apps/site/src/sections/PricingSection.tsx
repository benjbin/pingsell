import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Minus } from "lucide-react";
import { PLAN_TABLE, PLANS, PRICING, SIGNUP_URL, VOLUMES, planPrice, type Plan, type Volume } from "../content";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0");
const short = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000} M` : `${n / 1000} k`);

/** Three SaaS plans with monthly / yearly billing and an email-volume picker for the paid plans. */
export function PricingSection() {
  const reduce = useReducedMotion() ?? false;
  const [yearly, setYearly] = useState(true);
  const [vi, setVi] = useState(1);
  const volume = VOLUMES[vi];
  const [open, setOpen] = useState(false);
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 34 };

  return (
    <section id="tarifs" className="relative isolate overflow-hidden py-24 lg:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(55%_60%_at_50%_0%,#dce6ff_0%,transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="reveal mx-auto max-w-2xl text-center">
          <p className="eyebrow">Tarifs</p>
          <h2 className="display mt-4 text-[38px] leading-[0.92] sm:text-[52px]">
            Une formule pour <em className="text-brand-500">chaque étape.</em>
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-slate-600">
            Commencez gratuitement, passez à la formule supérieure quand votre boutique grandit. Vos contacts restent illimités : seul le volume d'emails compte.
          </p>
        </div>

        {/* Controls */}
        <div className="reveal mt-10 flex flex-col items-center gap-5">
          <div role="group" aria-label="Facturation" className="flex rounded-full bg-slate-100 p-1 ring-1 ring-slate-900/[0.06]">
            {[
              [false, "Mensuel"],
              [true, "Annuel"],
            ].map(([y, label]) => {
              const on = yearly === y;
              return (
                <button
                  key={label as string}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setYearly(y as boolean)}
                  className={`relative flex h-10 items-center gap-2 rounded-full px-5 font-display text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "text-white" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {on && <motion.span layoutId="billing" className="absolute inset-0 rounded-full bg-slate-900" transition={spring} />}
                  <span className="relative">{label as string}</span>
                  {y && (
                    <span className={`relative rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? "bg-brand-500 text-white" : "bg-brand-100 text-brand-700"}`}>
                      -{Math.round(PRICING.yearlyDiscount * 100)} %
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="w-full max-w-xl">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="plan-volume" className="text-sm font-medium text-slate-600">
                Emails envoyés par mois
              </label>
              <span className="font-display text-xl font-extrabold tracking-tight text-slate-900 tabular-nums">{fmt(volume)}</span>
            </div>
            <input
              id="plan-volume"
              type="range"
              min={0}
              max={VOLUMES.length - 1}
              value={vi}
              onChange={(e) => setVi(Number(e.target.value))}
              className="mt-3 w-full accent-brand-500"
              aria-valuetext={`${fmt(volume)} emails par mois`}
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400" aria-hidden>
              {VOLUMES.map((v, i) => (
                <button key={v} type="button" tabIndex={-1} onClick={() => setVi(i)} className={`tabular-nums ${i === vi ? "font-semibold text-slate-900" : "hover:text-slate-700"}`}>
                  {short(v)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Plans */}
        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <PlanCard key={p.id} plan={p} volume={volume} yearly={yearly} reduce={reduce} index={i} />
          ))}
        </div>

        <p className="reveal mt-6 text-center text-sm text-slate-500">
          Prix HT. Sans engagement en mensuel. Les {fmt(PRICING.freeEmails)} premiers emails sont toujours offerts, sans carte bancaire.
        </p>

        {/* Comparison */}
        <div className="mt-10 text-center">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-11 items-center gap-2 rounded-full px-5 font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15 transition hover:ring-slate-900/40"
          >
            {open ? "Masquer la comparaison" : "Comparer les formules"}
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.45, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="mt-8 overflow-x-auto rounded-[22px] bg-white ring-1 ring-slate-900/[0.08]">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-900/[0.07]">
                      <th className="p-4 font-display text-xs font-bold tracking-wider text-slate-400 uppercase">Fonctionnalité</th>
                      {PLANS.map((p) => (
                        <th key={p.id} className={`p-4 text-center font-display text-sm font-extrabold ${p.highlight ? "text-brand-500" : "text-slate-900"}`}>
                          {p.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PLAN_TABLE.map(([label, ...cells]) => (
                      <tr key={label} className="border-b border-slate-900/[0.05] last:border-0">
                        <td className="p-4 text-slate-700">{label}</td>
                        {cells.map((c, j) => (
                          <td key={j} className={`p-4 text-center ${PLANS[j].highlight ? "bg-brand-50/60" : ""}`}>
                            {c === true ? (
                              <Check className="mx-auto size-4 text-brand-500" aria-label="Inclus" />
                            ) : c === false ? (
                              <Minus className="mx-auto size-4 text-slate-300" aria-label="Non inclus" />
                            ) : (
                              <span className="font-medium text-slate-900">{c}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function PlanCard({ plan, volume, yearly, reduce, index }: { plan: Plan; volume: Volume; yearly: boolean; reduce: boolean; index: number }) {
  const dark = !!plan.highlight;
  const price = planPrice(plan, volume, yearly);
  const monthly = planPrice(plan, volume, false);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.7, delay: index * 0.1, ease: EASE }}
      whileHover={reduce ? undefined : { y: -6 }}
      className={`relative flex flex-col rounded-[26px] p-7 sm:p-8 ${
        dark ? "bg-slate-950 text-white shadow-[0_40px_100px_-40px_rgba(20,92,255,0.65)] ring-1 ring-brand-500/40" : "bg-white ring-1 ring-slate-900/[0.08]"
      }`}
    >
      {dark && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]">
            <div className="absolute -top-24 -right-16 size-64 rounded-full bg-brand-500/40 blur-[80px]" />
          </div>
          <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 font-display text-[11px] font-bold tracking-wide text-white uppercase shadow-lg">
            Recommandé
          </span>
        </>
      )}
      <div className="relative">
        <h3 className="display text-2xl">{plan.name}</h3>
        <p className={`mt-1.5 min-h-[44px] text-[14px] leading-snug ${dark ? "text-white/65" : "text-slate-500"}`}>{plan.tagline}</p>

        <div className="mt-6 flex h-[60px] items-end gap-1.5">
          <div className="relative overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={price}
                initial={reduce ? false : { y: "100%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
                className="display block text-[52px] leading-none tabular-nums"
              >
                {price} €
              </motion.span>
            </AnimatePresence>
          </div>
          <span className={`pb-1.5 text-sm ${dark ? "text-white/60" : "text-slate-500"}`}>/ mois</span>
        </div>
        <p className={`mt-2 h-5 text-[13px] ${dark ? "text-white/55" : "text-slate-500"}`}>
          {plan.prices
            ? yearly
              ? `Facturé annuellement · ${monthly} € en mensuel`
              : `${fmt(volume)} emails par mois`
            : `${fmt(PRICING.freeEmails)} emails par mois, pour toujours`}
        </p>

        <a
          href={SIGNUP_URL}
          className={`group mt-7 flex h-12 items-center justify-center gap-2 rounded-full font-display text-sm font-semibold transition-colors ${
            dark ? "bg-brand-500 text-white hover:bg-brand-400" : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {plan.cta}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </a>

        <p className={`mt-7 text-[13px] font-semibold ${dark ? "text-white" : "text-slate-900"}`}>{plan.featuresTitle}</p>
        <ul className="mt-3 space-y-2.5">
          {plan.features.map((f) => (
            <li key={f} className={`flex items-start gap-2.5 text-[14.5px] ${dark ? "text-white/80" : "text-slate-700"}`}>
              <Check className={`mt-0.5 size-4 shrink-0 ${dark ? "text-brand-400" : "text-brand-500"}`} /> {f}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

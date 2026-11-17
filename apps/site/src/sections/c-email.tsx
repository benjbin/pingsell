import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Shirt, ShoppingBag, Sparkles } from "lucide-react";
import { COLORS, FONTS, THEMES, TYPES, alpha, byId, tint, type DemoState, type FontSpec, type ThemeSpec } from "./c-tokens";

type Ctx = { c: string; f: FontSpec; t: ThemeSpec; mobile: boolean; tr?: string };

function Heading({ ctx, children, size, className = "", style }: { ctx: Ctx; children: ReactNode; size: number; className?: string; style?: CSSProperties }) {
  const { f } = ctx;
  return (
    <motion.p
      key={f.id}
      initial={ctx.tr ? { opacity: 0, y: 6, filter: "blur(6px)" } : false}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className={className}
      style={{
        fontFamily: f.heading,
        fontWeight: f.weight,
        textTransform: f.upper ? "uppercase" : "none",
        letterSpacing: f.tracking,
        lineHeight: f.upper ? 0.92 : 1.02,
        fontSize: size,
        transition: ctx.tr ? `${ctx.tr}, font-size 400ms ease` : undefined,
        ...style,
      }}
    >
      {children}
    </motion.p>
  );
}

/** The accent part of a headline: italic with the serif pairing, brand-coloured otherwise. */
function Accent({ ctx, children, onColor = false }: { ctx: Ctx; children: ReactNode; onColor?: boolean }) {
  return (
    <span style={{ fontStyle: ctx.f.italicAccent ? "italic" : "normal", color: onColor ? undefined : ctx.c, transition: ctx.tr }}>{children}</span>
  );
}

function Button({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  return (
    <div className="flex justify-center pt-3.5">
      <span
        className="inline-block px-5 py-2 text-[10px] font-bold text-white"
        style={{
          background: ctx.c,
          borderRadius: ctx.f.id === "mono" ? 4 : 999,
          fontFamily: ctx.f.body,
          boxShadow: `0 8px 18px -8px ${alpha(ctx.c, 0.8)}`,
          transition: ctx.tr,
        }}
      >
        {children}
      </span>
    </div>
  );
}

function Text({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  return (
    <p className="pt-3 text-[10px] leading-[1.6]" style={{ color: ctx.t.muted, transition: ctx.tr }}>
      {children}
    </p>
  );
}

function Name({ ctx }: { ctx: Ctx }) {
  return (
    <span className="rounded px-1 font-semibold" style={{ color: ctx.c, background: alpha(ctx.c, 0.12), transition: ctx.tr }}>
      Camille
    </span>
  );
}

function thumbBg(ctx: Ctx) {
  return ctx.t.id === "sombre" ? alpha(ctx.c, 0.22) : tint(ctx.c, 0.84);
}

function Soldes({ ctx }: { ctx: Ctx }) {
  const { c, t, mobile } = ctx;
  return (
    <>
      <div
        className="relative mt-3 flex items-end overflow-hidden rounded-xl p-3.5"
        style={{
          height: mobile ? 112 : 128,
          background: c,
          transition: ctx.tr ? `${ctx.tr}, height 400ms ease` : undefined,
        }}
      >
        <span
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,0.32), transparent 55%), linear-gradient(160deg, transparent 40%, rgba(7,23,51,0.28))" }}
        />
        <span className="absolute -top-7 -right-7 size-24 rounded-full border-[12px] border-white/20" />
        <span className="absolute top-3 left-3.5 rounded-full bg-white/20 px-2 py-0.5 text-[8px] font-bold tracking-[0.14em] text-white uppercase">Soldes d'hiver</span>
        <Heading ctx={ctx} size={mobile ? 22 : 27} className="relative text-white">
          −30 % sur
          <br />
          <Accent ctx={ctx} onColor>
            tout l'hiver
          </Accent>
        </Heading>
      </div>
      <Text ctx={ctx}>
        Bonjour <Name ctx={ctx} />, nos pièces d'hiver passent en soldes jusqu'à dimanche minuit.
      </Text>
      <div className="mt-3 rounded-lg border-[1.5px] border-dashed py-2 text-center" style={{ borderColor: c, transition: ctx.tr }}>
        <p className="text-[7px] tracking-[0.2em] uppercase" style={{ color: t.muted, transition: ctx.tr }}>
          Votre code
        </p>
        <p className="font-mono text-[13px] font-bold tracking-[0.14em]" style={{ color: t.text, transition: ctx.tr }}>
          HIVER30
        </p>
      </div>
      <div className="flex justify-center gap-1.5 pt-3">
        {[
          ["02", "jours"],
          ["14", "heures"],
          ["37", "min"],
        ].map(([n, l]) => (
          <span key={l} className="min-w-10 rounded-md px-2 py-1 text-center" style={{ background: t.surface, transition: ctx.tr }}>
            <span className="block text-[12px] leading-none font-extrabold" style={{ fontFamily: ctx.f.heading, color: t.text, transition: ctx.tr }}>
              {n}
            </span>
            <span className="text-[6px] tracking-wider uppercase" style={{ color: t.muted, transition: ctx.tr }}>
              {l}
            </span>
          </span>
        ))}
      </div>
      <Button ctx={ctx}>J'en profite</Button>
    </>
  );
}

function Nouveaute({ ctx }: { ctx: Ctx }) {
  const { c, t, mobile } = ctx;
  const products = [
    ["Veste en lin", "89 €"],
    ["Chemise oxford", "59 €"],
  ];
  return (
    <>
      <p className="flex items-center gap-1 pt-4 text-[8px] font-bold tracking-[0.18em] uppercase" style={{ color: c, transition: ctx.tr }}>
        <Sparkles className="size-2.5" /> Nouvelle collection
      </p>
      <Heading ctx={ctx} size={mobile ? 22 : 28} className="pt-1.5" style={{ color: t.text }}>
        Le printemps
        <br />
        <Accent ctx={ctx}>est arrivé.</Accent>
      </Heading>
      <Text ctx={ctx}>Des matières légères et des coupes pensées pour durer. Découvrez-les avant tout le monde.</Text>
      <div className="grid grid-cols-2 gap-2 pt-3">
        {products.map(([name, price], i) => (
          <div key={name}>
            <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg" style={{ background: thumbBg(ctx), transition: ctx.tr }}>
              <span className="absolute -bottom-4 -left-4 size-14 rounded-full" style={{ background: alpha(c, 0.18), transition: ctx.tr }} />
              <Shirt className="relative size-7" strokeWidth={1.5} style={{ color: c, transform: i ? "rotate(-8deg)" : "rotate(6deg)", transition: ctx.tr }} />
            </div>
            <p className="pt-1.5 text-[9px] font-bold" style={{ color: t.text, transition: ctx.tr }}>
              {name}
            </p>
            <p className="text-[9px]" style={{ color: t.muted, transition: ctx.tr }}>
              {price}
            </p>
          </div>
        ))}
      </div>
      <Button ctx={ctx}>Découvrir la collection</Button>
    </>
  );
}

function Panier({ ctx }: { ctx: Ctx }) {
  const { c, t, mobile } = ctx;
  return (
    <>
      <div className="flex justify-center pt-4">
        <span className="flex size-10 items-center justify-center rounded-full" style={{ background: alpha(c, 0.14), transition: ctx.tr }}>
          <ShoppingBag className="size-5" strokeWidth={1.75} style={{ color: c, transition: ctx.tr }} />
        </span>
      </div>
      <Heading ctx={ctx} size={mobile ? 20 : 25} className="pt-2.5 text-center" style={{ color: t.text }}>
        Vous avez oublié
        <br />
        <Accent ctx={ctx}>quelque chose ?</Accent>
      </Heading>
      <div className="text-center">
        <Text ctx={ctx}>
          Bonjour <Name ctx={ctx} />, votre panier vous attend. Nous l'avons gardé de côté.
        </Text>
      </div>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl p-2" style={{ background: t.surface, transition: ctx.tr }}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg" style={{ background: thumbBg(ctx), transition: ctx.tr }}>
          <Shirt className="size-5" strokeWidth={1.5} style={{ color: c, transition: ctx.tr }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-bold" style={{ color: t.text, transition: ctx.tr }}>
            Pull col roulé
          </span>
          <span className="block text-[8px]" style={{ color: t.muted, transition: ctx.tr }}>
            Taille M · Qté 1
          </span>
        </span>
        <span className="text-[10px] font-bold" style={{ color: t.text, transition: ctx.tr }}>
          79 €
        </span>
      </div>
      <Button ctx={ctx}>Finaliser ma commande</Button>
      <p className="pt-2 text-center text-[8px]" style={{ color: t.muted, transition: ctx.tr }}>
        Livraison offerte dès 60 €
      </p>
    </>
  );
}

/** Live email preview: reacts to colour, font pairing, theme, email type and device width. */
export function EmailPreview({ s, reduce }: { s: DemoState; reduce: boolean }) {
  const c = byId(COLORS, s.color).hex;
  const f: FontSpec = byId(FONTS, s.font);
  const t: ThemeSpec = byId(THEMES, s.theme);
  const type = byId(TYPES, s.type);
  const mobile = s.device === "mobile";
  const tr = reduce ? undefined : "background-color 500ms ease, color 500ms ease, border-color 500ms ease, box-shadow 500ms ease";
  const ctx: Ctx = { c, f, t, mobile, tr };
  const morph: Transition = reduce ? { duration: 0 } : { type: "spring", stiffness: 190, damping: 26 };
  const swap: Transition = reduce ? { duration: 0 } : { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] };
  const Body = s.type === "soldes" ? Soldes : s.type === "nouveaute" ? Nouveaute : Panier;

  return (
    <motion.div
      className="relative mx-auto flex h-full w-full flex-col overflow-hidden"
      initial={false}
      animate={{
        maxWidth: mobile ? 236 : 430,
        borderRadius: mobile ? 32 : 14,
        boxShadow: mobile
          ? "0 0 0 7px rgba(7,23,51,1), 0 30px 60px -24px rgba(7,23,51,0.55)"
          : `0 0 0 1px rgba(11,33,74,0.10), 0 30px 70px -30px rgba(7,23,51,0.45)`,
      }}
      transition={morph}
      style={{ background: t.bg, fontFamily: f.body, transition: tr }}
    >
      {/* Inbox chrome */}
      <div className="relative shrink-0 border-b px-3.5 pb-2.5" style={{ borderColor: t.line, transition: tr }}>
        <motion.div initial={false} animate={{ height: mobile ? 26 : 12 }} transition={morph} className="relative">
          <AnimatePresence initial={false}>
            {mobile && (
              <motion.div
                key="status"
                className="absolute inset-x-0 top-0 flex items-center justify-between pt-2 text-[8px] font-bold"
                style={{ color: t.text, transition: tr }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={swap}
              >
                <span>9:41</span>
                <span className="absolute top-1.5 left-1/2 h-[14px] w-[62px] -translate-x-1/2 rounded-full bg-[#071733]" />
                <span className="flex items-center gap-0.5">
                  <span className="h-1.5 w-3 rounded-[2px] border" style={{ borderColor: t.text }} />
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
            style={{ background: c, fontFamily: f.heading, transition: tr }}
          >
            A
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-bold" style={{ color: t.text, transition: tr }}>
              Atelier Nord <span className="font-normal" style={{ color: t.muted }}>· à l'instant</span>
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={type.id}
                className="truncate text-[9.5px]"
                style={{ color: t.muted, transition: tr }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={swap}
              >
                {type.subject}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Email body */}
      <div className="relative min-h-0 flex-1 overflow-hidden px-4 pt-3.5" style={{ color: t.text }}>
        <p
          className="text-center text-[11px]"
          style={{
            fontFamily: f.heading,
            fontWeight: f.weight,
            textTransform: "uppercase",
            letterSpacing: f.id === "fraunces" ? "0.12em" : "0.06em",
            color: t.text,
            transition: tr,
          }}
        >
          Atelier Nord
        </p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={type.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={swap}
          >
            <Body ctx={ctx} />
            <div className="flex justify-center gap-1.5 pt-5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-3.5 rounded-full" style={{ background: t.surface, transition: tr }} />
              ))}
            </div>
            <p className="pt-2 pb-6 text-center text-[7.5px]" style={{ color: t.muted, transition: tr }}>
              Atelier Nord · Se désinscrire
            </p>
          </motion.div>
        </AnimatePresence>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: `linear-gradient(to bottom, transparent, ${t.bg})`, transition: tr }}
        />
      </div>
    </motion.div>
  );
}

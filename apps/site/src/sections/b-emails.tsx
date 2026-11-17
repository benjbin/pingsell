/**
 * Hero B: four example emails, drawn in HTML/CSS, one per (obviously fictional) brand style.
 * Every card is 240 x 350 px; the stage scales them on small screens.
 */

import { t } from "../i18n";

const CARD = "relative h-[350px] w-[240px] overflow-hidden rounded-[18px] shadow-[0_30px_60px_-24px_rgba(7,23,51,0.55),0_8px_20px_-12px_rgba(7,23,51,0.35)] ring-1 ring-slate-900/10";

function Tag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded px-1 font-semibold ${className}`}>{children}</span>;
}

/** Fashion: cream paper, serif, editorial photo. */
export function EmailBrume() {
  return (
    <div className={`${CARD} flex flex-col bg-[#f4efe7] text-[#2b2620]`}>
      <div className="flex items-center justify-between px-4 pt-3.5 text-[6.5px] tracking-[0.28em] uppercase">
        <span>{t("Nouveautés", "New in")}</span>
        <span className="font-serif text-[12px] tracking-[0.22em]">Maison Brume</span>
        <span>N°12</span>
      </div>
      <div className="relative mx-3 mt-3 h-[168px] overflow-hidden rounded-[3px] bg-gradient-to-b from-[#e2d5c3] to-[#bfa98c]">
        <div className="absolute top-5 left-1/2 h-[150px] w-[96px] -translate-x-1/2 rounded-t-full bg-[#efe6d8]/70" />
        <div className="absolute top-[38px] left-1/2 size-[30px] -translate-x-1/2 rounded-full bg-[#8a6f55]" />
        <div className="absolute top-[64px] left-1/2 h-[120px] w-[74px] -translate-x-1/2 rounded-t-[30px] bg-[#5c4a3a]" />
        <div className="absolute top-[64px] left-1/2 h-[120px] w-[3px] -translate-x-1/2 bg-[#3f3329]" />
        <p className="absolute bottom-2 left-2.5 text-[6px] tracking-[0.3em] text-white/90 uppercase">{t("Automne · Hiver", "Fall · Winter")}</p>
      </div>
      <p className="mt-3 px-4 text-center font-serif text-[21px] leading-[1.05] italic">{t("La saison des laines", "Wool season")}</p>
      <p className="mt-1.5 px-6 text-center text-[7.5px] leading-relaxed text-[#6b6157]">
        {t(
          <>
            <Tag className="bg-[#2b2620]/10">Prénom</Tag>, la nouvelle collection est en ligne : mailles épaisses, coupes amples.
          </>,
          <>
            <Tag className="bg-[#2b2620]/10">First name</Tag>, the new collection is live: chunky knits, relaxed fits.
          </>,
        )}
      </p>
      <div className="mt-auto mb-4 flex justify-center">
        <span className="bg-[#2b2620] px-5 py-1.5 text-[7px] tracking-[0.25em] text-[#f4efe7] uppercase">{t("Découvrir", "Discover")}</span>
      </div>
    </div>
  );
}

/** Retail sale: navy and electric blue, promo code, countdown. */
export function EmailNord() {
  return (
    <div className={`${CARD} flex flex-col bg-white`}>
      <p className="py-3 text-center font-display text-[11px] font-extrabold tracking-tight text-slate-900 uppercase">Atelier Nord</p>
      <div className="relative mx-3 flex h-[118px] items-end overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 via-brand-700 to-brand-500 p-3">
        <div className="absolute -top-7 -right-7 size-24 rounded-full border-[12px] border-white/15" />
        <div className="absolute top-6 right-10 size-6 rounded-full bg-white/20" />
        <p className="relative font-display text-[19px] leading-[0.9] font-extrabold text-white uppercase">
          {t(
            <>
              -30 % sur
              <br />
              tout l'hiver
            </>,
            <>
              30% off
              <br />
              all winter
            </>,
          )}
        </p>
      </div>
      <p className="px-4 pt-3 text-[8px] leading-relaxed text-slate-600">
        {t(
          <>
            Bonjour <Tag className="bg-brand-500/10 text-brand-500">Prénom</Tag>, nos pièces d'hiver passent en soldes jusqu'à dimanche.
          </>,
          <>
            Hi <Tag className="bg-brand-500/10 text-brand-500">First name</Tag>, our winter pieces are on sale through Sunday.
          </>,
        )}
      </p>
      <div className="mx-4 mt-3 rounded-lg border-[1.5px] border-dashed border-brand-500 py-1.5 text-center">
        <p className="text-[6px] tracking-[0.18em] text-slate-400 uppercase">{t("Votre code", "Your code")}</p>
        <p className="font-mono text-[13px] font-bold tracking-[0.12em] text-slate-900">HIVER30</p>
      </div>
      <div className="mt-2.5 flex justify-center gap-1.5">
        {["02", "14", "37"].map((n, i) => (
          <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-center">
            <span className="block font-display text-[12px] leading-none font-extrabold text-slate-900">{n}</span>
            <span className="text-[5.5px] tracking-wider text-slate-400 uppercase">{[t("jours", "days"), t("heures", "hrs"), "min"][i]}</span>
          </span>
        ))}
      </div>
      <div className="mt-auto pb-4 text-center">
        <span className="inline-block rounded-full bg-brand-500 px-5 py-1.5 text-[8px] font-bold text-white">{t("J'en profite", "Shop now")}</span>
      </div>
    </div>
  );
}

/** Fine food: forest green and mustard, abandoned cart. */
export function EmailColibri() {
  const items = [
    [t("Miel de lavande", "Lavender honey"), "250 g", t("12,90 €", "€12.90"), "#f2b631"],
    [t("Confiture de figue", "Fig jam"), "320 g", t("7,50 €", "€7.50"), "#8c3b5a"],
  ];
  return (
    <div className={`${CARD} flex flex-col bg-[#17382a] text-[#f6efd9]`}>
      <div className="flex items-center gap-1.5 px-4 pt-3.5">
        <span className="size-3 rounded-full bg-[#f2b631]" />
        <span className="font-display text-[10px] font-extrabold tracking-tight uppercase">Ferme Colibri</span>
        <span className="ml-auto text-[6.5px] tracking-[0.2em] text-[#f6efd9]/60 uppercase">{t("Épicerie", "Pantry")}</span>
      </div>
      <p className="mt-4 px-4 font-display text-[24px] leading-[0.9] font-extrabold uppercase">
        {t(
          <>
            Votre panier
            <br />
            <span className="text-[#f2b631]">vous attend</span>
          </>,
          <>
            Your cart
            <br />
            <span className="text-[#f2b631]">is waiting</span>
          </>,
        )}
      </p>
      <p className="mt-2 px-4 text-[7.5px] leading-relaxed text-[#f6efd9]/70">
        {t(
          <>
            <Tag className="bg-[#f2b631]/20 text-[#f2b631]">Prénom</Tag>, vous avez laissé de belles choses de côté.
          </>,
          <>
            <Tag className="bg-[#f2b631]/20 text-[#f2b631]">First name</Tag>, you left some lovely things behind.
          </>,
        )}
      </p>
      <div className="mx-3 mt-3 space-y-1.5 rounded-xl bg-[#f6efd9] p-2 text-[#17382a]">
        {items.map(([name, w, price, c]) => (
          <div key={name} className="flex items-center gap-2 rounded-lg bg-white/70 p-1.5">
            <span className="relative flex h-8 w-7 shrink-0 items-end justify-center rounded-md bg-[#e9dfc3]">
              <span className="mb-1 h-5 w-4 rounded-[4px]" style={{ background: c }} />
              <span className="absolute top-1 h-1.5 w-4 rounded-sm bg-[#17382a]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[8px] font-bold">{name}</span>
              <span className="block text-[6.5px] opacity-60">{w}</span>
            </span>
            <span className="ml-auto font-display text-[9px] font-extrabold">{price}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto px-3 pb-4">
        <span className="block rounded-full bg-[#f2b631] py-2 text-center text-[8px] font-bold text-[#17382a]">{t("Finaliser ma commande", "Complete my order")}</span>
      </div>
    </div>
  );
}

/** Cosmetics: blush and rose, loyalty anniversary. */
export function EmailPetale() {
  return (
    <div className={`${CARD} flex flex-col bg-[#fbe6e8] text-[#5a1f33]`}>
      <p className="pt-3.5 text-center font-display text-[11px] font-light tracking-[0.35em] uppercase">Pétale Labo</p>
      <div className="relative mx-3 mt-3 flex h-[132px] items-end justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#f7c9d1] via-[#f4b3c2] to-[#e88aa5] pb-4">
        <div className="absolute -top-8 -left-6 size-28 rounded-full bg-white/25" />
        <div className="absolute top-4 right-5 size-10 rounded-full bg-[#fff3f5]/40" />
        <span className="relative flex flex-col items-center">
          <span className="h-3 w-2 rounded-t-sm bg-[#5a1f33]" />
          <span className="h-[62px] w-[30px] rounded-[10px] bg-white/90 shadow-sm" />
        </span>
        <span className="relative flex flex-col items-center">
          <span className="h-4 w-5 rounded-t-md bg-[#d9467a]" />
          <span className="h-[44px] w-[38px] rounded-[12px] bg-[#fff3f5] shadow-sm" />
        </span>
      </div>
      <p className="mt-3 text-center font-display text-[20px] leading-[0.95] font-extrabold tracking-tight uppercase">
        {t(
          <>
            Un an déjà,
            <br />
            <span className="text-[#d9467a]">merci !</span>
          </>,
          <>
            One year already,
            <br />
            <span className="text-[#d9467a]">thank you!</span>
          </>,
        )}
      </p>
      <p className="mt-1.5 px-6 text-center text-[7.5px] leading-relaxed text-[#5a1f33]/70">
        {t(
          <>
            <Tag className="bg-[#d9467a]/15 text-[#d9467a]">Prénom</Tag>, pour fêter ça, un cadeau vous attend sur votre prochaine commande.
          </>,
          <>
            <Tag className="bg-[#d9467a]/15 text-[#d9467a]">First name</Tag>, to celebrate, a gift is waiting on your next order.
          </>,
        )}
      </p>
      <div className="mt-auto mb-4 flex items-center justify-center gap-2">
        <span className="rounded-full border border-dashed border-[#d9467a] px-2.5 py-1 font-mono text-[8px] font-bold tracking-[0.14em]">MERCI15</span>
        <span className="rounded-full bg-[#5a1f33] px-3 py-1 text-[7.5px] font-bold text-white">{t("-15 %", "-15%")}</span>
      </div>
    </div>
  );
}

/** Fan order, left to right. */
export const B_EMAILS = [EmailBrume, EmailNord, EmailColibri, EmailPetale];

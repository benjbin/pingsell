import { Clock, Image, LayoutGrid, MousePointerClick, ShoppingBag, ShoppingCart, Sparkles, Ticket, Timer, Type, Mail, Smartphone, Monitor, Star } from "lucide-react";

/** Hero visual: the Missive editor, drawn in HTML (no screenshot to keep in sync). */
export function EditorMock() {
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-white shadow-[0_40px_120px_-40px_rgba(11,33,74,0.55)] ring-1 ring-slate-900/10">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-slate-900/[0.07] px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
          <span className="size-2.5 rounded-full bg-slate-200" />
        </span>
        <span className="font-display text-[11px] font-extrabold tracking-tight text-slate-900 uppercase">Soldes d'hiver</span>
        <span className="hidden rounded-full bg-slate-100 p-0.5 sm:flex">
          <span className="flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-white">
            <Monitor className="size-2.5" /> Ordinateur
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
            <Smartphone className="size-2.5" /> Mobile
          </span>
        </span>
        <span className="ml-auto rounded-full bg-slate-900 px-3 py-1 font-display text-[9px] font-semibold text-white">Enregistrer</span>
      </div>
      <div className="grid grid-cols-[88px_1fr] sm:grid-cols-[110px_1fr_150px]">
        {/* Blocks */}
        <div className="space-y-1.5 border-r border-slate-900/[0.07] p-2.5">
          <p className="mb-1 font-display text-[8px] font-bold tracking-[0.18em] text-slate-400 uppercase">Blocs</p>
          {[
            [Type, "Texte"],
            [Image, "Image"],
            [MousePointerClick, "Bouton"],
            [ShoppingBag, "Produit"],
            [Ticket, "Code promo"],
            [Timer, "Compte à rebours"],
            [LayoutGrid, "Galerie"],
          ].map(([Icon, label], i) => {
            const I = Icon as typeof Type;
            return (
              <div key={i} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] font-semibold ${i === 4 ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-700"}`}>
                <I className="size-3" strokeWidth={1.75} /> <span className="truncate">{label as string}</span>
              </div>
            );
          })}
        </div>
        {/* Canvas */}
        <div className="bg-[radial-gradient(#dde4f0_1px,transparent_1px)] bg-[size:14px_14px] p-3 sm:p-5">
          <div className="mx-auto max-w-[300px] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-900/5">
            <p className="py-3 text-center font-display text-[11px] font-extrabold tracking-tight text-slate-900 uppercase">Atelier Nord</p>
            <div className="relative mx-3 flex h-24 items-end overflow-hidden rounded-lg bg-gradient-to-br from-slate-900 via-brand-700 to-brand-500 p-3">
              <div className="absolute -top-6 -right-6 size-20 rounded-full border-[10px] border-white/15" />
              <p className="relative font-display text-[15px] leading-none font-extrabold text-white uppercase">
                -30 % sur
                <br />
                tout l'hiver
              </p>
            </div>
            <p className="px-4 pt-3 text-[9px] leading-relaxed text-slate-600">
              Bonjour <span className="rounded bg-brand-500/10 px-1 font-semibold text-brand-500">Prénom</span>, nos pièces d'hiver passent en soldes jusqu'à dimanche.
            </p>
            <div className="relative mx-4 my-3 rounded-lg border-[1.5px] border-dashed border-brand-500 py-2 text-center ring-2 ring-brand-500 ring-offset-2">
              <span className="absolute -top-2.5 left-2 rounded bg-brand-500 px-1.5 py-px text-[7px] font-bold text-white">Code promo</span>
              <p className="text-[7px] tracking-[0.18em] text-slate-400 uppercase">Votre code</p>
              <p className="font-mono text-[13px] font-bold tracking-[0.12em] text-slate-900">HIVER30</p>
            </div>
            <div className="flex justify-center gap-1.5 pb-3">
              {["02", "14", "37"].map((n, i) => (
                <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-center">
                  <span className="block font-display text-[12px] leading-none font-extrabold text-slate-900">{n}</span>
                  <span className="text-[6px] tracking-wider text-slate-400 uppercase">{["jours", "heures", "min"][i]}</span>
                </span>
              ))}
            </div>
            <div className="pb-4 text-center">
              <span className="inline-block rounded-full bg-brand-500 px-4 py-1.5 text-[9px] font-bold text-white">J'en profite</span>
            </div>
          </div>
        </div>
        {/* Inspector */}
        <div className="hidden space-y-3 border-l border-slate-900/[0.07] p-3 sm:block">
          <p className="font-display text-[8px] font-bold tracking-[0.18em] text-slate-900 uppercase">Code promo</p>
          <div>
            <p className="mb-1 text-[8px] font-medium text-slate-500">Code</p>
            <p className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[9px] tracking-widest text-slate-900">HIVER30</p>
          </div>
          <div>
            <p className="mb-1 text-[8px] font-medium text-slate-500">Couleur du code</p>
            <div className="flex gap-1">
              {["#0b214a", "#145cff", "#e11d48", "#16a34a", "#f59e0b"].map((c) => (
                <span key={c} className="size-3.5 rounded-full ring-1 ring-slate-900/10" style={{ background: c }} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[8px] font-medium text-slate-500">Taille du code</p>
            <div className="h-1 rounded-full bg-slate-200">
              <div className="h-1 w-3/5 rounded-full bg-brand-500" />
            </div>
          </div>
          <div>
            <p className="mb-1 text-[8px] font-medium text-slate-500">Police</p>
            <p className="rounded-md bg-slate-100 px-2 py-1 text-[9px] text-slate-900">Outfit</p>
          </div>
          <div>
            <p className="mb-1 text-[8px] font-medium text-slate-500">Trait</p>
            <div className="flex gap-0.5 rounded-full bg-slate-100 p-0.5 text-[7px] font-semibold">
              <span className="flex-1 rounded-full bg-slate-900 py-0.5 text-center text-white">Tirets</span>
              <span className="flex-1 py-0.5 text-center text-slate-500">Points</span>
              <span className="flex-1 py-0.5 text-center text-slate-500">Plein</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Automation flow: abandoned cart. */
export function FlowMock() {
  const steps = [
    { icon: ShoppingCart, title: "Panier abandonné", text: "Déclencheur Shopify", tone: "bg-brand-500 text-white" },
    { icon: Clock, title: "Attendre 1 heure", text: "Laisser le temps de revenir", tone: "bg-white text-slate-900" },
    { icon: Mail, title: "« Vous avez oublié quelque chose »", text: "Email avec le contenu du panier", tone: "bg-white text-slate-900" },
    { icon: Clock, title: "Attendre 24 heures", text: "", tone: "bg-white text-slate-900" },
    { icon: Ticket, title: "« -10 % pour finaliser »", text: "Code promo valable 48 h", tone: "bg-white text-slate-900" },
  ];
  return (
    <div className="relative mx-auto max-w-sm">
      {steps.map((s, i) => (
        <div key={i} className="relative">
          <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-900/10 ${s.tone}`}>
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${i === 0 ? "bg-white/15" : "bg-slate-100"}`}>
              <s.icon className={`size-4 ${i === 0 ? "text-white" : "text-brand-500"}`} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold">{s.title}</p>
              {s.text && <p className={`text-xs ${i === 0 ? "text-white/70" : "text-slate-500"}`}>{s.text}</p>}
            </div>
          </div>
          {i < steps.length - 1 && <div className="mx-auto h-5 w-px bg-slate-300" />}
        </div>
      ))}
    </div>
  );
}

/** Campaign report summary. */
export function ReportMock() {
  const bars = [38, 64, 52, 80, 71, 92, 60, 45, 70, 58, 84, 66];
  return (
    <div className="rounded-[22px] bg-white p-5 shadow-[0_30px_80px_-40px_rgba(11,33,74,0.45)] ring-1 ring-slate-900/10">
      <div className="flex items-center justify-between">
        <p className="font-display text-xs font-extrabold tracking-tight text-slate-900 uppercase">Soldes d'hiver · rapport</p>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Envoyée</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["Envoyés", "8 412"],
          ["Ouvertures", "46,2 %"],
          ["Clics", "7,9 %"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-slate-100 p-3">
            <p className="text-[10px] text-slate-500">{l}</p>
            <p className="mt-1 font-display text-lg leading-none font-extrabold tracking-tight text-slate-900">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex h-24 items-end gap-1.5">
        {bars.map((h, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end gap-0.5">
            <div className="rounded-t-sm bg-brand-500" style={{ height: `${h * 0.55}%` }} />
            <div className="rounded-b-sm bg-slate-900" style={{ height: `${h * 0.2}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brand-500" /> Ouvertures
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-slate-900" /> Clics
        </span>
      </div>
    </div>
  );
}

/** Phone with the mobile app. */
export function PhoneMock() {
  return (
    <div className="mx-auto w-[220px] rounded-[38px] bg-slate-950 p-2.5 shadow-[0_40px_80px_-30px_rgba(7,23,51,0.7)]">
      <div className="overflow-hidden rounded-[30px] bg-slate-100">
        <div className="flex justify-center pt-2">
          <span className="h-5 w-20 rounded-full bg-slate-950" />
        </div>
        <div className="space-y-2.5 p-3.5">
          <p className="font-display text-base font-extrabold tracking-tight text-slate-900 uppercase">
            Bonjour<span className="text-brand-500">.</span>
          </p>
          <div className="rounded-2xl bg-slate-900 p-3 text-white">
            <p className="text-[9px] tracking-[0.16em] text-white/60 uppercase">Ce mois</p>
            <p className="mt-1 font-display text-2xl leading-none font-extrabold">12 480</p>
            <p className="text-[9px] text-white/60">emails envoyés</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-2.5">
              <p className="text-[8px] text-slate-500">Ouvertures</p>
              <p className="font-display text-sm font-extrabold text-slate-900">44 %</p>
            </div>
            <div className="rounded-xl bg-white p-2.5">
              <p className="text-[8px] text-slate-500">Contacts</p>
              <p className="font-display text-sm font-extrabold text-slate-900">6 932</p>
            </div>
          </div>
          {["Soldes d'hiver", "Nouvelle collection", "Bienvenue"].map((c, i) => (
            <div key={c} className="flex items-center justify-between rounded-xl bg-white px-2.5 py-2">
              <span className="text-[9px] font-semibold text-slate-900">{c}</span>
              <span className={`rounded-full px-1.5 py-px text-[7px] font-semibold ${i === 0 ? "bg-emerald-50 text-emerald-700" : i === 1 ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-700"}`}>
                {i === 0 ? "Envoyée" : i === 1 ? "Programmée" : "Active"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Brand-style card: fonts and colors. */
export function BrandMock() {
  return (
    <div className="rounded-[22px] bg-white p-5 shadow-[0_30px_80px_-40px_rgba(11,33,74,0.45)] ring-1 ring-slate-900/10">
      <p className="flex items-center gap-2 font-display text-xs font-extrabold tracking-tight text-slate-900 uppercase">
        <Sparkles className="size-3.5 text-brand-500" /> Style de marque
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["Neokrome", "#EEF2F8", "#145CFF", "'Outfit'"],
          ["Encre", "#F3F1EA", "#0E0E0C", "Georgia"],
          ["Vermillon", "#FFF3EE", "#FF4D1C", "'Manrope'"],
        ].map(([n, bg, ac, f], i) => (
          <div key={n} className={`overflow-hidden rounded-xl ring-1 ${i === 0 ? "ring-2 ring-brand-500" : "ring-slate-900/10"}`}>
            <div className="flex h-12 items-end gap-1 p-2" style={{ background: bg }}>
              <span className="flex h-7 flex-1 items-center rounded-md bg-white px-1.5 text-[12px] font-extrabold" style={{ fontFamily: f }}>
                Aa
              </span>
              <span className="h-3 w-5 rounded-full" style={{ background: ac }} />
            </div>
            <p className="px-2 py-1 text-[10px] font-semibold text-slate-700">{n}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-[10px] font-medium text-slate-500">Vos polices</p>
        {[
          ["Fraunces", "Google Fonts", "Georgia, serif"],
          ["Ma Police Marque", "Fichier importé", "'Outfit', sans-serif"],
        ].map(([n, src, f]) => (
          <div key={n} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-900/[0.06]">
            <span className="text-lg leading-none text-slate-900" style={{ fontFamily: f }}>
              Aa
            </span>
            <span>
              <span className="block text-xs font-semibold text-slate-900">{n}</span>
              <span className="block text-[10px] text-slate-500">{src}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {["#0B214A", "#145CFF", "#4D82FF", "#EEF2F8", "#F5B301"].map((c) => (
          <span key={c} className="size-6 rounded-full ring-1 ring-slate-900/10" style={{ background: c }} />
        ))}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-500">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="size-3 fill-current" />
          ))}
        </span>
      </div>
    </div>
  );
}

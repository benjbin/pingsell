import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { BarChart3, Check, Contact, Globe, KeyRound, Layers, LayoutDashboard, Megaphone, Plug, Repeat, ShoppingBag, Smartphone, Store, Tags, Upload, Users, Workflow } from "lucide-react";
import { API_URL } from "../content";

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Tools that can feed Pingsell through the API (anything able to make an HTTP call). */
const SOURCES = [
  [Contact, "CRM"],
  [Smartphone, "App mobile"],
  [Globe, "Site web"],
  [LayoutDashboard, "Back-office"],
  [Store, "Logiciel de caisse"],
  [Plug, "Vos outils maison"],
] as const;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const FLOW_SOURCES = ["Votre CRM", "Votre app", "Votre site", "Votre caisse", "Votre logiciel"];

const SNIPPETS: Record<string, string> = {
  cURL: `curl -X POST ${API_URL}/contacts \\
  -H "Authorization: Bearer msv_••••••••" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "camille@exemple.fr",
    "first_name": "Camille",
    "tags": ["client-vip"],
    "attributes": { "ville": "Lyon" }
  }'`,
  "Node.js": `// À l'inscription d'un client dans votre logiciel
await fetch("${API_URL}/contacts", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.PINGSELL_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: client.email,
    first_name: client.prenom,
    tags: ["client-vip"],
  }),
});`,
  PHP: `// À l'inscription d'un client dans votre logiciel
$ch = curl_init("${API_URL}/contacts");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . getenv("PINGSELL_KEY"),
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "email" => $client["email"],
    "tags"  => ["client-vip"],
  ]),
]);
curl_exec($ch);`,
};

/** Minimal highlighting: comments, strings, keys. */
export function Line({ text }: { text: string }) {
  if (/^\s*(\/\/|#)/.test(text)) return <span className="text-slate-500">{text}</span>;
  const parts = text.split(/("(?:[^"\\]|\\.)*"|'[^']*'|`[^`]*`)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-brand-300">
            {p}
          </span>
        ) : (
          <span key={i}>
            {p.split(/(\b(?:await|fetch|curl|POST|true|method|headers|body)\b|-X|-H|-d)/g).map((q, j) =>
              j % 2 === 1 ? (
                <span key={j} className="text-[#f5b301]">
                  {q}
                </span>
              ) : (
                q
              ),
            )}
          </span>
        ),
      )}
    </>
  );
}

const FEATURES = [
  { icon: Users, title: "Contacts", text: "Créez ou mettez à jour un contact à chaque inscription, avec prénom, téléphone et vos propres attributs." },
  { icon: Tags, title: "Tags", text: "Ajoutez ou retirez des tags depuis votre logiciel pour classer vos clients." },
  { icon: Workflow, title: "Automatisations", text: "Un contact créé ou un tag ajouté déclenche vos scénarios : bienvenue, relance, fidélité." },
  { icon: Upload, title: "Import en masse", text: "Envoyez jusqu'à 50 000 contacts par appel, en JSON ou en CSV." },
  { icon: Megaphone, title: "Campagnes", text: "Créez, testez, programmez et envoyez vos campagnes par API." },
  { icon: BarChart3, title: "Statistiques", text: "Récupérez ouvertures, clics et chiffre d'affaires pour vos propres tableaux de bord." },
];

/** "Branchez Pingsell sur votre logiciel": REST API + API keys, with an animated live example. */
export function ApiSection() {
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<keyof typeof SNIPPETS>("cURL");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const lines = SNIPPETS[tab].split("\n");
  const shown = reduce || inView;
  const responseDelay = reduce ? 0 : 0.25 + lines.length * 0.05;

  return (
    <section id="integration" className="relative isolate overflow-hidden bg-slate-950 py-24 text-white lg:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(60%_60%_at_70%_40%,black,transparent)]" />
        <motion.div
          className="absolute top-[10%] right-[-10%] size-[560px] rounded-full bg-brand-500/30 blur-[130px]"
          animate={reduce ? undefined : { x: [0, -50, 0], y: [0, 40, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="reveal min-w-0">
          <p className="eyebrow !text-brand-300">API & intégrations</p>
          <h2 className="display mt-4 text-[38px] leading-[0.92] sm:text-[52px]">
            Branchez Pingsell <em className="text-brand-400">sur tous vos outils.</em>
          </h2>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-white/70">
            Intégrez Pingsell directement dans votre logiciel, ou gardez-le à côté et laissez vos outils le piloter. Tout ce qui sait appeler une API peut ajouter des contacts et déclencher vos automatisations.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {[
              [Plug, "Intégré à votre logiciel", "Vos clients et vos campagnes gérés depuis votre propre outil, Pingsell travaille en coulisses."],
              [Layers, "À côté de vos outils", "Gardez Pingsell comme espace email, alimenté en continu par votre CRM, votre app, votre site."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Plug;
              return (
                <div key={t as string} className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
                  <I className="size-4 text-brand-400" strokeWidth={1.75} />
                  <p className="mt-2.5 font-display text-[15px] font-bold">{t as string}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-white/60">{d as string}</p>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-[13px] text-white/50">Ils peuvent déclencher vos emails :</p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {SOURCES.map(([Icon, label]) => {
              const I = Icon as typeof Plug;
              return (
                <li key={label as string} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-white/80 ring-1 ring-white/10">
                  <I className="size-3.5 text-brand-400" strokeWidth={1.75} /> {label as string}
                </li>
              );
            })}
          </ul>

          <Flow reduce={reduce} />

          <ul className="mt-8 space-y-2.5 text-[15px] text-white/80">
            {[
              [KeyRound, "Clés API sécurisées, créées et révoquées en un clic depuis vos réglages"],
              [Repeat, "Désinscriptions respectées : un contact désinscrit le reste, partout"],
              [ShoppingBag, "Sur Shopify ? La connexion native se fait sans une ligne de code"],
            ].map(([Icon, t]) => {
              const I = Icon as typeof KeyRound;
              return (
                <li key={t as string} className="flex items-start gap-2.5">
                  <I className="mt-0.5 size-4 shrink-0 text-brand-400" strokeWidth={1.75} /> {t as string}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Code window */}
        <div ref={ref} className="min-w-0">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 30, rotateX: 10, transformPerspective: 1200 }}
            animate={shown ? { opacity: 1, y: 0, rotateX: 0 } : undefined}
            transition={{ duration: 0.9, ease: EASE }}
            className="overflow-hidden rounded-[22px] bg-[#0a1630] shadow-[0_40px_120px_-40px_rgba(20,92,255,0.6)] ring-1 ring-white/10"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
              <span className="hidden gap-1.5 sm:flex">
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
              </span>
              <div role="group" aria-label="Langage" className="flex rounded-full bg-white/[0.06] p-0.5">
                {Object.keys(SNIPPETS).map((k) => {
                  const on = tab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTab(k)}
                      className={`relative rounded-full px-3 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "text-slate-900" : "text-white/60 hover:text-white"}`}
                    >
                      {on && (
                        <motion.span
                          layoutId="api-tab"
                          className="absolute inset-0 rounded-full bg-white"
                          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className="relative">{k}</span>
                    </button>
                  );
                })}
              </div>
              <span className="ml-auto font-mono text-[10px] text-white/40">POST /contacts</span>
            </div>

            <div className="relative overflow-x-auto px-4 py-4 sm:px-5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.pre
                  key={tab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                  className="font-mono text-[11.5px] leading-[1.75] text-white/85 sm:text-[12.5px]"
                >
                  {lines.map((l, i) => (
                    <motion.span
                      key={i}
                      className="block whitespace-pre"
                      initial={reduce ? false : { opacity: 0, x: -8 }}
                      animate={shown ? { opacity: 1, x: 0 } : undefined}
                      transition={{ duration: 0.35, delay: reduce ? 0 : 0.25 + i * 0.05, ease: EASE }}
                    >
                      <span className="mr-4 inline-block w-4 text-right text-white/20 select-none">{i + 1}</span>
                      <Line text={l} />
                    </motion.span>
                  ))}
                </motion.pre>
              </AnimatePresence>
            </div>

            {/* Response */}
            <motion.div
              key={`res-${tab}`}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={shown ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.5, delay: responseDelay, ease: EASE }}
              className="border-t border-white/[0.07] bg-white/[0.03] px-4 py-3 sm:px-5"
            >
              <p className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-semibold text-emerald-300">201 Created</span>
                <span className="text-white/60">Contact créé (ou mis à jour s'il existe déjà)</span>
              </p>
              <p className="mt-2 flex items-center gap-2 text-[12px] text-white/80">
                <Check className="size-3.5 text-brand-400" /> Automatisation « Bienvenue » déclenchée pour camille@exemple.fr
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-px overflow-hidden rounded-[22px] bg-white/[0.07] px-0 ring-1 ring-white/[0.07] sm:mx-6 sm:grid-cols-2 lg:mx-auto lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="reveal bg-slate-950 p-6 sm:p-7" style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
            <f.icon className="size-5 text-brand-400" strokeWidth={1.75} />
            <h3 className="mt-4 font-display text-lg font-bold">{f.title}</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/60">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Your software → Pingsell API → automation → email, with a travelling pulse. */
function Flow({ reduce }: { reduce: boolean }) {
  const [src, setSrc] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setSrc((i) => (i + 1) % FLOW_SOURCES.length), 2600);
    return () => window.clearInterval(id);
  }, [reduce]);
  const steps = [
    ["Source", FLOW_SOURCES[src]],
    ["API", "API Pingsell"],
    ["Scénario", "Automatisation"],
    ["Email", "Email envoyé"],
  ];
  return (
    <div className="mt-8 flex items-center">
      {steps.map(([short, long], i) => (
        <div key={i} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10.5px] font-semibold whitespace-nowrap ring-1 sm:px-3 sm:text-[11.5px] ${
              i === 1 ? "bg-brand-500 text-white ring-brand-400" : "bg-white/[0.06] text-white/80 ring-white/10"
            }`}
          >
            {i === 0 ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={long}
                  className="inline-block"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                >
                  <span className="sm:hidden">{cap(long.replace("Votre ", ""))}</span>
                  <span className="hidden sm:inline">{long}</span>
                </motion.span>
              </AnimatePresence>
            ) : (
              <>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{long}</span>
              </>
            )}
          </span>
          {i < steps.length - 1 && (
            <span className="relative mx-1 h-px min-w-3 flex-1 bg-white/15">
              {!reduce && (
                <motion.span
                  className="absolute -top-[2px] left-0 size-[5px] rounded-full bg-brand-400 shadow-[0_0_10px_2px_rgba(77,130,255,0.8)]"
                  animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.8, delay: i * 0.6, ease: "easeInOut" }}
                />
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

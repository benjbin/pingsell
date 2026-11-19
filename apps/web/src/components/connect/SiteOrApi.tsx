import { useState } from "react";
import { Activity, ArrowRight, Check, Code2, type LucideIcon } from "lucide-react";
import { cx } from "../../lib/format";
import { t } from "../../lib/i18n";

type Choice = "suivi" | "site";

const SIDES: Record<Choice, { icon: LucideIcon; title: string; tagline: string; who: string; sees: string; limit: string; example: [string, string] }> = {
  suivi: {
    icon: Activity,
    title: t("Vos sites", "Your sites"),
    tagline: t("Pingsell regarde votre site", "Pingsell watches your site"),
    who: t("Vous, en 2 minutes, sans développeur : une ligne à coller.", "You, in 2 minutes, no developer: one line to paste."),
    sees: t(
      "Ce que le visiteur fait à l'écran : pages et produits vus, compte créé, inscription newsletter, formulaire de contact envoyé.",
      "What the visitor does on screen: pages and products viewed, account created, newsletter sign-up, contact form sent.",
    ),
    limit: t(
      "Il voit qu'un formulaire est parti, pas ce que votre site en fait ensuite (rendez-vous accepté, paiement validé…).",
      "It sees a form was sent, not what your site does with it next (booking accepted, payment confirmed…).",
    ),
    example: [
      t("Quelqu'un remplit votre formulaire de contact", "Someone fills in your contact form"),
      t("il reçoit « Nous avons bien reçu votre demande ».", "they get “We've received your request”."),
    ],
  },
  site: {
    icon: Code2,
    title: t("Site sur mesure", "Custom website"),
    tagline: t("Votre site prévient Pingsell", "Your site tells Pingsell"),
    who: t("Votre développeur, une seule fois : un appel à ajouter dans le code du site.", "Your developer, once: one call to add to the site's code."),
    sees: t(
      "Un événement précis que vous nommez, avec ses infos : une date, un montant, un numéro de commande…",
      "A precise event you name, with its details: a date, an amount, an order number…",
    ),
    limit: t("Il faut quelqu'un qui sache modifier le code du site.", "You need someone who can edit the site's code."),
    example: [
      t("Un rendez-vous est confirmé pour le 12 décembre à 15 h", "A booking is confirmed for 12 December at 3 pm"),
      t("le client reçoit un rappel la veille, avec la date et l'heure.", "the customer gets a reminder the day before, with the date and time."),
    ],
  },
};

/**
 * « Vos sites » ou « Site sur mesure » ? Explique la différence avec des exemples
 * et aide à choisir par une seule question, en haut des deux guides.
 */
export function SiteOrApiChooser({ current, onOpen }: { current: Choice; onOpen: (c: Choice) => void }) {
  const [answer, setAnswer] = useState<Choice | null>(null);
  return (
    <section className="mb-8 rounded-3xl bg-slate-50 p-5 sm:p-6 dark:bg-white/[0.04]">
      <p className="eyebrow">{t("Avant de commencer", "Before you start")}</p>
      <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">
        {t("Vos sites ou Site sur mesure : lequel vous faut-il ?", "Your sites or Custom website: which one do you need?")}
      </h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {t(
          "Les deux servent à lancer vos automatisations à partir de ce qui se passe sur votre site. La différence : qui raconte à Pingsell ce qui s'est passé.",
          "Both start your automations from what happens on your site. The difference: who tells Pingsell what happened.",
        )}
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {(Object.keys(SIDES) as Choice[]).map((id) => {
          const s = SIDES[id];
          const here = id === current;
          const advised = answer === id;
          return (
            <div
              key={id}
              className={cx(
                "flex flex-col rounded-2xl bg-white p-4 ring-1 transition dark:bg-slate-900",
                advised ? "ring-2 ring-brand-500" : "ring-slate-900/10 dark:ring-white/10",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                  <s.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[15px] font-bold text-slate-900 dark:text-white">{s.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{s.tagline}</span>
                </span>
                {advised && (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    <Check className="size-3" /> {t("Pour vous", "For you")}
                  </span>
                )}
              </div>
              <dl className="mt-3 space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
                <div>
                  <dt className="font-semibold text-slate-900 dark:text-white">{t("Qui l'installe", "Who sets it up")}</dt>
                  <dd>{s.who}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900 dark:text-white">{t("Ce que Pingsell apprend", "What Pingsell learns")}</dt>
                  <dd>{s.sees}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900 dark:text-white">{t("Sa limite", "Its limit")}</dt>
                  <dd>{s.limit}</dd>
                </div>
              </dl>
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700 dark:bg-white/[0.05] dark:text-slate-200">
                <span className="font-semibold">{t("Exemple : ", "Example: ")}</span>
                {s.example[0]} <ArrowRight className="inline size-3.5 text-brand-500" /> {s.example[1]}
              </p>
              <div className="mt-auto pt-3">
                {here ? (
                  <span className="text-xs font-semibold text-slate-500">{t("Le guide est juste en dessous ↓", "The guide is right below ↓")}</span>
                ) : (
                  <button type="button" onClick={() => onOpen(id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                    {t(`Ouvrir le guide ${s.title}`, `Open the ${s.title} guide`)} <ArrowRight className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {t(
            "Une seule question : ce que vous voulez suivre, votre visiteur le fait-il à l'écran ?",
            "One question: is what you want to track something your visitor does on screen?",
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["suivi", t("Oui : il visite, remplit un formulaire, crée un compte", "Yes: they visit, fill in a form, create an account")],
              ["site", t("Non : ça se décide après, sur notre serveur (paiement, validation, annulation)", "No: it's decided later, on our server (payment, approval, cancellation)")],
            ] as Array<[Choice, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAnswer(id)}
              className={cx(
                "rounded-full px-3.5 py-2 text-left text-xs font-semibold transition",
                answer === id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {answer && (
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            {answer === "suivi"
              ? t(
                  "Prenez « Vos sites » : collez la ligne et c'est fini, aucun développeur. C'est le bon choix pour la grande majorité des sites.",
                  "Go with “Your sites”: paste the line and you're done, no developer. It's the right choice for most sites.",
                )
              : t(
                  "Prenez « Site sur mesure » : transmettez le guide à votre développeur, il ajoute un appel dans le code. Gardez aussi « Vos sites » pour les formulaires et les pages vues.",
                  "Go with “Custom website”: hand the guide to your developer, who adds one call in the code. Keep “Your sites” too for forms and page views.",
                )}{" "}
            {answer !== current && (
              <button type="button" onClick={() => onOpen(answer)} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                {t("Ouvrir ce guide →", "Open this guide →")}
              </button>
            )}
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t(
            "Les deux se cumulent sans doublon. Dans le doute, commencez par « Vos sites » : vous ajouterez « Site sur mesure » plus tard si un besoin apparaît.",
            "Both work together without duplicates. If unsure, start with “Your sites”: add “Custom website” later if a need comes up.",
          )}
        </p>
      </div>
    </section>
  );
}

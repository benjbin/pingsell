import { ArrowRight, Check, KeyRound, Link2, Smartphone, Code2, type LucideIcon } from "lucide-react";
import { cx } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { PushSetup } from "../../lib/usePushSetup";

interface Step {
  icon: LucideIcon;
  title: string;
  who: string;
  todo: string;
  done: string;
  ok: boolean;
  action?: string;
}

/**
 * Ce qu'il faut pour envoyer des notifications push, en 4 étapes, avec ce qui est fait et ce qui manque.
 * Affiché en haut de la page tant que tout n'est pas prêt.
 */
export function PushSetupGuide({ setup, onSetup }: { setup: PushSetup; onSetup: () => void }) {
  const steps: Step[] = [
    {
      icon: Smartphone,
      title: t("Avoir votre application mobile", "Have your own mobile app"),
      who: t("Vous", "You"),
      todo: t(
        "Les notifications push partent sur votre propre app iOS ou Android, publiée sur l'App Store ou Google Play. Pas d'app ? Cette page ne vous concerne pas : vos emails et vos automatisations fonctionnent sans.",
        "Push notifications go to your own iOS or Android app, published on the App Store or Google Play. No app? This page isn't for you: your emails and automations work without it.",
      ),
      done: t("Votre app est branchée.", "Your app is connected."),
      ok: setup.key || setup.devices > 0,
    },
    {
      icon: KeyRound,
      title: t("Donner la clé d'envoi à Pingsell", "Give Pingsell the sending key"),
      who: t("Vous ou votre développeur, 5 minutes", "You or your developer, 5 minutes"),
      todo: t(
        "Apple et Google n'acceptent les notifications que de quelqu'un d'autorisé. Collez une seule de ces clés : Firebase (Android et iOS), APNs (iOS) ou Expo (app faite avec Expo).",
        "Apple and Google only accept notifications from someone authorised. Paste just one of these keys: Firebase (Android and iOS), APNs (iOS) or Expo (app built with Expo).",
      ),
      done: t("Clé d'envoi enregistrée.", "Sending key saved."),
      ok: setup.key,
      action: t("Ajouter la clé", "Add the key"),
    },
    {
      icon: Code2,
      title: t("Ajouter Pingsell dans l'app", "Add Pingsell to the app"),
      who: t("Votre développeur, une seule fois", "Your developer, once"),
      todo: t(
        "Il colle la clé de votre application et quelques lignes de code, puis publie une mise à jour. Chaque téléphone qui ouvre l'app apparaît alors dans « Appareils ».",
        "They paste your app key and a few lines of code, then publish an update. Each phone that opens the app then shows up under “Devices”.",
      ),
      done:
        setup.devices > 1
          ? t(`${setup.devices} appareils enregistrés.`, `${setup.devices} devices registered.`)
          : t("1 appareil enregistré.", "1 device registered."),
      ok: setup.devices > 0,
      action: t("Voir la clé et le code à transmettre", "See the key and code to hand over"),
    },
    {
      icon: Link2,
      title: t("Relier les téléphones à vos contacts", "Link phones to your contacts"),
      who: t("Votre développeur", "Your developer"),
      todo: t(
        "Quand quelqu'un se connecte dans l'app, elle envoie son email à Pingsell. Sans ça, vous pouvez écrire à tous les appareils, mais pas cibler un segment, un tag ni lancer une automatisation.",
        "When someone signs in to the app, it sends their email to Pingsell. Without it, you can message every device, but not target a segment or tag, nor start an automation.",
      ),
      done:
        setup.linked > 1
          ? t(`${setup.linked} appareils reliés à un contact.`, `${setup.linked} devices linked to a contact.`)
          : t("1 appareil relié à un contact.", "1 device linked to a contact."),
      ok: setup.linked > 0,
      action: t("Voir comment faire", "See how"),
    },
  ];
  const doneCount = steps.filter((s) => s.ok).length;
  // Step 1 is only something to check, so the first step to act on is from step 2.
  const current = steps.findIndex((s, i) => i > 0 && !s.ok);

  return (
    <section className="mb-8 rounded-3xl bg-slate-50 p-5 sm:p-6 dark:bg-white/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t("À configurer", "To set up")}</p>
          <h2 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">
            {t("Ce qu'il faut pour envoyer des notifications push", "What you need to send push notifications")}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {doneCount === 0
              ? t("Rien n'est encore branché. Suivez les étapes dans l'ordre.", "Nothing is connected yet. Follow the steps in order.")
              : t("Ce qui est fait est coché ; l'étape en cours est encadrée.", "What's done is ticked; the current step is outlined.")}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/10 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/10">
          {t(`${doneCount} / 4 fait`, `${doneCount} / 4 done`)}
        </span>
      </div>

      <ol className="mt-5 grid gap-3 md:grid-cols-2">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={s.title}
              className={cx(
                "flex gap-3 rounded-2xl bg-white p-4 ring-1 dark:bg-slate-900",
                isCurrent ? "ring-2 ring-brand-500" : "ring-slate-900/10 dark:ring-white/10",
                !s.ok && !isCurrent && i > 0 && "opacity-70",
              )}
            >
              <span
                className={cx(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  s.ok ? "bg-emerald-500 text-white" : isCurrent ? "bg-brand-500 text-white" : "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300",
                )}
                aria-hidden="true"
              >
                {s.ok ? <Check className="size-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-display text-[15px] font-bold text-slate-900 dark:text-white">
                  <s.icon className="size-4 shrink-0 text-slate-400" /> {s.title}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {s.ok ? t("Fait", "Done") : s.who}
                  <span className="sr-only">{s.ok ? "" : t(" — à faire", " — to do")}</span>
                </p>
                <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">{s.ok ? s.done : s.todo}</p>
                {!s.ok && isCurrent && s.action && (
                  <button
                    type="button"
                    onClick={onSetup}
                    className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300"
                  >
                    {s.action} <ArrowRight className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

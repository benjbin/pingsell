import { Link } from "react-router";
import { AlertTriangle, CalendarClock, CheckCircle2, PauseCircle, Plus, Radio } from "lucide-react";
import { api } from "../../lib/api";
import { formatShortDate } from "../../lib/format";
import { t, LOCALE } from "../../lib/i18n";
import { TRIGGERS } from "../../lib/constants";
import { useAsync } from "../../lib/useAsync";
import type { Automation, AutomationTrigger } from "../../lib/types";
import { RECIPES } from "../../pages/automations/recipes";
import { Badge, Skeleton } from "../ui/primitives";
import { EventSnippet } from "./ConnectGuides";

/** Non-breaking space, for French typography (« x », before : ; ? !). */
const NB = " ";
const q = (s: string) => t(`«${NB}${s}${NB}»`, `“${s}”`);

/** « Rappel Réservation » → « rappel_reservation », exactly like the API. */
export const eventSlug = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

/**
 * Names the API handles itself (mirror of BUILTIN_EVENTS in apps/api/src/services/ingest.ts):
 * they never reach an « Événement » automation, the matching built-in trigger fires instead.
 */
const BUILTIN: Record<string, AutomationTrigger> = Object.fromEntries([
  ...["inscription", "contact", "nouveau_client", "client", "signup", "sign_up", "newsletter", "subscribe"].map((n) => [n, "contact_created" as const]),
  ...["panier", "cart", "checkout", "panier_en_cours"].map((n) => [n, "cart_abandoned" as const]),
  ...["commande", "order", "achat", "purchase", "commande_passee", "order_created"].map((n) => [n, "order_created" as const]),
  ...["expedition", "shipped", "shipping", "livraison", "commande_expediee", "order_fulfilled", "fulfilled"].map((n) => [n, "order_fulfilled" as const]),
]);
export const builtinTrigger = (name: string): AutomationTrigger | undefined => BUILTIN[eventSlug(name)];

export type ReceivedEvent = { name: string; count: number; last_at: string };

const listenedEvent = (a: Automation) => (a.trigger === "event" && typeof a.trigger_config?.event === "string" ? eventSlug(a.trigger_config.event) : "");

/** Where « Créer l'automatisation » goes: a ready-made recipe when one listens to this name. */
export function newAutomationUrl(name: string): string {
  const recipe = RECIPES.find((r) => r.trigger === "event" && r.trigger_config?.event === name);
  return recipe ? `/automatisations/nouvelle?modele=${recipe.id}` : `/automatisations/nouvelle?evenement=${encodeURIComponent(name)}`;
}

function received(ev: ReceivedEvent): string {
  const n = ev.count.toLocaleString(LOCALE);
  const day = formatShortDate(ev.last_at);
  return ev.count > 1 ? t(`${n} fois, dernier le ${day}`, `${n} times, last on ${day}`) : t(`1 fois, le ${day}`, `once, on ${day}`);
}

/**
 * Warning for an automation listening to a name the site never sent.
 * `onUseTrigger` (editor) switches to the built-in trigger; otherwise a link opens the automation.
 */
export function EventNeverSent({ event, automationId, onUseTrigger }: { event: string; automationId?: string; onUseTrigger?: (tr: AutomationTrigger) => void }) {
  const builtin = builtinTrigger(event);
  if (builtin) {
    const label = TRIGGERS[builtin].label;
    return (
      <div className="flex gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 space-y-1.5">
          <p>
            {t(
              `${q(event)} est un nom que Pingsell gère déjà lui-même${NB}: quand votre site l'envoie, c'est le déclencheur ${q(label)} qui part, jamais une automatisation ${q(TRIGGERS.event.label)}. Celle-ci ne se déclenchera donc pas.`,
              `${q(event)} is a name Pingsell already handles itself: when your site sends it, the ${q(label)} trigger fires, never an ${q(TRIGGERS.event.label)} automation. This one will therefore never start.`,
            )}
          </p>
          {onUseTrigger ? (
            <button type="button" onClick={() => onUseTrigger(builtin)} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
              {t(`Utiliser le déclencheur ${q(label)}`, `Use the ${q(label)} trigger`)}
            </button>
          ) : automationId ? (
            <Link to={`/automatisations/${automationId}`} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
              {t(`Choisir le déclencheur ${q(label)}`, `Switch to the ${q(label)} trigger`)}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
      <p className="flex gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <span>
          {t(
            `Votre site n'envoie pas encore ${q(event)}${NB}: cette automatisation ne se déclenchera pas. Ajoutez cet appel dans votre site, à l'endroit où cela se produit${NB}:`,
            `Your site doesn't send ${q(event)} yet: this automation won't start. Add this call to your site, where it happens:`,
          )}
        </span>
      </p>
      <EventSnippet event={event} />
    </div>
  );
}

/** « Ce que votre site envoie à Pingsell »: received events, who listens, and automations waiting for nothing. */
export function SiteEventsPanel() {
  const data = useAsync(async () => {
    const [events, automations] = await Promise.all([api.automations.eventNames(), api.automations.list()]);
    return { events, automations };
  }, []);

  if (data.loading && !data.data) return <Skeleton className="h-28 w-full" />;
  if (!data.data) return null;

  const { events, automations } = data.data;
  const listeners = automations.filter((a) => listenedEvent(a));
  const sent = new Set(events.map((ev) => eventSlug(ev.name)));
  const waiting = listeners.filter((a) => !sent.has(listenedEvent(a)));

  return (
    <section className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-slate-900 dark:text-white">
          <Radio className="size-4 text-brand-500" /> {t("Ce que votre site envoie à Pingsell", "What your site sends to Pingsell")}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t(
            `Chaque appel de votre site porte un nom d'événement. Une automatisation n'envoie un message que si elle écoute exactement ce nom${NB}; sinon, l'événement est enregistré sur la fiche du client, sans plus.`,
            "Every call from your site carries an event name. An automation only sends a message if it listens to exactly that name; otherwise the event is just recorded on the customer's record.",
          )}
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3.5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t(
            `Votre site n'a encore envoyé aucun événement à Pingsell. Dès le premier appel, il apparaîtra ici avec ce qu'il déclenche.`,
            "Your site hasn't sent any event to Pingsell yet. As soon as the first call arrives, it will show up here with what it triggers.",
          )}
        </p>
      ) : (
        <ul className="divide-y divide-slate-900/5 overflow-hidden rounded-2xl ring-1 ring-slate-900/10 dark:divide-white/5 dark:ring-white/10">
          {events.map((ev) => {
            const mine = listeners.filter((a) => listenedEvent(a) === eventSlug(ev.name));
            const active = mine.filter((a) => a.status === "active");
            const paused = mine.filter((a) => a.status !== "active");
            return (
              <li key={ev.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <code className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{ev.name}</code>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{received(ev)}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm sm:justify-end">
                  {active.length > 0 ? (
                    active.map((a) => (
                      <Link key={a.id} to={`/automatisations/${a.id}`} className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="size-4 shrink-0" />
                        <span className="truncate">{t(`Déclenche ${q(a.name)}`, `Starts ${q(a.name)}`)}</span>
                      </Link>
                    ))
                  ) : paused.length > 0 ? (
                    paused.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <PauseCircle className="size-4 shrink-0 text-amber-500" />
                        <span>
                          {t(`${q(a.name)} est en pause, rien ne part`, `${q(a.name)} is paused, nothing goes out`)}
                          {" · "}
                          <Link to={`/automatisations/${a.id}`} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                            {t("Ouvrir", "Open")}
                          </Link>
                        </span>
                      </span>
                    ))
                  ) : (
                    <>
                      <Badge tone="slate">{t("Aucune automatisation", "No automation")}</Badge>
                      <Link
                        to={newAutomationUrl(ev.name)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
                      >
                        <Plus className="size-3.5" /> {t("Créer l'automatisation", "Create the automation")}
                      </Link>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {waiting.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <CalendarClock className="size-4 text-amber-500" />
            {t(
              `Automatisations qui attendent un événement que votre site n'envoie pas`,
              "Automations waiting for an event your site doesn't send",
            )}
          </h4>
          {waiting.map((a) => (
            <div key={a.id} className="space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Link to={`/automatisations/${a.id}`} className="font-semibold text-slate-900 hover:text-brand-600 dark:text-white">
                  {a.name}
                </Link>
                <Badge tone={a.status === "active" ? "green" : "slate"} dot>
                  {a.status === "active" ? t("Active", "Active") : t("En pause", "Paused")}
                </Badge>
              </p>
              <EventNeverSent event={listenedEvent(a)} automationId={a.id} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

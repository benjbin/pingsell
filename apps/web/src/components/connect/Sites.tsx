import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Check, ClipboardList, Globe, LogIn, MessageSquareText, Newspaper, Pencil, Plus, Radar, RefreshCw, Trash2, UserRoundPlus, X, type LucideIcon } from "lucide-react";
import { api } from "../../lib/api";
import { SITE_ACTIONS, siteLabel } from "../../lib/constants";
import { cx, formatRelative, formatShortDate } from "../../lib/format";
import { t, LOCALE } from "../../lib/i18n";
import type { SiteActionKind, WebSite, WebSiteAction } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { Input, Skeleton } from "../ui/primitives";
import { ConfirmModal } from "../ui/Overlay";
import { useToast } from "../ui/Toast";
import { Waiting } from "./ConnectGuides";

/** Non-breaking space, for French typography (« x », before : ; ? !). */
const NB = " ";
const q = (s: string) => t(`«${NB}${s}${NB}»`, `“${s}”`);

export const SITE_ACTION_ICONS: Record<SiteActionKind, LucideIcon> = {
  signup: UserRoundPlus,
  login: LogIn,
  newsletter: Newspaper,
  contact: MessageSquareText,
  form: ClipboardList,
};

/** Editor link that starts an automation on this action (see the shared contract). */
export function siteActionUrl(host: string | null, action: SiteActionKind, form?: string | null): string {
  const p = new URLSearchParams({ declencheur: "site_action", action });
  if (host) p.set("site", host);
  if (form) p.set("form", form);
  return `/automatisations/nouvelle?${p.toString()}`;
}

export function timesSeen(count: number, lastAt: string): string {
  const n = count.toLocaleString(LOCALE);
  const day = formatShortDate(lastAt);
  return count > 1 ? t(`${n} fois, la dernière le ${day}`, `${n} times, last on ${day}`) : t(`1 fois, le ${day}`, `once, on ${day}`);
}

/** Sites list (GET /inbound/sites); when the route is missing, an empty list. */
export function useSites() {
  return useAsync(() => api.inbound.sites().catch(() => [] as WebSite[]), []);
}

/**
 * « Vos sites »: every site recognised by its domain, and what Pingsell spotted on each.
 * Refreshes by itself every few seconds while nothing has been spotted yet.
 */
/** Live refresh stops after this long; « Actualiser » takes over. */
const LIVE_FOR_MS = 10 * 60 * 1000;

export function SitesPanel({ onFirstSite, onFirstAction, captureOff }: { onFirstSite?: () => void; onFirstAction?: () => void; captureOff?: boolean }) {
  const sites = useSites();
  const list = sites.data;
  const hasAction = !!list?.some((s) => s.actions.length > 0);
  const [expired, setExpired] = useState(false);
  const waiting = !!list && !hasAction && !expired;

  // Live while empty (10 minutes at most): the first page or the first test action shows up on its own.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > LIVE_FOR_MS) setExpired(true);
      else void sites.reload();
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const refresh = (
    <button
      type="button"
      onClick={() => void sites.reload()}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <RefreshCw className={cx("size-3.5", sites.loading && "animate-spin")} /> {t("Actualiser", "Refresh")}
    </button>
  );
  const who = (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {t(
        `Une création de compte ou une inscription newsletter ajoute la personne à vos contacts, abonnée. Un formulaire de contact ou un autre formulaire l'ajoute sans l'abonner : elle reçoit la réponse à sa demande, jamais vos campagnes. Une connexion ne lance une automatisation que pour une personne déjà dans vos contacts. Si vous attendez l'accord cookies, rien n'est repéré chez un visiteur qui ne l'a pas donné.`,
        "An account creation or a newsletter sign-up adds the person to your contacts, subscribed. A contact form or another form adds them without subscribing them: they get the answer to their request, never your campaigns. A sign-in only starts an automation for someone already in your contacts. If you wait for cookie consent, nothing is spotted for a visitor who hasn't given it.",
      )}
    </p>
  );
  const off = captureOff ? (
    <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
      {t(
        `Le repérage des actions est désactivé${NB}: Pingsell ne repère plus les comptes, connexions ni formulaires. Réactivez-le plus bas, dans ${q("Réglez la confidentialité")} (le suivi des visites doit aussi être coché).`,
        "Action spotting is turned off: Pingsell no longer spots accounts, sign-ins or forms. Turn it back on below, in “Set privacy” (visit tracking must be ticked too).",
      )}
    </p>
  ) : null;

  const before = useRef<{ sites: number; actions: boolean } | null>(null);
  useEffect(() => {
    if (!list) return;
    if (!before.current) {
      before.current = { sites: list.length, actions: hasAction };
      return;
    }
    if (list.length > before.current.sites && before.current.sites === 0) onFirstSite?.();
    if (hasAction && !before.current.actions) onFirstAction?.();
    before.current = { sites: list.length, actions: hasAction };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  if (!list) return <Skeleton className="h-32 w-full" />;

  if (list.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 p-4 sm:p-5 dark:border-slate-700">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{t("Aucun site repéré pour l'instant. Deux choses à faire :", "No site spotted yet. Two things to do:")}</p>
        <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900">1</span>
            <span>{t("Collez la ligne ci-dessus dans l'en-tête de votre site, puis publiez-le.", "Paste the line above in your site's header, then publish it.")}</span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900">2</span>
            <span>{t("Faites un essai : créez un compte de test sur votre site (ou remplissez un formulaire avec votre email).", "Try it: create a test account on your site (or fill in a form with your email).")}</span>
          </li>
        </ol>
        {waiting ? <Waiting>{t("Votre site apparaîtra ici tout seul, en quelques secondes.", "Your site will show up here on its own, within seconds.")}</Waiting> : refresh}
        {off}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {off}
      {list.map((site) => (
        <SiteCard
          key={site.host}
          site={site}
          onRenamed={(name) => sites.setData((prev) => (prev ?? []).map((s) => (s.host === site.host ? { ...s, name } : s)))}
          onRemoved={() => sites.setData((prev) => (prev ?? []).filter((s) => s.host !== site.host))}
        />
      ))}
      {waiting ? (
        <Waiting>
          {t(
            "Faites un essai : créez un compte de test sur votre site. Il apparaîtra ici tout seul, en quelques secondes.",
            "Try it: create a test account on your site. It will show up here on its own, within seconds.",
          )}
        </Waiting>
      ) : (
        refresh
      )}
      {who}
    </div>
  );
}

function SiteCard({ site, onRenamed, onRemoved }: { site: WebSite; onRenamed: (name: string | null) => void; onRemoved: () => void }) {
  const toast = useToast();
  const actions = [...site.actions].sort((a, b) => b.last_at.localeCompare(a.last_at));
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await api.inbound.removeSite(site.host);
      setConfirm(false);
      onRemoved();
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-900/10 dark:ring-white/10">
      <div className="flex flex-col gap-2 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-800/60">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-500 ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
            <Globe className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <SiteName site={site} onRenamed={onRenamed} />
            {site.name && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{site.host}</span>
              </p>
            )}
          </div>
        </div>
        <p className="shrink-0 text-xs text-slate-500 sm:text-right dark:text-slate-400">
          {t(`${site.pageviews.toLocaleString(LOCALE)} page${site.pageviews > 1 ? "s" : ""} vue${site.pageviews > 1 ? "s" : ""}`, `${site.pageviews.toLocaleString(LOCALE)} page view${site.pageviews === 1 ? "" : "s"}`)}
          <span className="mx-1.5">·</span>
          {t("dernière visite ", "last visit ")}
          {formatRelative(site.last_seen)}
          <span className="mx-1.5">·</span>
          <button type="button" onClick={() => setConfirm(true)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400">
            <Trash2 className="size-3.5" /> {t("Retirer ce site", "Remove this site")}
          </button>
        </p>
      </div>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
        loading={removing}
        danger
        title={t(`Retirer ${q(siteLabel(site))}${NB}?`, `Remove ${q(siteLabel(site))}?`)}
        description={t(
          "Le site et ce que Pingsell y a repéré disparaissent de cette liste. Vos contacts et l'historique de leurs visites restent. Si la ligne Pingsell est toujours sur ce site, il reviendra à la prochaine visite\u00a0: retirez-la aussi du site si vous ne l'utilisez plus.",
          "The site and what Pingsell spotted there disappear from this list. Your contacts and their visit history stay. If the Pingsell line is still on that site, it will come back on the next visit: remove it from the site too if you no longer use it.",
        )}
        confirmLabel={t("Retirer le site", "Remove the site")}
      />

      <div className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <Radar className="size-3.5 text-brand-500" /> {t("Ce que Pingsell a repéré", "What Pingsell spotted")}
        </p>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t(
              `Pas encore d'action sur ce site. Faites un essai${NB}: créez un compte de test ou remplissez un formulaire avec votre email.`,
              "No action on this site yet. Try it: create a test account or fill in a form with your email.",
            )}
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-900/5 dark:divide-white/5">
            {actions.map((a) => (
              <ActionRow key={`${a.kind}|${a.form_key}`} host={site.host} action={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActionRow({ host, action: a }: { host: string; action: WebSiteAction }) {
  const Icon = SITE_ACTION_ICONS[a.kind] ?? ClipboardList;
  const meta = SITE_ACTIONS[a.kind] ?? SITE_ACTIONS.form;
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-brand-500" />
        <div className="min-w-0">
          <p className="text-sm text-slate-900 dark:text-white">
            <span className="font-semibold">{meta.label}</span>
            {a.label && <span className="text-slate-600 dark:text-slate-300"> · {q(a.label)}</span>}
          </p>
          <p className="text-xs break-all text-slate-500 sm:truncate sm:break-normal dark:text-slate-400">
            {a.path && (
              <>
                {t("page ", "page ")}
                <span className="font-mono">{a.path}</span>
                {" · "}
              </>
            )}
            {timesSeen(a.count, a.last_at)}
          </p>
        </div>
      </div>
      <Link
        to={siteActionUrl(host, a.kind, a.form_key)}
        className="inline-flex shrink-0 items-center gap-1 self-start rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 sm:self-auto"
      >
        <Plus className="size-3.5" /> {t("Créer une automatisation", "Create an automation")}
      </Link>
    </li>
  );
}

/** Inline-editable site name (PATCH /inbound/sites/:host, empty = back to the domain). */
function SiteName({ site, onRenamed }: { site: WebSite; onRenamed: (name: string | null) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(site.name ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const name = value.trim();
    if (name === (site.name ?? "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.inbound.renameSite(site.host, name);
      onRenamed(name || null);
      setEditing(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          autoFocus
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(site.name ?? "");
              setEditing(false);
            }
          }}
          placeholder={site.host}
          aria-label={t("Nom du site", "Site name")}
          className="h-8 min-w-0 flex-1 text-sm"
          disabled={busy}
        />
        <button type="submit" disabled={busy} aria-label={t("Enregistrer le nom", "Save the name")} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30">
          <Check className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(site.name ?? "");
            setEditing(false);
          }}
          aria-label={t("Annuler", "Cancel")}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="size-4" />
        </button>
      </form>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(site.name ?? "");
        setEditing(true);
      }}
      className="group flex max-w-full items-center gap-1.5 text-left"
      title={t("Renommer ce site", "Rename this site")}
    >
      <span className="truncate font-display text-[15px] font-bold text-slate-900 dark:text-white">{siteLabel(site)}</span>
      <Pencil className="size-3.5 shrink-0 text-slate-400 group-hover:text-brand-500" />
      {!site.name && <span className="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400">{t("Nommer", "Name it")}</span>}
    </button>
  );
}

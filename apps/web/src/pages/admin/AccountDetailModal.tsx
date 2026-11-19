import type { ReactNode } from "react";
import { CAMPAIGN_STATUS, TRIGGERS } from "../../lib/constants";
import type { AutomationTrigger, CampaignStatus } from "../../lib/types";

import { Modal } from "../../components/ui/Overlay";
import { Badge, ErrorState, Skeleton } from "../../components/ui/primitives";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminAccountDetail } from "../../lib/types";
import { DomainCell } from "./AccountsTab";
import { DailyChart, fmtRate, HealthBadge, INTEGRATION_LABEL } from "./shared";

const ROLE_LABEL: Record<string, string> = { owner: t("Propriétaire", "Owner"), admin: t("Administrateur", "Admin"), editor: t("Éditeur", "Editor") };

export function AccountDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={t("Détail du compte", "Account details")}>
      {id && <Detail id={id} />}
    </Modal>
  );
}

function Detail({ id }: { id: string }) {
  const state = useAsync(() => api.admin.account(id), [id]);
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  return <DetailBody d={state.data} />;
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-100/80 px-3.5 py-3 dark:bg-white/5">
      <p className="truncate text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate font-display text-lg font-bold text-slate-900 tabular-nums dark:text-white">{value}</p>
      {hint && <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 flex items-baseline gap-2 font-display text-[13px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">
        {title}
        {count !== undefined && <span className="font-sans text-xs font-medium text-slate-400 normal-case tabular-nums">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

/** Small table that scrolls sideways inside the modal on phones. */
function Mini({ head, rows, empty, minWidth = 460 }: { head: Array<{ label: string; right?: boolean }>; rows: ReactNode[][]; empty: string; minWidth?: number }) {
  if (!rows.length) return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="bg-slate-50 text-[11px] font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:bg-white/[0.03] dark:text-slate-400">
          <tr>
            {head.map((h) => (
              <th key={h.label} className={`px-3 py-2 font-medium ${h.right ? "text-right" : ""}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className={`px-3 py-2 text-slate-700 dark:text-slate-300 ${head[j]?.right ? "text-right tabular-nums" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const muted = (s: ReactNode) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{s}</span>;

function DetailBody({ d }: { d: AdminAccountDetail }) {
  const a = d.account;
  const sent30 = d.timeseries.reduce((s, x) => s + x.emails_sent, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900 dark:text-white">{a.name || "—"}</p>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{a.email}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(`Créé le ${formatDate(a.created_at)}`, `Created ${formatDate(a.created_at)}`)} ·{" "}
            {a.last_seen_at ? t(`vu ${formatRelative(a.last_seen_at)}`, `seen ${formatRelative(a.last_seen_at)}`) : t("jamais vu", "never seen")}
            {a.language && <> · {a.language.toUpperCase()}</>}
          </p>
        </div>
        <HealthBadge health={a.health} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contacts" value={formatNumber(a.contacts)} hint={t(`${formatNumber(a.contacts_subscribed)} abonnés`, `${formatNumber(a.contacts_subscribed)} subscribed`)} />
        <Stat label={t("Emails 30 j", "Emails 30 d")} value={formatNumber(a.emails_30d)} hint={t(`${formatNumber(a.emails_total)} au total`, `${formatNumber(a.emails_total)} all time`)} />
        <Stat
          label={t("Rebond 30 j", "Bounce 30 d")}
          value={fmtRate(a.bounce_rate_30d)}
          hint={t(`${a.complaints_30d} plainte${a.complaints_30d > 1 ? "s" : ""}`, `${a.complaints_30d} complaint${a.complaints_30d === 1 ? "" : "s"}`)}
        />
        <Stat label={t("Pages vues 30 j", "Pageviews 30 d")} value={formatNumber(a.pageviews_30d)} hint={t(`${a.sites} site${a.sites > 1 ? "s" : ""}`, `${a.sites} site${a.sites === 1 ? "" : "s"}`)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-slate-500 dark:text-slate-400">{t("Domaine d'envoi :", "Sending domain:")}</span>
        <DomainCell domain={a.sending_domain} />
        <span className="text-slate-500 dark:text-slate-400">{t("Intégrations :", "Integrations:")}</span>
        {a.integrations.length ? (
          <span className="flex flex-wrap gap-1">
            {a.integrations.map((i) => (
              <Badge key={i}>{INTEGRATION_LABEL[i] ?? i}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-slate-400">{t("aucune", "none")}</span>
        )}
      </div>

      <Section title={t("30 derniers jours", "Last 30 days")}>
        {sent30 === 0 && d.timeseries.every((x) => x.pageviews === 0 && x.contacts === 0) ? (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">{t("Aucune activité sur 30 jours.", "No activity in 30 days.")}</p>
        ) : (
          <DailyChart
            data={d.timeseries}
            height={180}
            series={[
              { key: "emails_sent", label: t("Emails envoyés", "Emails sent"), color: "ink" },
              { key: "opens", label: t("Ouvertures", "Opens"), color: "blue" },
              { key: "pageviews", label: t("Pages vues", "Pageviews"), color: "orange" },
            ]}
          />
        )}
      </Section>

      <Section title={t("Utilisateurs", "Users")} count={d.users.length}>
        <Mini
          head={[{ label: "Email" }, { label: t("Nom", "Name") }, { label: t("Rôle", "Role") }, { label: t("Créé", "Created") }, { label: t("Vu", "Seen") }]}
          rows={d.users.map((u) => [
            <span className="block max-w-[200px] truncate">{u.email}</span>,
            u.name || "—",
            <Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge>,
            muted(formatDate(u.created_at)),
            muted(u.last_seen_at ? formatRelative(u.last_seen_at) : t("Jamais", "Never")),
          ])}
          empty={t("Aucun utilisateur.", "No users.")}
          minWidth={560}
        />
      </Section>

      <Section title={t("Campagnes récentes", "Recent campaigns")} count={d.campaigns.length}>
        <Mini
          head={[{ label: t("Nom", "Name") }, { label: t("Statut", "Status") }, { label: t("Envoyée", "Sent") }, { label: t("Destinataires", "Recipients"), right: true }]}
          rows={d.campaigns.map((c) => [
            <span className="block max-w-[220px] truncate">{c.name}</span>,
            <Badge>{CAMPAIGN_STATUS[c.status as CampaignStatus]?.label ?? c.status}</Badge>,
            muted(c.sent_at ? formatDateTime(c.sent_at) : "—"),
            formatNumber(c.recipients),
          ])}
          empty={t("Aucune campagne.", "No campaigns.")}
        />
      </Section>

      <Section title={t("Automatisations", "Automations")} count={d.automations.length}>
        <Mini
          head={[{ label: t("Nom", "Name") }, { label: t("Déclencheur", "Trigger") }, { label: t("Statut", "Status") }, { label: t("Exécutions", "Runs"), right: true }]}
          rows={d.automations.map((x) => [
            <span className="block max-w-[220px] truncate">{x.name}</span>,
            <span className="text-xs">{TRIGGERS[x.trigger as AutomationTrigger]?.label ?? x.trigger}</span>,
            <Badge>{x.status === "active" ? t("Active", "Active") : x.status === "paused" ? t("En pause", "Paused") : x.status}</Badge>,
            formatNumber(x.runs),
          ])}
          empty={t("Aucune automatisation.", "No automations.")}
        />
      </Section>

      <Section title={t("Sites suivis", "Tracked sites")} count={d.sites.length}>
        <Mini
          head={[{ label: t("Site", "Site") }, { label: t("Pages vues", "Pageviews"), right: true }, { label: t("Dernière visite", "Last seen") }]}
          rows={d.sites.map((s) => [<span className="block max-w-[260px] truncate">{s.host}</span>, formatNumber(s.pageviews), muted(s.last_seen ? formatRelative(s.last_seen) : "—")])}
          empty={t("Aucun site détecté.", "No sites detected.")}
          minWidth={380}
        />
      </Section>

      <Section title={t("Derniers échecs d'envoi", "Latest send failures")} count={d.failures.length}>
        <Mini
          head={[{ label: t("Date", "Date") }, { label: t("Destinataire", "Recipient") }, { label: t("Erreur", "Error") }]}
          rows={d.failures.map((f) => [
            muted(formatDateTime(f.at)),
            <span className="whitespace-nowrap">{f.to}</span>,
            <span className="block max-w-[320px] truncate font-mono text-xs" title={f.error ?? undefined}>
              {f.error || "—"}
            </span>,
          ])}
          empty={t("Aucun échec récent.", "No recent failures.")}
          minWidth={560}
        />
      </Section>
    </div>
  );
}

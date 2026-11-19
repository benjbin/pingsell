import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { useAsync, type AsyncState } from "../../lib/useAsync";
import { cx, formatNumber } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminOverview, AdminPeriod } from "../../lib/types";
import { ErrorState, Skeleton } from "../../components/ui/primitives";
import { DailyChart, Delta, fmtRate, INTEGRATIONS, INTEGRATION_LABEL, Panel, ratio, usePalette } from "./shared";
import { HealthPanel } from "./SystemTab";

export function OverviewTab({ days, overview }: { days: number; overview: AsyncState<AdminOverview> }) {
  const series = useAsync(() => api.admin.timeseries(days), [days]);
  const o = overview.data;

  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;

  return (
    <div className={cx("space-y-4 transition-opacity", overview.loading && o && "opacity-60")}>
      {o ? <KpiGrid o={o} /> : <KpiSkeleton />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartPanel
          title={t("Nouveaux comptes", "New accounts")}
          state={series}
          total={(d) => d.reduce((s, x) => s + x.accounts, 0)}
          render={(d) => <DailyChart data={d} series={[{ key: "accounts", label: t("Comptes créés", "Accounts created"), color: "blue" }]} />}
        />
        <ChartPanel
          title={t("Emails envoyés", "Emails sent")}
          state={series}
          total={(d) => d.reduce((s, x) => s + x.emails_sent, 0)}
          render={(d) => (
            <DailyChart
              data={d}
              series={[
                { key: "emails_sent", label: t("Envoyés", "Sent"), color: "ink" },
                { key: "opens", label: t("Ouvertures", "Opens"), color: "blue" },
                { key: "clicks", label: t("Clics", "Clicks"), color: "orange" },
              ]}
            />
          )}
        />
        <ChartPanel
          title={t("Pages vues", "Pageviews")}
          state={series}
          total={(d) => d.reduce((s, x) => s + x.pageviews, 0)}
          render={(d) => (
            <DailyChart
              data={d}
              series={[
                { key: "pageviews", label: t("Pages vues", "Pageviews"), color: "blue" },
                { key: "site_actions", label: t("Actions sur site", "Site actions"), color: "orange" },
              ]}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {o ? <Integrations o={o} /> : <Skeleton className="h-72 rounded-[20px]" />}
        {o ? <HealthPanel o={o} /> : <Skeleton className="h-72 rounded-[20px]" />}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {o ? <PeriodPanel o={o} /> : <Skeleton className="h-72 rounded-[20px]" />}
        {o ? <TotalsPanel o={o} /> : <Skeleton className="h-72 rounded-[20px]" />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type Tile = {
  label: string;
  value: string;
  cur: number | null;
  prev: number | null;
  kind: "count" | "rate";
  hint: string;
  lowerIsBetter?: boolean;
};

/** Taux recalculés depuis les comptes, sur la même base que le serveur : rebonds / envoyés, ouvertures et clics / délivrés. */
const r = (p: AdminPeriod, k: "opens" | "clicks" | "bounces") => (k === "bounces" ? ratio(p.bounces, p.emails_sent) : ratio(p[k], p.emails_sent - p.bounces));

function KpiGrid({ o }: { o: AdminOverview }) {
  const p = o.period;
  const q = o.previous;
  const tiles: Tile[] = [
    {
      label: t("Nouveaux comptes", "New accounts"),
      value: formatNumber(p.new_accounts),
      cur: p.new_accounts,
      prev: q.new_accounts,
      kind: "count",
      hint: t(`${formatNumber(o.totals.accounts)} comptes au total`, `${formatNumber(o.totals.accounts)} accounts in total`),
    },
    {
      label: t("Comptes actifs", "Active accounts"),
      value: formatNumber(p.active_accounts),
      cur: p.active_accounts,
      prev: q.active_accounts,
      kind: "count",
      hint: t("Connexion, envoi ou page vue sur la période", "Sign-in, send or pageview in the period"),
    },
    {
      label: t("Contacts ajoutés", "Contacts added"),
      value: formatNumber(p.contacts_added),
      cur: p.contacts_added,
      prev: q.contacts_added,
      kind: "count",
      hint: t(`${formatNumber(o.totals.contacts)} contacts au total`, `${formatNumber(o.totals.contacts)} contacts in total`),
    },
    {
      label: t("Emails envoyés", "Emails sent"),
      value: formatNumber(p.emails_sent),
      cur: p.emails_sent,
      prev: q.emails_sent,
      kind: "count",
      hint: t(`${formatNumber(p.emails_failed)} en échec`, `${formatNumber(p.emails_failed)} failed`),
    },
    {
      label: t("Taux d'ouverture", "Open rate"),
      value: fmtRate(o.rates.open),
      cur: r(p, "opens"),
      prev: r(q, "opens"),
      kind: "rate",
      hint: t(`${formatNumber(p.opens)} ouvertures`, `${formatNumber(p.opens)} opens`),
    },
    {
      label: t("Taux de clic", "Click rate"),
      value: fmtRate(o.rates.click),
      cur: r(p, "clicks"),
      prev: r(q, "clicks"),
      kind: "rate",
      hint: t(`${formatNumber(p.clicks)} clics`, `${formatNumber(p.clicks)} clicks`),
    },
    {
      label: t("Taux de rebond", "Bounce rate"),
      value: fmtRate(o.rates.bounce),
      cur: r(p, "bounces"),
      prev: r(q, "bounces"),
      kind: "rate",
      lowerIsBetter: true,
      hint: t(`${formatNumber(p.bounces)} rebonds`, `${formatNumber(p.bounces)} bounces`),
    },
    {
      label: t("Plaintes", "Complaints"),
      value: formatNumber(p.complaints),
      cur: p.complaints,
      prev: q.complaints,
      kind: "count",
      lowerIsBetter: true,
      hint: t(`Taux de plainte ${fmtRate(o.rates.complaint, 2)}`, `Complaint rate ${fmtRate(o.rates.complaint, 2)}`),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col rounded-[20px] bg-slate-100/80 p-4 sm:p-5 dark:bg-white/5">
          <p className="font-display text-[10.5px] font-semibold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">{tile.label}</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            <p className="font-display text-[24px] leading-none font-extrabold tracking-[-0.02em] text-slate-900 tabular-nums sm:text-[30px] dark:text-white">{tile.value}</p>
            <Delta cur={tile.cur} prev={tile.prev} kind={tile.kind} lowerIsBetter={tile.lowerIsBetter} />
          </div>
          <p className="mt-auto pt-3 text-xs text-slate-500 dark:text-slate-400">{tile.hint}</p>
        </div>
      ))}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-[120px] rounded-[20px]" />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChartPanel<D>({
  title,
  state,
  total,
  render,
}: {
  title: string;
  state: AsyncState<D[]>;
  total: (d: D[]) => number;
  render: (d: D[]) => ReactNode;
}) {
  const d = state.data;
  return (
    <Panel
      title={title}
      subtitle={
        d ? (
          <>
            {t("Total sur la période : ", "Period total: ")}
            <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{formatNumber(total(d))}</span>
          </>
        ) : (
          t("Par jour", "Per day")
        )
      }
    >
      {state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !d ? (
        <Skeleton className="h-[220px] w-full rounded-xl" />
      ) : (
        <div className={cx("transition-opacity", state.loading && "opacity-60")}>{render(d)}</div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Integrations({ o }: { o: AdminOverview }) {
  const c = usePalette();
  const total = o.totals.accounts;
  const rows = INTEGRATIONS.map((k) => ({ key: k, label: INTEGRATION_LABEL[k], n: o.integrations[k] ?? 0 })).sort((a, b) => b.n - a.n);
  return (
    <Panel
      title={t("Adoption des intégrations", "Integrations adoption")}
      subtitle={t(`Comptes utilisant chaque intégration, sur ${formatNumber(total)} comptes`, `Accounts using each integration, out of ${formatNumber(total)}`)}
    >
      <ul className="space-y-3.5">
        {rows.map((row) => {
          const share = total > 0 ? row.n / total : 0;
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-200">{row.label}</span>
                <span className="text-slate-500 tabular-nums dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-white">{formatNumber(row.n)}</span> · {fmtRate(total > 0 ? share : null, 0)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: c.track }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(row.n > 0 ? 2 : 0, share * 100)}%`, background: c.blue }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

const PERIOD_ROWS: Array<{ key: keyof AdminPeriod; label: string; lowerIsBetter?: boolean }> = [
  { key: "campaigns_sent", label: t("Campagnes envoyées", "Campaigns sent") },
  { key: "automation_runs", label: t("Exécutions d'automatisations", "Automation runs") },
  { key: "push_sent", label: t("Notifications push envoyées", "Push notifications sent") },
  { key: "pageviews", label: t("Pages vues", "Pageviews") },
  { key: "site_actions", label: t("Actions sur site", "Site actions") },
  { key: "unsubscribes", label: t("Désabonnements", "Unsubscribes"), lowerIsBetter: true },
  { key: "emails_failed", label: t("Emails en échec", "Failed emails"), lowerIsBetter: true },
];

function PeriodPanel({ o }: { o: AdminOverview }) {
  return (
    <Panel title={t("Activité de la période", "Period activity")} subtitle={t(`${o.days} derniers jours, comparés aux ${o.days} précédents`, `Last ${o.days} days vs the ${o.days} before`)} flush>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {PERIOD_ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
            <span className="min-w-0 text-slate-600 dark:text-slate-300">{row.label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{formatNumber(o.period[row.key])}</span>
              <Delta cur={o.period[row.key]} prev={o.previous[row.key]} kind="count" lowerIsBetter={row.lowerIsBetter} />
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
          <span className="text-slate-600 dark:text-slate-300">{t("Taux de délivrabilité", "Delivery rate")}</span>
          <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{fmtRate(o.rates.delivery)}</span>
        </li>
        <li className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
          <span className="text-slate-600 dark:text-slate-300">{t("Taux de désabonnement", "Unsubscribe rate")}</span>
          <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{fmtRate(o.rates.unsubscribe, 2)}</span>
        </li>
      </ul>
    </Panel>
  );
}

function TotalsPanel({ o }: { o: AdminOverview }) {
  const x = o.totals;
  const rows: Array<{ label: string; value: number; of?: number; ofLabel?: string }> = [
    { label: t("Comptes", "Accounts"), value: x.accounts },
    { label: t("Utilisateurs", "Users"), value: x.users },
    { label: "Contacts", value: x.contacts, of: x.contacts_subscribed, ofLabel: t("abonnés", "subscribed") },
    { label: t("Campagnes", "Campaigns"), value: x.campaigns, of: x.campaigns_sent, ofLabel: t("envoyées", "sent") },
    { label: t("Automatisations", "Automations"), value: x.automations, of: x.automations_active, ofLabel: t("actives", "active") },
    { label: t("Domaines d'envoi", "Sending domains"), value: x.sending_domains, of: x.sending_domains_verified, ofLabel: t("vérifiés", "verified") },
    { label: t("Clés API", "API keys"), value: x.api_keys },
    { label: t("Sites suivis", "Tracked sites"), value: x.sites },
    { label: t("Appareils push", "Push devices"), value: x.push_devices },
    { label: t("Modèles d'email", "Email templates"), value: x.email_templates },
    { label: t("Emails envoyés (total)", "Emails sent (all time)"), value: x.emails_sent },
  ];
  return (
    <Panel title={t("Volumes de la plateforme", "Platform totals")} subtitle={t("Depuis l'ouverture", "All time")} flush>
      <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 dark:divide-slate-800">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 border-slate-100 px-5 py-3 text-sm sm:border-b sm:px-6 dark:border-slate-800">
            <dt className="min-w-0 text-slate-600 dark:text-slate-300">{row.label}</dt>
            <dd className="shrink-0 text-right tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-white">{formatNumber(row.value)}</span>
              {row.of !== undefined && (
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  {formatNumber(row.of)} {row.ofLabel}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

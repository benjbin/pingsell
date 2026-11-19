import type { ReactNode } from "react";
import type { AsyncState } from "../../lib/useAsync";
import { cx, formatDate, formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminOverview } from "../../lib/types";
import { ErrorState, Skeleton } from "../../components/ui/primitives";
import { fmtBytes, fmtDuration, fmtRate, Panel, StatusPill, type Level } from "./shared";

/* -------------------------------------------------------------------------- */
/* Health checks (thresholds kept here so the overview and system tabs agree) */
/* -------------------------------------------------------------------------- */

const worst = (...levels: Level[]): Level => (levels.includes("bad") ? "bad" : levels.includes("warn") ? "warn" : "ok");
const above = (v: number | null, warn: number, bad: number): Level => (v === null ? "ok" : v > bad ? "bad" : v > warn ? "warn" : "ok");
const below = (v: number | null, warn: number, bad: number): Level => (v === null ? "ok" : v < bad ? "bad" : v < warn ? "warn" : "ok");

interface Check {
  label: string;
  value: string;
  detail?: string;
  level: Level;
}

function healthChecks(o: AdminOverview): Check[] {
  const q = o.queue;
  const oldestMin = q.queued_oldest_at ? (Date.now() - new Date(q.queued_oldest_at).getTime()) / 60000 : null;
  return [
    {
      label: t("File d'envoi", "Send queue"),
      value: t(`${formatNumber(q.queued)} en attente`, `${formatNumber(q.queued)} queued`),
      detail: q.queued_oldest_at ? t(`Le plus ancien : ${formatRelative(q.queued_oldest_at)}`, `Oldest: ${formatRelative(q.queued_oldest_at)}`) : undefined,
      level: above(oldestMin, 15, 60),
    },
    {
      label: t("Automatisations en retard", "Overdue automation runs"),
      value: formatNumber(q.runs_overdue),
      detail: t(`${formatNumber(q.runs_pending)} exécutions planifiées · retard > 10 min`, `${formatNumber(q.runs_pending)} scheduled runs · late > 10 min`),
      level: above(q.runs_overdue, 0, 20),
    },
    {
      label: t("Échecs sur 24 h", "Failures in 24 h"),
      value: formatNumber(q.failed_24h),
      level: above(q.failed_24h, 0, 50),
    },
    {
      label: t("Délivrabilité", "Delivery rate"),
      value: fmtRate(o.rates.delivery),
      detail: t(`Sur ${o.days} jours`, `Over ${o.days} days`),
      level: below(o.rates.delivery, 0.97, 0.9),
    },
    {
      label: t("Taux de rebond", "Bounce rate"),
      value: fmtRate(o.rates.bounce),
      detail: t("Seuils : 2 % · 5 %", "Thresholds: 2% · 5%"),
      level: above(o.rates.bounce, 0.02, 0.05),
    },
    {
      label: t("Taux de plainte", "Complaint rate"),
      value: fmtRate(o.rates.complaint, 2),
      detail: t("Seuils : 0,1 % · 0,3 %", "Thresholds: 0.1% · 0.3%"),
      level: above(o.rates.complaint, 0.001, 0.003),
    },
  ];
}

export function HealthPanel({ o }: { o: AdminOverview }) {
  const checks = healthChecks(o);
  const overall = worst(...checks.map((c) => c.level));
  return (
    <Panel
      title={t("Santé de la plateforme", "Platform health")}
      subtitle={t("File d'envoi, automatisations et délivrabilité", "Send queue, automations and deliverability")}
      action={
        <StatusPill
          level={overall}
          label={overall === "ok" ? t("Tout est normal", "All normal") : overall === "warn" ? t("À surveiller", "Needs a look") : t("Action requise", "Action needed")}
        />
      }
      flush
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {checks.map((c) => (
          <li key={c.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-5 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{c.label}</p>
              {c.detail && <p className="text-xs text-slate-500 dark:text-slate-400">{c.detail}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{c.value}</span>
              <StatusPill level={c.level} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* System tab                                                                 */
/* -------------------------------------------------------------------------- */

function Info({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 px-5 py-3 text-sm sm:px-6">
      <dt className="shrink-0 text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className={cx("min-w-0 text-right font-semibold break-words text-slate-900 dark:text-white", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

function Tile({ label, value, hint, level }: { label: string; value: string; hint?: string; level?: Level }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[20px] bg-slate-100/80 p-4 sm:p-5 dark:bg-white/5">
      <p className="font-display text-[10.5px] font-semibold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-3 font-display text-[24px] leading-none font-extrabold tracking-[-0.02em] text-slate-900 tabular-nums sm:text-[30px] dark:text-white">{value}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {level && <StatusPill level={level} />}
        {hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </div>
    </div>
  );
}

export function SystemTab({ overview }: { overview: AsyncState<AdminOverview> }) {
  const o = overview.data;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!o) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-[20px]" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
    );
  }
  const q = o.queue;
  const s = o.system;
  const oldestMin = q.queued_oldest_at ? (Date.now() - new Date(q.queued_oldest_at).getTime()) / 60000 : null;
  const warmupDay = s.warmup_start ? Math.floor((Date.now() - new Date(s.warmup_start).getTime()) / 86_400_000) + 1 : null;

  return (
    <div className={cx("space-y-4 transition-opacity", overview.loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Tile
          label={t("Emails en file", "Queued emails")}
          value={formatNumber(q.queued)}
          hint={q.queued_oldest_at ? t(`Plus ancien ${formatRelative(q.queued_oldest_at)}`, `Oldest ${formatRelative(q.queued_oldest_at)}`) : t("File vide", "Queue empty")}
          level={above(oldestMin, 15, 60)}
        />
        <Tile label={t("Exécutions planifiées", "Scheduled runs")} value={formatNumber(q.runs_pending)} hint={t("Automatisations à venir", "Upcoming automation steps")} />
        <Tile label={t("Exécutions en retard", "Overdue runs")} value={formatNumber(q.runs_overdue)} hint={t("Retard > 10 min", "Late > 10 min")} level={above(q.runs_overdue, 0, 20)} />
        <Tile label={t("Échecs sur 24 h", "Failures in 24 h")} value={formatNumber(q.failed_24h)} level={above(q.failed_24h, 0, 50)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t("Serveur", "Server")} subtitle={t(`Relevé ${formatRelative(o.generated_at)}`, `Read ${formatRelative(o.generated_at)}`)} flush>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <Info label={t("Taille de la base", "Database size")}>{fmtBytes(s.db_size_bytes)}</Info>
            <Info label={t("Disponibilité", "Uptime")}>{fmtDuration(s.uptime_s)}</Info>
            <Info label="Node.js" mono>
              {s.node || "—"}
            </Info>
            <Info label={t("Version (commit)", "Version (commit)")} mono>
              <span title={s.commit ?? undefined}>{s.commit ? s.commit.slice(0, 7) : "—"}</span>
            </Info>
            <Info label={t("Fournisseur d'envoi", "Email provider")}>{s.email_provider || "—"}</Info>
            <Info label={t("Montée en charge (warm-up)", "Warm-up")}>
              {s.warmup_start ? (
                <span title={formatDateTime(s.warmup_start)}>
                  {t(`Depuis le ${formatDate(s.warmup_start)}`, `Since ${formatDate(s.warmup_start)}`)}
                  {warmupDay !== null && warmupDay > 0 && <span className="font-normal text-slate-500 dark:text-slate-400"> · {t(`jour ${warmupDay}`, `day ${warmupDay}`)}</span>}
                </span>
              ) : (
                t("Non démarrée", "Not started")
              )}
            </Info>
          </dl>
        </Panel>
        <HealthPanel o={o} />
      </div>
    </div>
  );
}

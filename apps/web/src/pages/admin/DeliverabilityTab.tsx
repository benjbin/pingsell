import { MailCheck } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync, type AsyncState } from "../../lib/useAsync";
import { cx, formatNumber, formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminOverview, AdminRates } from "../../lib/types";
import { ErrorState, Skeleton, TableSkeleton } from "../../components/ui/primitives";
import { AccountsTable } from "./AccountsTab";
import { EmptyLine, fmtRate, Panel, ratio, StatusPill, TableScroll, TD, TH, THEAD, type Level } from "./shared";

const RATE_TILES: Array<{ key: keyof AdminRates; label: string; digits?: number; level?: (v: number) => Level }> = [
  { key: "delivery", label: t("Délivrés", "Delivered"), level: (v) => (v < 0.9 ? "bad" : v < 0.97 ? "warn" : "ok") },
  { key: "bounce", label: t("Rebonds", "Bounces"), level: (v) => (v > 0.05 ? "bad" : v > 0.02 ? "warn" : "ok") },
  { key: "complaint", label: t("Plaintes", "Complaints"), digits: 2, level: (v) => (v > 0.003 ? "bad" : v > 0.001 ? "warn" : "ok") },
  { key: "open", label: t("Ouvertures", "Opens") },
  { key: "click", label: t("Clics", "Clicks") },
  { key: "unsubscribe", label: t("Désabonnements", "Unsubscribes"), digits: 2 },
];

export function DeliverabilityTab({ days, overview, onOpen }: { days: number; overview: AsyncState<AdminOverview>; onOpen: (id: string) => void }) {
  const state = useAsync(() => api.admin.deliverability(days), [days]);
  const d = state.data;
  const o = overview.data;

  return (
    <div className="space-y-4">
      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
          {RATE_TILES.map((tile) => {
            const v = o?.rates[tile.key] ?? null;
            return (
              <div key={tile.key} className="flex min-w-0 flex-col rounded-[20px] bg-slate-100/80 p-4 sm:p-5 dark:bg-white/5">
                <p className="font-display text-[10.5px] font-semibold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">{tile.label}</p>
                {o ? (
                  <p className="mt-3 font-display text-[24px] leading-none font-extrabold tracking-[-0.02em] text-slate-900 tabular-nums dark:text-white">{fmtRate(v, tile.digits)}</p>
                ) : (
                  <Skeleton className="mt-3 h-6 w-16" />
                )}
                <div className="mt-auto pt-3">{o && tile.level && v !== null && <StatusPill level={tile.level(v)} />}</div>
              </div>
            );
          })}
        </div>
      )}
      {o && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t(
            `Sur ${o.days} jours : ${formatNumber(o.period.emails_sent)} emails envoyés, ${formatNumber(o.period.bounces)} rebonds, ${formatNumber(o.period.complaints)} plaintes.`,
            `Over ${o.days} days: ${formatNumber(o.period.emails_sent)} emails sent, ${formatNumber(o.period.bounces)} bounces, ${formatNumber(o.period.complaints)} complaints.`,
          )}
        </p>
      )}

      {state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title={t("Par domaine destinataire", "By recipient domain")} subtitle={t("12 domaines les plus servis", "Top 12 domains by volume")} flush>
              {!d ? (
                <TableSkeleton rows={6} cols={4} />
              ) : d.by_domain.length === 0 ? (
                <EmptyLine>{t("Aucun envoi sur la période.", "No sends in this period.")}</EmptyLine>
              ) : (
                <TableScroll minWidth={480} dim={state.loading}>
                  <thead className={THEAD}>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={TH}>{t("Domaine", "Domain")}</th>
                      <th className={cx(TH, "text-right")}>{t("Envoyés", "Sent")}</th>
                      <th className={cx(TH, "text-right")}>{t("Rebonds", "Bounced")}</th>
                      <th className={cx(TH, "text-right")}>{t("Ouverts", "Opened")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {d.by_domain.map((row) => {
                      const br = ratio(row.bounced, row.sent);
                      const or = ratio(row.opened, row.sent);
                      return (
                        <tr key={row.domain}>
                          <td className={cx(TD, "font-medium text-slate-900 dark:text-white")}>{row.domain}</td>
                          <td className={cx(TD, "text-right text-slate-700 tabular-nums dark:text-slate-300")}>{formatNumber(row.sent)}</td>
                          <td className={cx(TD, "text-right tabular-nums")}>
                            <span className="text-slate-700 dark:text-slate-300">{formatNumber(row.bounced)}</span>
                            <span className={cx("ml-1.5 text-xs", br !== null && br > 0.05 ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-400")}>{fmtRate(br)}</span>
                          </td>
                          <td className={cx(TD, "text-right tabular-nums")}>
                            <span className="text-slate-700 dark:text-slate-300">{formatNumber(row.opened)}</span>
                            <span className="ml-1.5 text-xs text-slate-400">{fmtRate(or)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableScroll>
              )}
            </Panel>

            <Panel title={t("Principales erreurs", "Top errors")} subtitle={t("10 motifs d'échec les plus fréquents", "10 most frequent failure reasons")} flush>
              {!d ? (
                <TableSkeleton rows={6} cols={3} />
              ) : d.errors.length === 0 ? (
                <EmptyLine>{t("Aucune erreur sur la période.", "No errors in this period.")}</EmptyLine>
              ) : (
                <ul className={cx("divide-y divide-slate-100 transition-opacity dark:divide-slate-800", state.loading && "opacity-60")}>
                  {d.errors.map((e, i) => (
                    <li key={`${e.error}-${i}`} className="flex items-start justify-between gap-3 px-5 py-3 sm:px-6">
                      <div className="min-w-0">
                        <p className="font-mono text-xs break-words text-slate-800 dark:text-slate-200">{e.error || "—"}</p>
                        {e.last_at && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{t(`Dernière occurrence ${formatRelative(e.last_at)}`, `Last seen ${formatRelative(e.last_at)}`)}</p>}
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums dark:bg-white/10 dark:text-slate-200">
                        {formatNumber(e.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title={t("Comptes à risque", "Risky accounts")}
            subtitle={t("Rebond > 5 % ou plaintes > 0,3 % sur 30 jours", "Bounce > 5% or complaints > 0.3% over 30 days")}
            flush
          >
            {!d ? (
              <TableSkeleton rows={4} cols={6} />
            ) : d.risky_accounts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <MailCheck className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <p className="text-sm text-slate-600 dark:text-slate-300">{t("Aucun compte à risque.", "No risky accounts.")}</p>
              </div>
            ) : (
              <AccountsTable rows={d.risky_accounts} onOpen={onOpen} dim={state.loading} />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { Activity, BadgeCheck, Globe, Plug, Send, UserPlus, Users, Workflow, type LucideIcon } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { cx, formatDateTime, formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminActivityType } from "../../lib/types";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "../../components/ui/primitives";

const TYPES: Record<AdminActivityType, { label: string; icon: LucideIcon }> = {
  account_created: { label: t("Compte créé", "Account created"), icon: UserPlus },
  user_joined: { label: t("Utilisateur ajouté", "User joined"), icon: Users },
  campaign_sent: { label: t("Campagne envoyée", "Campaign sent"), icon: Send },
  automation_created: { label: t("Automatisation créée", "Automation created"), icon: Workflow },
  integration_connected: { label: t("Intégration connectée", "Integration connected"), icon: Plug },
  domain_verified: { label: t("Domaine vérifié", "Domain verified"), icon: BadgeCheck },
  site_detected: { label: t("Site détecté", "Site detected"), icon: Globe },
};

const STEP = 50;
const MAX = 200;

export function ActivityTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [limit, setLimit] = useState(STEP);
  const feed = useAsync(() => api.admin.activity(limit), [limit]);
  const items = feed.data;

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="border-b border-slate-900/10 px-5 py-4 sm:px-6 dark:border-white/10">
        <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{t("Activité récente", "Recent activity")}</h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("Tous comptes, du plus récent au plus ancien", "All accounts, newest first")}</p>
      </div>

      {feed.error ? (
        <div className="p-5 sm:p-6">
          <ErrorState message={feed.error} onRetry={feed.reload} />
        </div>
      ) : !items ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3 w-16" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState icon={Activity} title={t("Aucune activité", "No activity")} />
      ) : (
        <>
          <ul className={cx("divide-y divide-slate-100 transition-opacity dark:divide-slate-800", feed.loading && "opacity-60")}>
            {items.map((it, i) => {
              const ty = TYPES[it.type] ?? { label: it.type, icon: Activity };
              return (
                <li key={`${it.at}-${it.type}-${it.account_id}-${i}`} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-slate-700 ring-1 ring-slate-900/15 dark:text-slate-200 dark:ring-white/15">
                    <ty.icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-medium">{ty.label}</span>
                      <span className="text-slate-400"> · </span>
                      <button
                        type="button"
                        onClick={() => onOpen(it.account_id)}
                        className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {it.account_name || "—"}
                      </button>
                    </p>
                    {it.detail && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={it.detail}>{it.detail}</p>}
                  </div>
                  <time dateTime={it.at} title={formatDateTime(it.at)} className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {formatRelative(it.at)}
                  </time>
                </li>
              );
            })}
          </ul>
          {items.length >= limit && limit < MAX && (
            <div className="flex justify-center border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <Button variant="secondary" size="sm" loading={feed.loading} onClick={() => setLimit((l) => Math.min(MAX, l + STEP))}>
                {t("Afficher plus", "Show more")}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

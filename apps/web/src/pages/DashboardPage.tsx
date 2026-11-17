import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Euro, MailOpen, MousePointerClick, Plus, Send, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { CAMPAIGN_STATUS } from "../lib/constants";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatShortDate } from "../lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton, StatCard } from "../components/ui/primitives";
import { SERIES_COLORS, TimeAreaChart } from "../components/charts";

type Range = "7" | "30" | "90";

export function DashboardPage() {
  const { account, usage } = useAuth();
  const [range, setRange] = useState<Range>("30");
  const stats = useAsync(() => api.stats.overview(Number(range)), [range]);
  const campaigns = useAsync(() => api.campaigns.list(), []);
  const s = stats.data;

  const recent = [...(campaigns.data ?? [])]
    .sort((a, b) => (b.sent_at ?? b.updated_at).localeCompare(a.sent_at ?? a.updated_at))
    .slice(0, 5);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Tableau de bord</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bonjour{account ? ` ${account.name}` : ""}, voici la performance de vos emails sur les {range} derniers jours.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 jours" },
              { value: "30", label: "30 jours" },
              { value: "90", label: "90 jours" },
            ]}
          />
          <Link to="/campagnes/nouvelle">
            <Button icon={Plus}>Nouvelle campagne</Button>
          </Link>
        </div>
      </div>

      {stats.error && (
        <div className="mb-6">
          <ErrorState message={stats.error} onRetry={stats.reload} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contacts abonnés"
          icon={Users}
          loading={stats.loading}
          value={formatNumber(s?.contacts_subscribed)}
          hint={s && `${formatNumber(s.contacts_total)} au total · +${formatNumber(s.contacts_new)} nouveaux`}
        />
        <StatCard
          label="Emails envoyés"
          icon={Send}
          loading={stats.loading}
          value={formatNumber(s?.emails_sent)}
          hint={s && `${formatNumber(s.campaigns_sent)} campagne${s.campaigns_sent > 1 ? "s" : ""} envoyée${s.campaigns_sent > 1 ? "s" : ""}`}
        />
        <StatCard
          label="Taux d'ouverture"
          icon={MailOpen}
          loading={stats.loading}
          value={formatPercent(s?.open_rate)}
          hint={s && `Clics ${formatPercent(s.click_rate)} · Désabonnements ${formatPercent(s.unsubscribe_rate)}`}
        />
        <StatCard
          label="Revenu Shopify"
          icon={Euro}
          loading={stats.loading}
          value={formatCurrency(s?.revenue_shopify)}
          hint="Commandes des contacts sur la période"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Activité des emails" description="Envois, ouvertures et clics par jour" />
          <div className="p-4 sm:p-5">
            {stats.loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : s && s.timeseries.length > 0 ? (
              <TimeAreaChart
                data={s.timeseries}
                xKey="date"
                formatX={formatShortDate}
                series={[
                  { key: "sent", label: "Envoyés", color: SERIES_COLORS.sent },
                  { key: "opened", label: "Ouverts", color: SERIES_COLORS.opened },
                  { key: "clicked", label: "Cliqués", color: SERIES_COLORS.clicked },
                ]}
              />
            ) : (
              <EmptyState icon={Send} title="Pas encore d'activité" description="Envoyez votre première campagne pour voir vos statistiques ici." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Utilisation ce mois" description="Facturation au volume d'emails" />
          <div className="space-y-4 p-5">
            <UsageRow icon={Send} label="Emails envoyés" value={usage ? formatNumber(usage.emails_sent_month) : undefined} />
            <UsageRow icon={Users} label="Contacts" value={usage ? formatNumber(usage.contacts) : undefined} />
            <UsageRow icon={UserPlus} label={`Nouveaux contacts (${range} j)`} value={s ? formatNumber(s.contacts_new) : undefined} />
            <UsageRow icon={MousePointerClick} label="Taux de clic" value={s ? formatPercent(s.click_rate) : undefined} />
            <Link to="/parametres" className="flex items-center gap-1 pt-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              Gérer mon compte <ArrowRight className="size-4" />
            </Link>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Campagnes récentes"
          action={
            <Link to="/campagnes" className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              Tout voir
            </Link>
          }
        />
        {campaigns.loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Aucune campagne"
            description="Créez votre première campagne, partez d'un de nos modèles."
            action={
              <Link to="/campagnes/nouvelle">
                <Button icon={Plus}>Créer une campagne</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  to={c.status === "draft" || c.status === "scheduled" ? `/campagnes/${c.id}` : `/campagnes/${c.id}/rapport`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.subject}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {c.stats && c.status === "sent" && (
                      <>
                        <span>{formatNumber(c.stats.sent)} envois</span>
                        <span>{formatPercent(c.stats.open_rate)} ouv.</span>
                        <span className="hidden sm:inline">{formatPercent(c.stats.click_rate)} clics</span>
                      </>
                    )}
                    <span className="hidden md:inline">{formatDate(c.sent_at ?? c.scheduled_at ?? c.updated_at)}</span>
                    <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                      {CAMPAIGN_STATUS[c.status]?.label ?? c.status}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function UsageRow({ icon: Icon, label, value }: { icon: typeof Send; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon className="size-4" />
      </span>
      <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">{label}</span>
      {value === undefined ? <Skeleton className="h-5 w-12" /> : <span className="text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{value}</span>}
    </div>
  );
}

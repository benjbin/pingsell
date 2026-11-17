import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, Euro, MousePointerClick, Plug, Plus, Send, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { CAMPAIGN_STATUS } from "../lib/constants";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatShortDate } from "../lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton, StatCard } from "../components/ui/primitives";
import { SERIES_COLORS, TimeAreaChart } from "../components/charts";
import { t } from "../lib/i18n";

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

  const firstName = account?.name ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 6 ? t("Bonne nuit", "Good night") : hour < 12 ? t("Bonjour", "Good morning") : hour < 18 ? t("Bonjour", "Good afternoon") : t("Bonsoir", "Good evening");

  return (
    <>
      <div className="mb-10 flex animate-rise flex-col gap-6 pb-4 lg:flex-row lg:items-end lg:justify-between dark:border-white/10">
        <div>
          <p className="eyebrow">{t(`Tableau de bord — ${range} derniers jours`, `Dashboard — last ${range} days`)}</p>
          <h1 className="display mt-4 text-[52px] leading-[0.88] text-slate-900 sm:text-[76px] dark:text-white">
            {greeting},
            <br />
            <em className="text-brand-500">{firstName}.</em>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: t("7 j", "7d") },
              { value: "30", label: t("30 j", "30d") },
              { value: "90", label: t("90 j", "90d") },
            ]}
          />
          <Link to="/campagnes/nouvelle">
            <Button variant="accent" size="lg" icon={Plus}>
              {t("Nouvelle campagne", "New campaign")}
            </Button>
          </Link>
        </div>
      </div>

      {usage && usage.contacts === 0 && (
        <Link
          to="/bienvenue"
          className="mb-8 flex flex-col gap-4 rounded-[24px] bg-brand-500 p-6 text-white transition hover:bg-brand-600 sm:flex-row sm:items-center"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <Plug className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-display text-lg font-bold">{t("Branchez votre premier outil", "Connect your first tool")}</span>
            <span className="mt-0.5 block text-sm text-white/80">{t("Shopify, votre site, votre logiciel, votre app mobile ou un fichier : quelques minutes suffisent.", "Shopify, your website, your software, your mobile app or a file: it only takes a few minutes.")}</span>
          </span>
          <span className="inline-flex items-center gap-2 font-display text-sm font-bold">
            {t("Commencer", "Get started")} <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

      {stats.error && (
        <div className="mb-6">
          <ErrorState message={stats.error} onRetry={stats.reload} />
        </div>
      )}

      {/* Hero metric + secondary metrics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="relative overflow-hidden rounded-[24px] bg-slate-900 p-8 text-white lg:col-span-5 dark:bg-brand-500">
          <div className="pointer-events-none absolute -right-20 -bottom-20 size-64 rounded-full border-[40px] border-brand-500 dark:border-slate-900" />
          <Link
            to="/campagnes"
            aria-label={t("Voir les campagnes", "View campaigns")}
            className="absolute top-6 right-6 flex size-10 items-center justify-center rounded-full ring-1 ring-white/25 transition duration-300 hover:bg-white hover:text-slate-900"
          >
            <ArrowUpRight className="size-4" strokeWidth={1.5} />
          </Link>
          <p className="relative font-display text-[11px] font-semibold tracking-[0.2em] uppercase opacity-60">{t("01 — Taux d'ouverture", "01 — Open rate")}</p>
          {stats.loading ? (
            <Skeleton className="relative mt-6 h-28 w-48 !bg-white/10" />
          ) : (
            <p className="display relative mt-4 text-[112px] leading-[0.85] tabular-nums">{formatPercent(s?.open_rate)}</p>
          )}
          <div className="relative mt-8 flex gap-8 font-display text-[11px] font-semibold tracking-wider">
            <div>
              <p className="opacity-50">{t("CLICS", "CLICKS")}</p>
              <p className="mt-1 text-lg font-bold">{formatPercent(s?.click_rate)}</p>
            </div>
            <div>
              <p className="opacity-50">{t("DÉSABO.", "UNSUBS.")}</p>
              <p className="mt-1 text-lg font-bold">{formatPercent(s?.unsubscribe_rate)}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-7">
          <StatCard
            label={t("Abonnés", "Subscribers")}
            icon={Users}
            loading={stats.loading}
            value={formatNumber(s?.contacts_subscribed)}
            hint={s && t(`${formatNumber(s.contacts_total)} au total · +${formatNumber(s.contacts_new)}`, `${formatNumber(s.contacts_total)} total · +${formatNumber(s.contacts_new)}`)}
          />
          <StatCard
            label={t("Emails envoyés", "Emails sent")}
            icon={Send}
            loading={stats.loading}
            value={formatNumber(s?.emails_sent)}
            hint={s && t(`${formatNumber(s.campaigns_sent)} campagne${s.campaigns_sent > 1 ? "s" : ""}`, `${formatNumber(s.campaigns_sent)} campaign${s.campaigns_sent === 1 ? "" : "s"}`)}
          />
          <Link to="/statistiques" className="block rounded-[20px] transition hover:ring-2 hover:ring-brand-500/40" aria-label={t("Revenu généré : voir les statistiques détaillées", "Revenue generated: view detailed stats")}>
            <StatCard
              label={t("Revenu généré", "Revenue generated")}
              icon={Euro}
              loading={stats.loading}
              value={formatCurrency(s?.revenue_attributed)}
              hint={
                s &&
                (s.revenue_shopify > 0
                  ? t(`${Math.round((s.revenue_attributed / s.revenue_shopify) * 100)}\u00a0% de ${formatCurrency(s.revenue_shopify)} de CA`, `${Math.round((s.revenue_attributed / s.revenue_shopify) * 100)}% of ${formatCurrency(s.revenue_shopify)} in sales`)
                  : t("Grâce à vos emails et notifications", "From your emails and notifications"))
              }
            />
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t("Activité", "Activity")}
            description={t("Envois, ouvertures et clics, jour par jour", "Sends, opens and clicks, day by day")}
            action={
              <Link to="/statistiques" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                {t("Statistiques détaillées", "Detailed stats")} <ArrowRight className="size-4" />
              </Link>
            }
          />
          <div className="p-4 sm:p-6">
            {stats.loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : s && s.timeseries.length > 0 ? (
              <TimeAreaChart
                data={s.timeseries}
                xKey="date"
                height={300}
                formatX={formatShortDate}
                series={[
                  { key: "sent", label: t("Envoyés", "Sent"), color: SERIES_COLORS.sent },
                  { key: "opened", label: t("Ouverts", "Opened"), color: SERIES_COLORS.opened },
                  { key: "clicked", label: t("Cliqués", "Clicked"), color: SERIES_COLORS.clicked },
                ]}
              />
            ) : (
              <EmptyState icon={Send} title={t("Pas encore d'activité", "No activity yet")} description={t("Envoyez votre première campagne pour voir vos statistiques ici.", "Send your first campaign to see your stats here.")} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Ce mois-ci", "This month")} description={t("Facturation au volume d'emails", "Billed by email volume")} />
          <dl className="divide-y divide-slate-200/80 px-6 dark:divide-slate-800">
            <UsageRow icon={Send} label={t("Emails envoyés", "Emails sent")} value={usage ? formatNumber(usage.emails_sent_month) : undefined} />
            <UsageRow icon={Users} label={t("Contacts", "Contacts")} value={usage ? formatNumber(usage.contacts) : undefined} />
            <UsageRow icon={UserPlus} label={t(`Nouveaux (${range} j)`, `New (${range}d)`)} value={s ? formatNumber(s.contacts_new) : undefined} />
            <UsageRow icon={MousePointerClick} label={t("Taux de clic", "Click rate")} value={s ? formatPercent(s.click_rate) : undefined} />
          </dl>
          <div className="px-6 pt-2 pb-6">
            <Link to="/parametres" className="group inline-flex items-center gap-1.5 text-sm font-medium text-slate-950 dark:text-white">
              <span className="underline decoration-brand-500 decoration-2 underline-offset-4">{t("Gérer mon compte", "Manage my account")}</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </Card>
      </div>

      <section className="mt-14">
        <div className="mb-5 flex items-end justify-between border-b border-slate-900/10 pb-4 dark:border-white/10">
          <h2 className="display text-[36px] leading-none text-slate-900 dark:text-white">{t("Campagnes récentes", "Recent campaigns")}<span className="text-brand-500">.</span></h2>
          <Link to="/campagnes" className="group inline-flex items-center gap-1.5 font-display text-[11px] font-semibold tracking-wider text-slate-600 uppercase hover:text-brand-500 dark:hover:text-white">
            {t("Tout voir", "View all")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        {campaigns.loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Send}
            title={t("Aucune campagne", "No campaigns")}
            description={t("Créez votre première campagne, partez d'un de nos modèles.", "Create your first campaign, starting from one of our templates.")}
            action={
              <Link to="/campagnes/nouvelle">
                <Button icon={Plus}>{t("Créer une campagne", "Create a campaign")}</Button>
              </Link>
            }
          />
        ) : (
          <ol>
            {recent.map((c, i) => (
              <li key={c.id} className="border-b border-slate-900/10 dark:border-white/10">
                <Link
                  to={c.status === "draft" || c.status === "scheduled" ? `/campagnes/${c.id}` : `/campagnes/${c.id}/rapport`}
                  className="group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-4 py-5 transition-colors sm:grid-cols-[3rem_minmax(0,1fr)_auto_auto]"
                >
                  <span className="font-display text-xs font-semibold text-brand-500">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <p className="display truncate text-[22px] leading-tight text-slate-900 transition-colors group-hover:text-brand-500 dark:text-white">
                      {c.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{c.subject}</p>
                  </div>
                  <div className="hidden items-center gap-6 font-display text-[11px] text-slate-500 tabular-nums sm:flex dark:text-slate-400">
                    {c.stats && c.status === "sent" ? (
                      <>
                        <span>
                          <span className="text-slate-950 dark:text-white">{formatNumber(c.stats.sent)}</span> {t("envois", "sent")}
                        </span>
                        <span>
                          <span className="text-brand-600 dark:text-brand-400">{formatPercent(c.stats.open_rate)}</span> {t("ouv.", "opens")}
                        </span>
                        <span className="hidden md:inline">{formatPercent(c.stats.click_rate)} {t("clics", "clicks")}</span>
                      </>
                    ) : (
                      <span className="hidden md:inline">{formatDate(c.sent_at ?? c.scheduled_at ?? c.updated_at)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                      {CAMPAIGN_STATUS[c.status]?.label ?? c.status}
                    </Badge>
                    <ArrowRight className="hidden size-4 -translate-x-2 text-brand-500 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 sm:block" />
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function UsageRow({ icon: Icon, label, value }: { icon: typeof Send; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      <Icon className="size-4 text-slate-400" strokeWidth={1.5} />
      <dt className="flex-1 text-sm text-slate-600 dark:text-slate-300">{label}</dt>
      {value === undefined ? <Skeleton className="h-5 w-12" /> : <dd className="display text-2xl leading-none text-slate-900 tabular-nums dark:text-white">{value}</dd>}
    </div>
  );
}

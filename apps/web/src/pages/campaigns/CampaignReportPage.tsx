import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Ban, CheckCircle2, MailOpen, MousePointerClick, Send, TriangleAlert, Users } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { CAMPAIGN_STATUS } from "../../lib/constants";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from "../../components/ui/primitives";
import { SERIES_COLORS, TimeAreaChart } from "../../components/charts";
import { EmailPreview } from "../../components/EmailPreview";
import { t, LOCALE } from "../../lib/i18n";

const hourFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function formatHour(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : hourFmt.format(d);
}

export function CampaignReportPage() {
  const { id = "" } = useParams();
  const campaign = useAsync(() => api.campaigns.get(id), [id]);
  const stats = useAsync(() => api.campaigns.stats(id), [id]);
  const c = campaign.data;
  const s = stats.data;
  const inProgress = c?.status === "sending";

  // Poll while the worker is sending.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      void campaign.reload();
      void stats.reload();
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress]);

  if (campaign.error) return <ErrorState message={campaign.error} onRetry={campaign.reload} />;

  const funnel = s
    ? [
        { label: t("Destinataires", "Recipients"), value: s.recipients, ratio: 1, color: "bg-slate-400" },
        { label: t("Envoyés", "Sent"), value: s.sent, ratio: s.recipients ? s.sent / s.recipients : 0, color: "bg-brand-600" },
        { label: t("Ouverts", "Opened"), value: s.opened, ratio: s.sent ? s.opened / s.sent : 0, color: "bg-sky-500" },
        { label: t("Cliqués", "Clicked"), value: s.clicked, ratio: s.sent ? s.clicked / s.sent : 0, color: "bg-emerald-500" },
      ]
    : [];

  return (
    <>
      <PageHeader
        back={
          <Link to="/campagnes" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="size-4" /> {t("Campagnes", "Campaigns")}
          </Link>
        }
        title={
          c ? (
            <span className="flex flex-wrap items-center gap-3">
              {c.name}
              <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                {CAMPAIGN_STATUS[c.status]?.label}
              </Badge>
            </span>
          ) : (
            <Skeleton className="h-8 w-64" />
          )
        }
        description={c ? (c.sent_at ? t(`Envoyée le ${formatDateTime(c.sent_at)}`, `Sent ${formatDateTime(c.sent_at)}`) : c.subject) : undefined}
      />

      {inProgress && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          {t("Envoi en cours… les statistiques se mettent à jour automatiquement.", "Sending… stats update automatically.")}
        </div>
      )}

      {stats.error && (
        <div className="mb-6">
          <ErrorState message={stats.error} onRetry={stats.reload} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("Destinataires", "Recipients")} icon={Users} loading={!s} value={formatNumber(s?.recipients)} />
        <StatCard label={t("Envoyés", "Sent")} icon={Send} loading={!s} value={formatNumber(s?.sent)} />
        <StatCard label={t("Ouvertures", "Opens")} icon={MailOpen} loading={!s} value={formatPercent(s?.open_rate)} hint={s && t(`${formatNumber(s.opened)} contacts`, `${formatNumber(s.opened)} ${s.opened === 1 ? "contact" : "contacts"}`)} />
        <StatCard label={t("Clics", "Clicks")} icon={MousePointerClick} loading={!s} value={formatPercent(s?.click_rate)} hint={s && t(`${formatNumber(s.clicked)} contacts`, `${formatNumber(s.clicked)} ${s.clicked === 1 ? "contact" : "contacts"}`)} />
        <StatCard label={t("Désabonnements", "Unsubscribes")} icon={Ban} loading={!s} value={formatNumber(s?.unsubscribed)} />
        <StatCard label={t("Échecs", "Failed")} icon={TriangleAlert} loading={!s} value={formatNumber(s?.failed)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("Chronologie", "Timeline")} description={t("Ouvertures et clics par heure", "Opens and clicks per hour")} />
          <div className="p-4 sm:p-5">
            {!s ? (
              <Skeleton className="h-[280px] w-full" />
            ) : s.timeline.length === 0 ? (
              <EmptyState icon={MailOpen} title={t("Pas encore d'ouvertures", "No opens yet")} description={t("Les ouvertures et clics apparaîtront ici dès les premières interactions.", "Opens and clicks will show up here as soon as people interact.")} />
            ) : (
              <TimeAreaChart
                data={s.timeline}
                xKey="hour"
                formatX={formatHour}
                series={[
                  { key: "opens", label: t("Ouvertures", "Opens"), color: SERIES_COLORS.opened },
                  { key: "clicks", label: t("Clics", "Clicks"), color: SERIES_COLORS.clicked },
                ]}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Entonnoir", "Funnel")} />
          <div className="space-y-4 p-5">
            {!s
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)
              : funnel.map((f) => (
                  <div key={f.label}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300">{f.label}</span>
                      <span className="font-medium text-slate-900 tabular-nums dark:text-white">
                        {formatNumber(f.value)} <span className="text-xs font-normal text-slate-400">{formatPercent(f.ratio)}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={`h-full rounded-full ${f.color} transition-all`} style={{ width: `${Math.min(100, f.ratio * 100)}%` }} />
                    </div>
                  </div>
                ))}
            {s && s.sent > 0 && s.failed === 0 && (
              <p className="flex items-center gap-1.5 pt-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> {t("Aucun échec de livraison", "No delivery failures")}
              </p>
            )}
          </div>
        </Card>
      </div>

      {c?.html && (
        <Card className="mt-6">
          <EmailPreview html={c.html} subject={c.subject} preheader={c.preheader} fromName={c.from_name} height={560} />
        </Card>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Ban, CheckCircle2, MailOpen, MousePointerClick, Pause, Play, Send, ShieldAlert, Square, TriangleAlert, UserX, Users } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { CAMPAIGN_STATUS } from "../../lib/constants";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from "../../components/ui/primitives";
import { ConfirmModal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import type { CampaignPause } from "../../lib/types";
import { SERIES_COLORS, TimeAreaChart } from "../../components/charts";
import { EmailPreview } from "../../components/EmailPreview";
import { CampaignRecipients } from "./CampaignRecipients";
import { t, LOCALE } from "../../lib/i18n";

const hourFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function formatHour(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : hourFmt.format(d);
}

/** Why the sending stopped, in plain words. */
function pauseText(p: CampaignPause): { title: string; body: string } {
  const pct = formatPercent(p.rate ?? 0);
  const n = formatNumber(p.count ?? 0);
  const of = formatNumber(p.of ?? 0);
  const title = t("Envoi mis en pause automatiquement pour protéger votre réputation", "Sending paused automatically to protect your reputation");
  switch (p.kind) {
    case "complaints":
      return {
        title,
        body: t(
          `${n} signalements « spam » sur ${of} emails envoyés (${pct}). Gmail et Yahoo filtrent les expéditeurs au-delà de 0,3 %. Vérifiez que ces contacts ont bien accepté de recevoir vos emails avant de reprendre.`,
          `${n} spam complaints out of ${of} emails sent (${pct}). Gmail and Yahoo filter senders above 0.3%. Check that these contacts agreed to receive your emails before resuming.`,
        ),
      };
    case "bounces":
      return {
        title,
        body: t(
          `${n} adresses inexistantes sur ${of} emails envoyés (${pct}). Votre liste contient sans doute beaucoup d'adresses mortes : nettoyez-la avant de continuer, sinon les messageries vous classeront en spam.`,
          `${n} addresses that don't exist out of ${of} emails sent (${pct}). Your list probably holds many dead addresses: clean it before going on, or mailbox providers will mark you as spam.`,
        ),
      };
    case "blocks":
      return {
        title,
        body: t(
          `${n} emails refusés par les messageries sur ${of} envoyés (${pct}). Elles jugent l'envoi suspect : attendez quelques heures avant de reprendre, et envoyez d'abord à vos contacts les plus actifs.`,
          `${n} emails refused by mailbox providers out of ${of} sent (${pct}). They find the sending suspicious: wait a few hours before resuming, and send to your most active contacts first.`,
        ),
      };
    default:
      return { title: t("Envoi en pause", "Sending paused"), body: t("Vous avez mis l'envoi en pause. Les emails restants partiront quand vous reprendrez.", "You paused the sending. The remaining emails will go out when you resume.") };
  }
}

export function CampaignReportPage() {
  const { id = "" } = useParams();
  const campaign = useAsync(() => api.campaigns.get(id), [id]);
  const stats = useAsync(() => api.campaigns.stats(id), [id]);
  const c = campaign.data;
  const s = stats.data;
  const inProgress = c?.status === "sending";
  const paused = inProgress ? (c?.paused ?? null) : null;
  const toast = useToast();
  const [busy, setBusy] = useState<"pause" | "resume" | "stop" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const act = async (kind: "pause" | "resume" | "stop") => {
    setBusy(kind);
    try {
      await api.campaigns[kind](id);
      toast.success(kind === "pause" ? t("Envoi mis en pause", "Sending paused") : kind === "resume" ? t("Envoi repris", "Sending resumed") : t("Envoi arrêté", "Sending stopped"));
      setConfirmStop(false);
      await Promise.all([campaign.reload(), stats.reload()]);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

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
              {paused ? (
                <Badge tone={paused.kind === "manual" ? "slate" : "red"} dot>
                  {t("En pause", "Paused")}
                </Badge>
              ) : (
                <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                  {CAMPAIGN_STATUS[c.status]?.label}
                </Badge>
              )}
            </span>
          ) : (
            <Skeleton className="h-8 w-64" />
          )
        }
        description={c ? (c.sent_at ? t(`Envoyée le ${formatDateTime(c.sent_at)}`, `Sent ${formatDateTime(c.sent_at)}`) : c.subject) : undefined}
      />

      {inProgress && !paused && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="min-w-0 flex-1">
            {t("Envoi en cours… les statistiques se mettent à jour automatiquement.", "Sending… stats update automatically.")}
            <span className="mt-0.5 block text-xs opacity-80">
              {t(
                "Envoi progressif : vos contacts les plus actifs d'abord, réparti entre 8 h et 21 h et, pour une grosse campagne, sur plusieurs jours. Gmail et Outlook font ainsi confiance à votre serveur.",
                "Gradual sending: your most active contacts first, spread between 8 am and 9 pm and, for a big campaign, over several days. That's how Gmail and Outlook come to trust your server.",
              )}
            </span>
          </span>
          <Button variant="ghost" size="sm" icon={Pause} loading={busy === "pause"} onClick={() => void act("pause")}>
            {t("Mettre en pause", "Pause")}
          </Button>
        </div>
      )}

      {paused &&
        (() => {
          const text = pauseText(paused);
          const auto = paused.kind !== "manual";
          return (
            <div
              className={
                auto
                  ? "mb-6 rounded-xl bg-red-50 px-4 py-4 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900"
                  : "mb-6 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800"
              }
            >
              <div className="flex gap-3">
                {auto ? <ShieldAlert className="mt-0.5 size-5 shrink-0" /> : <Pause className="mt-0.5 size-5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{text.title}</p>
                  <p className="mt-1 opacity-90">{text.body}</p>
                  {auto && (
                    <p className="mt-1 text-xs opacity-75">
                      {t("Si vous reprenez, le contrôle repart de zéro sur les emails envoyés ensuite.", "If you resume, the check starts over on the emails sent from then on.")}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" icon={Play} loading={busy === "resume"} onClick={() => void act("resume")}>
                      {t("Reprendre l'envoi", "Resume sending")}
                    </Button>
                    <Button variant="ghost" size="sm" icon={Square} onClick={() => setConfirmStop(true)}>
                      {t("Arrêter l'envoi", "Stop sending")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {c && (c.skipped_inactive ?? 0) > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">
          <UserX className="mt-0.5 size-4 shrink-0" />
          <span>
            {c.skipped_inactive === 1
              ? t(
                  "1 contact inactif n'a pas reçu cette campagne : il a reçu au moins 5 emails en 6 mois sans en ouvrir aucun. L'écarter protège votre réputation auprès de Gmail et Outlook.",
                  "1 inactive contact didn't get this campaign: they received at least 5 emails in 6 months without opening any. Leaving them out protects your reputation with Gmail and Outlook.",
                )
              : t(
                  `${formatNumber(c.skipped_inactive)} contacts inactifs n'ont pas reçu cette campagne : ils ont reçu au moins 5 emails en 6 mois sans en ouvrir aucun. Les écarter protège votre réputation auprès de Gmail et Outlook.`,
                  `${formatNumber(c.skipped_inactive)} inactive contacts didn't get this campaign: they received at least 5 emails in 6 months without opening any. Leaving them out protects your reputation with Gmail and Outlook.`,
                )}
          </span>
        </div>
      )}

      <ConfirmModal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => void act("stop")}
        loading={busy === "stop"}
        danger
        title={t("Arrêter l'envoi ?", "Stop sending?")}
        description={t(
          "Les emails pas encore partis ne seront pas envoyés. Ceux déjà envoyés restent dans le rapport. Cette action est définitive.",
          "Emails not sent yet won't go out. Those already sent stay in the report. This can't be undone.",
        )}
        confirmLabel={t("Arrêter l'envoi", "Stop sending")}
      />

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

      {c && c.status !== "draft" && c.status !== "scheduled" && <CampaignRecipients campaignId={c.id} stats={s ?? undefined} live={inProgress} />}

      {c?.html && (
        <Card className="mt-6">
          <EmailPreview html={c.html} subject={c.subject} preheader={c.preheader} fromName={c.from_name} height={560} />
        </Card>
      )}
    </>
  );
}

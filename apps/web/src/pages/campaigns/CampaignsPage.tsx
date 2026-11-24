import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BarChart3, Copy, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { CAMPAIGN_STATUS } from "../../lib/constants";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import type { Campaign, CampaignStatus } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../../components/ui/primitives";
import { ConfirmModal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";

type Filter = "all" | CampaignStatus;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: t("Toutes", "All") },
  { value: "draft", label: t("Brouillons", "Drafts") },
  { value: "scheduled", label: t("Programmées", "Scheduled") },
  { value: "sending", label: t("En cours", "Sending") },
  { value: "sent", label: t("Envoyées", "Sent") },
];

function campaignLink(c: Campaign) {
  return c.status === "sent" || c.status === "sending" || c.status === "failed" ? `/campagnes/${c.id}/rapport` : `/campagnes/${c.id}`;
}

function Rate({ value, sub }: { value: string; sub: string }) {
  return (
    <div>
      <p className="font-medium text-slate-900 tabular-nums dark:text-white">{value}</p>
      <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">{sub}</p>
    </div>
  );
}

export function CampaignsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const campaigns = useAsync(() => api.campaigns.list(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [toDelete, setToDelete] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  const counts = useMemo(() => {
    const m: Partial<Record<Filter, number>> = { all: campaigns.data?.length ?? 0 };
    for (const c of campaigns.data ?? []) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [campaigns.data]);

  const rows = useMemo(
    () =>
      [...(campaigns.data ?? [])]
        .filter((c) => filter === "all" || c.status === filter)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [campaigns.data, filter],
  );

  async function duplicate(c: Campaign) {
    try {
      const copy = await api.campaigns.create({
        name: t(`${c.name} (copie)`, `${c.name} (copy)`),
        subject: c.subject,
        preheader: c.preheader ?? undefined,
        from_name: c.from_name ?? undefined,
        from_email: c.from_email ?? undefined,
        html: c.html ?? undefined,
        segment_id: c.segment_id,
      });
      toast.success(t("Campagne dupliquée", "Campaign duplicated"));
      navigate(`/campagnes/${copy.id}`);
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.campaigns.remove(toDelete.id);
      campaigns.setData((prev) => (prev ?? []).filter((c) => c.id !== toDelete.id));
      toast.success(t("Campagne supprimée", "Campaign deleted"));
      setToDelete(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("Campagnes", "Campaigns")}
        description={t("Créez, testez et envoyez vos emails.", "Create, test and send your emails.")}
        actions={
          <Link to="/campagnes/nouvelle">
            <Button icon={Plus}>{t("Nouvelle campagne", "New campaign")}</Button>
          </Link>
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
              filter === f.value
                ? "bg-white text-slate-900 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {f.label}
            <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-500 tabular-nums dark:bg-slate-800 dark:text-slate-400">{counts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card>
        {campaigns.error ? (
          <div className="p-5">
            <ErrorState message={campaigns.error} onRetry={campaigns.reload} />
          </div>
        ) : campaigns.loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Send}
            title={filter === "all" ? t("Aucune campagne", "No campaigns") : t("Aucune campagne dans cette catégorie", "No campaigns in this category")}
            description={t("Rédigez votre première campagne en quelques minutes, à partir de nos modèles.", "Write your first campaign in minutes, starting from our templates.")}
            action={
              <Link to="/campagnes/nouvelle">
                <Button icon={Plus}>{t("Créer une campagne", "Create a campaign")}</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:text-slate-400">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="px-5 py-3 font-medium">{t("Campagne", "Campaign")}</th>
                  <th className="px-3 py-3 font-medium">{t("Statut", "Status")}</th>
                  <th className="px-3 py-3 font-medium">{t("Envoyés", "Sent")}</th>
                  <th className="px-3 py-3 font-medium">{t("Ouvertures", "Opens")}</th>
                  <th className="px-3 py-3 font-medium">{t("Clics", "Clicks")}</th>
                  <th className="px-3 py-3 font-medium">{t("Date", "Date")}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((c) => {
                  const st = c.stats;
                  const hasStats = !!st && (c.status === "sent" || c.status === "sending");
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="max-w-[320px] px-5 py-3.5">
                        <Link to={campaignLink(c)} className="block">
                          <p className="truncate font-medium text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{c.name}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.subject}</p>
                        </Link>
                      </td>
                      <td className="px-3 py-3.5">
                        {c.status === "sending" && c.paused ? (
                          <Badge tone={c.paused.kind === "manual" ? "slate" : "red"} dot>
                            {t("En pause", "Paused")}
                          </Badge>
                        ) : (
                          <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                            {CAMPAIGN_STATUS[c.status]?.label ?? c.status}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatNumber(st.sent)} sub={t(`sur ${formatNumber(st.recipients)}`, `of ${formatNumber(st.recipients)}`)} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatPercent(st.open_rate)} sub={t(`${formatNumber(st.opened)} ouvertures`, `${formatNumber(st.opened)} ${st.opened === 1 ? "open" : "opens"}`)} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatPercent(st.click_rate)} sub={t(`${formatNumber(st.clicked)} clics`, `${formatNumber(st.clicked)} ${st.clicked === 1 ? "click" : "clicks"}`)} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {c.status === "scheduled" ? t(`Prévue le ${formatDateTime(c.scheduled_at)}`, `Scheduled for ${formatDateTime(c.scheduled_at)}`) : c.sent_at ? formatDateTime(c.sent_at) : t(`Modifiée le ${formatDateTime(c.updated_at)}`, `Edited ${formatDateTime(c.updated_at)}`)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-1">
                          {c.status === "draft" || c.status === "scheduled" ? (
                            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => navigate(`/campagnes/${c.id}`)} aria-label={t("Modifier", "Edit")} title={t("Modifier", "Edit")} />
                          ) : (
                            <Button variant="ghost" size="sm" icon={BarChart3} onClick={() => navigate(`/campagnes/${c.id}/rapport`)} aria-label={t("Rapport", "Report")} title={t("Rapport", "Report")} />
                          )}
                          <Button variant="ghost" size="sm" icon={Copy} onClick={() => void duplicate(c)} aria-label={t("Dupliquer", "Duplicate")} title={t("Dupliquer", "Duplicate")} />
                          {c.status !== "sending" && (
                            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToDelete(c)} aria-label={t("Supprimer", "Delete")} title={t("Supprimer", "Delete")} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        danger
        title={toDelete?.status === "draft" ? t("Supprimer ce brouillon ?", "Delete this draft?") : t("Supprimer cette campagne ?", "Delete this campaign?")}
        description={
          toDelete?.status === "sent" || toDelete?.status === "failed"
            ? t(
                `« ${toDelete.name} » et son rapport seront définitivement supprimés. Les emails déjà reçus restent dans les boîtes de vos contacts, et les chiffres globaux de vos statistiques ne changent pas.`,
                `“${toDelete.name}” and its report will be permanently deleted. Emails already received stay in your contacts' inboxes, and your overall statistics don't change.`,
              )
            : toDelete?.status === "scheduled"
              ? t(`« ${toDelete.name} » sera définitivement supprimée et ne partira pas.`, `“${toDelete.name}” will be permanently deleted and won't be sent.`)
              : t(`« ${toDelete?.name ?? ""} » sera définitivement supprimé.`, `“${toDelete?.name ?? ""}” will be permanently deleted.`)
        }
        confirmLabel={t("Supprimer", "Delete")}
      />
    </>
  );
}

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

type Filter = "all" | CampaignStatus;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "draft", label: "Brouillons" },
  { value: "scheduled", label: "Programmées" },
  { value: "sending", label: "En cours" },
  { value: "sent", label: "Envoyées" },
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
        name: `${c.name} (copie)`,
        subject: c.subject,
        preheader: c.preheader ?? undefined,
        from_name: c.from_name ?? undefined,
        from_email: c.from_email ?? undefined,
        html: c.html ?? undefined,
        segment_id: c.segment_id,
      });
      toast.success("Campagne dupliquée");
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
      toast.success("Campagne supprimée");
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
        title="Campagnes"
        description="Créez, testez et envoyez vos emails."
        actions={
          <Link to="/campagnes/nouvelle">
            <Button icon={Plus}>Nouvelle campagne</Button>
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
            title={filter === "all" ? "Aucune campagne" : "Aucune campagne dans cette catégorie"}
            description="Rédigez votre première campagne en quelques minutes, à partir de nos modèles."
            action={
              <Link to="/campagnes/nouvelle">
                <Button icon={Plus}>Créer une campagne</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:text-slate-400">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="px-5 py-3 font-medium">Campagne</th>
                  <th className="px-3 py-3 font-medium">Statut</th>
                  <th className="px-3 py-3 font-medium">Envoyés</th>
                  <th className="px-3 py-3 font-medium">Ouvertures</th>
                  <th className="px-3 py-3 font-medium">Clics</th>
                  <th className="px-3 py-3 font-medium">Date</th>
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
                        <Badge tone={CAMPAIGN_STATUS[c.status]?.tone} dot>
                          {CAMPAIGN_STATUS[c.status]?.label ?? c.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatNumber(st.sent)} sub={`sur ${formatNumber(st.recipients)}`} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatPercent(st.open_rate)} sub={`${formatNumber(st.opened)} ouvertures`} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5">{hasStats ? <Rate value={formatPercent(st.click_rate)} sub={`${formatNumber(st.clicked)} clics`} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                        {c.status === "scheduled" ? `Prévue le ${formatDateTime(c.scheduled_at)}` : c.sent_at ? formatDateTime(c.sent_at) : `Modifiée le ${formatDateTime(c.updated_at)}`}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-end gap-1">
                          {c.status === "draft" || c.status === "scheduled" ? (
                            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => navigate(`/campagnes/${c.id}`)} aria-label="Modifier" title="Modifier" />
                          ) : (
                            <Button variant="ghost" size="sm" icon={BarChart3} onClick={() => navigate(`/campagnes/${c.id}/rapport`)} aria-label="Rapport" title="Rapport" />
                          )}
                          <Button variant="ghost" size="sm" icon={Copy} onClick={() => void duplicate(c)} aria-label="Dupliquer" title="Dupliquer" />
                          {c.status === "draft" && (
                            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToDelete(c)} aria-label="Supprimer" title="Supprimer" />
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
        title="Supprimer ce brouillon ?"
        description={`« ${toDelete?.name ?? ""} » sera définitivement supprimé.`}
        confirmLabel="Supprimer"
      />
    </>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Filter, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { formatDate, formatNumber } from "../../lib/format";
import type { Segment } from "../../lib/types";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../../components/ui/primitives";
import { ConfirmModal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { describeRules } from "./summary";

export function SegmentsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const segments = useAsync(() => api.segments.list(), []);
  const [toDelete, setToDelete] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.segments.remove(toDelete.id);
      segments.setData((prev) => (prev ?? []).filter((s) => s.id !== toDelete.id));
      toast.success("Segment supprimé");
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
        title="Segments"
        description="Ciblez les bons contacts grâce à des règles dynamiques."
        actions={
          <Link to="/segments/nouveau">
            <Button icon={Plus}>Nouveau segment</Button>
          </Link>
        }
      />

      {segments.error ? (
        <ErrorState message={segments.error} onRetry={segments.reload} />
      ) : segments.loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-24" />
            </Card>
          ))}
        </div>
      ) : (segments.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={Filter}
            title="Aucun segment"
            description="Créez un segment, par exemple « Clients VIP » ou « Inactifs depuis 90 jours »."
            action={
              <Link to="/segments/nouveau">
                <Button icon={Plus}>Créer un segment</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {segments.data!.map((s) => (
            <Card key={s.id} className="group flex flex-col p-5 transition hover:shadow-md hover:ring-1 hover:ring-brand-200 dark:hover:ring-brand-800">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => navigate(`/segments/${s.id}`)} className="min-w-0 text-left">
                  <h3 className="truncate font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{describeRules(s.rules)}</p>
                </button>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <Filter className="size-4" />
                </span>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <p className="flex items-center gap-1.5 display text-[34px] leading-none text-slate-950 tabular-nums dark:text-white">
                    <Users className="size-4 text-slate-400" />
                    {formatNumber(s.count)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">contacts · modifié le {formatDate(s.updated_at)}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => navigate(`/segments/${s.id}`)} aria-label="Modifier" />
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToDelete(s)} aria-label="Supprimer" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        danger
        title="Supprimer ce segment ?"
        description={`« ${toDelete?.name ?? ""} » sera supprimé. Les contacts ne sont pas affectés.`}
        confirmLabel="Supprimer"
      />
    </>
  );
}

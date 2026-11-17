import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { BellRing, Clock, Mail, Pause, Play, Plus, Trash2, Workflow, Zap } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { TRIGGERS } from "../../lib/constants";
import { formatNumber } from "../../lib/format";
import type { Automation } from "../../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../../components/ui/primitives";
import { ConfirmModal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";

export function triggerLabel(a: Pick<Automation, "trigger" | "trigger_config">): string {
  const base = TRIGGERS[a.trigger]?.label ?? a.trigger;
  const tag = a.trigger_config && typeof a.trigger_config.tag === "string" ? a.trigger_config.tag : null;
  return a.trigger === "tag_added" && tag ? t(`${base} : #${tag}`, `${base}: #${tag}`) : base;
}

export function AutomationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const automations = useAsync(() => api.automations.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function toggle(a: Automation) {
    setBusy(a.id);
    try {
      if (a.status === "active") await api.automations.pause(a.id);
      else await api.automations.activate(a.id);
      const status = a.status === "active" ? "paused" : "active";
      automations.setData((prev) => (prev ?? []).map((x) => (x.id === a.id ? { ...x, status } : x)));
      toast.success(status === "active" ? t("Automatisation activée", "Automation activated") : t("Automatisation en pause", "Automation paused"));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.automations.remove(toDelete.id);
      automations.setData((prev) => (prev ?? []).filter((x) => x.id !== toDelete.id));
      toast.success(t("Automatisation supprimée", "Automation deleted"));
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
        title={t("Automatisations", "Automations")}
        description={t("Des scénarios qui travaillent pour vous : bienvenue, relance panier, fidélisation…", "Workflows that work for you: welcome, abandoned cart, loyalty…")}
        actions={
          <Link to="/automatisations/nouvelle">
            <Button icon={Plus}>{t("Nouvelle automatisation", "New automation")}</Button>
          </Link>
        }
      />

      {automations.error ? (
        <ErrorState message={automations.error} onRetry={automations.reload} />
      ) : automations.loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (automations.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={Workflow}
            title={t("Aucune automatisation", "No automations yet")}
            description={t("Commencez par un email de bienvenue ou une relance de panier abandonné.", "Start with a welcome email or an abandoned cart reminder.")}
            action={
              <Link to="/automatisations/nouvelle">
                <Button icon={Plus}>{t("Créer une automatisation", "Create an automation")}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {automations.data!.map((a) => {
            const emails = a.steps.filter((s) => s.type === "email").length;
            const waits = a.steps.filter((s) => s.type === "wait").length;
            const pushes = a.steps.filter((s) => s.type === "push").length;
            return (
              <Card key={a.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <button onClick={() => navigate(`/automatisations/${a.id}`)} className="flex min-w-0 flex-1 items-start gap-4 text-left">
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                      a.status === "active"
                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    <Zap className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-900 dark:text-white">{a.name}</h3>
                      <Badge tone={a.status === "active" ? "green" : "slate"} dot>
                        {a.status === "active" ? t("Active", "Active") : t("En pause", "Paused")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("Déclencheur : ", "Trigger: ")}{triggerLabel(a)}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {emails > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3.5" /> {t(`${emails} email${emails > 1 ? "s" : ""}`, `${emails} email${emails === 1 ? "" : "s"}`)}
                        </span>
                      )}
                      {waits > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" /> {t(`${waits} attente${waits > 1 ? "s" : ""}`, `${waits} delay${waits === 1 ? "" : "s"}`)}
                        </span>
                      )}
                      {pushes > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <BellRing className="size-3.5" /> {t(`${pushes} push`, `${pushes} push`)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="text-center">
                    <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatNumber(a.runs_active)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("en cours", "in progress")}</p>
                  </div>
                  {(emails > 0 || pushes === 0) && (
                    <div className="text-center">
                      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatNumber(a.emails_sent)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t("emails envoyés", "emails sent")}</p>
                    </div>
                  )}
                  {pushes > 0 && (
                    <div className="text-center">
                      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatNumber(a.push_sent)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t("push envoyés", "pushes sent")}</p>
                    </div>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant={a.status === "active" ? "secondary" : "primary"}
                      size="sm"
                      icon={a.status === "active" ? Pause : Play}
                      loading={busy === a.id}
                      onClick={() => void toggle(a)}
                    >
                      {a.status === "active" ? t("Pause", "Pause") : t("Activer", "Activate")}
                    </Button>
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToDelete(a)} aria-label={t("Supprimer", "Delete")} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        danger
        title={t("Supprimer cette automatisation ?", "Delete this automation?")}
        description={t("Les parcours en cours seront annulés.", "Journeys in progress will be canceled.")}
        confirmLabel={t("Supprimer", "Delete")}
      />
    </>
  );
}

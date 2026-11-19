import { useState } from "react";
import { useSearchParams } from "react-router";
import { Activity, LayoutGrid, MailCheck, RefreshCw, Server, Users } from "lucide-react";
import { Button, PageHeader, Segmented, Skeleton } from "../../components/ui/primitives";
import { NotFoundPage } from "../NotFoundPage";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useAdminAccess } from "../../lib/useAdminAccess";
import { formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import { OverviewTab } from "./OverviewTab";
import { AccountsTab } from "./AccountsTab";
import { DeliverabilityTab } from "./DeliverabilityTab";
import { ActivityTab } from "./ActivityTab";
import { SystemTab } from "./SystemTab";
import { AccountDetailModal } from "./AccountDetailModal";

type Tab = "overview" | "accounts" | "deliverability" | "activity" | "system";
type Days = "7" | "30" | "90";
const TABS: Tab[] = ["overview", "accounts", "deliverability", "activity", "system"];

/** /admin: visible to platform admins only; anyone else gets the regular 404 page. */
export function AdminRoute() {
  const admin = useAdminAccess();
  if (admin === undefined) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-10 w-full max-w-xl rounded-full" />
        <Skeleton className="h-64 rounded-[20px]" />
      </div>
    );
  }
  return admin ? <AdminPage /> : <NotFoundPage />;
}

function AdminPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("onglet") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "overview";
  const setTab = (next: Tab) =>
    setParams(
      (p) => {
        if (next === "overview") p.delete("onglet");
        else p.set("onglet", next);
        return p;
      },
      { replace: true },
    );

  const [days, setDays] = useState<Days>("30");
  const n = Number(days);
  const overview = useAsync(() => api.admin.overview(n), [n]);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const showPeriod = tab === "overview" || tab === "deliverability";

  return (
    <>
      <PageHeader
        title={t("Administration", "Administration")}
        description={t(
          "Vue d'ensemble de la plateforme, tous comptes confondus. Lecture seule.",
          "Platform-wide overview across every account. Read-only.",
        )}
        actions={
          <>
            {overview.data && (
              <span className="text-xs text-slate-500 dark:text-slate-400" title={overview.data.generated_at}>
                {t("Données", "Data")} {formatRelative(overview.data.generated_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={overview.loading && !!overview.data}
              onClick={() => {
                void overview.reload();
                setRefreshKey((k) => k + 1);
              }}
            >
              {t("Actualiser", "Refresh")}
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="max-w-full overflow-x-auto">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: t("Vue d'ensemble", "Overview"), icon: LayoutGrid },
              { value: "accounts", label: t("Comptes", "Accounts"), icon: Users },
              { value: "deliverability", label: t("Délivrabilité", "Deliverability"), icon: MailCheck },
              { value: "activity", label: t("Activité", "Activity"), icon: Activity },
              { value: "system", label: t("Système", "System"), icon: Server },
            ]}
          />
        </div>
        {showPeriod && (
          <Segmented<Days>
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: t("7 jours", "7 days") },
              { value: "30", label: t("30 jours", "30 days") },
              { value: "90", label: t("90 jours", "90 days") },
            ]}
            className="self-start md:self-auto"
          />
        )}
      </div>

      <div key={refreshKey}>
        {tab === "overview" && <OverviewTab days={n} overview={overview} />}
        {tab === "accounts" && <AccountsTab onOpen={setOpenAccount} />}
        {tab === "deliverability" && <DeliverabilityTab days={n} overview={overview} onOpen={setOpenAccount} />}
        {tab === "activity" && <ActivityTab onOpen={setOpenAccount} />}
        {tab === "system" && <SystemTab overview={overview} />}
      </div>

      <AccountDetailModal id={openAccount} onClose={() => setOpenAccount(null)} />
    </>
  );
}

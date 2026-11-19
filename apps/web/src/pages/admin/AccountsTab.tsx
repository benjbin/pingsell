import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, BadgeCheck, CircleDashed, Search, Users } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync, useDebounced } from "../../lib/useAsync";
import { cx, formatDate, formatNumber, formatRelative } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { AdminAccountRow, AdminAccountSort } from "../../lib/types";
import { Card, EmptyState, ErrorState, Input, Pagination, TableSkeleton } from "../../components/ui/primitives";
import { fmtRate, HealthBadge, INTEGRATION_LABEL, TableScroll, TD, TH, THEAD } from "./shared";

const LIMIT = 25;
type Order = "asc" | "desc";

export function AccountsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [sort, setSort] = useState<AdminAccountSort>("created_at");
  const [order, setOrder] = useState<Order>("desc");
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [q, sort, order]);

  const list = useAsync(
    () => api.admin.accounts({ search: q || undefined, sort, order, limit: LIMIT, offset: (page - 1) * LIMIT }),
    [q, sort, order, page],
  );

  const onSort = (key: AdminAccountSort) => {
    if (key === sort) setOrder((o) => (o === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setOrder("desc");
    }
  };

  const rows = list.data?.data;
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-900/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-white/10">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{t("Comptes", "Accounts")}</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {list.data ? t(`${formatNumber(list.data.total)} compte${list.data.total > 1 ? "s" : ""}`, `${formatNumber(list.data.total)} account${list.data.total === 1 ? "" : "s"}`) : " "}
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, email du compte ou d'un utilisateur", "Name, account or user email")}
            aria-label={t("Rechercher un compte", "Search accounts")}
            className="pl-9"
          />
        </div>
      </div>

      {list.error ? (
        <div className="p-5 sm:p-6">
          <ErrorState message={list.error} onRetry={list.reload} />
        </div>
      ) : !rows ? (
        <TableSkeleton rows={8} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? t("Aucun résultat", "No results") : t("Aucun compte", "No accounts")}
          description={q ? t(`Aucun compte ne correspond à « ${q} ».`, `No account matches “${q}”.`) : undefined}
        />
      ) : (
        <>
          <AccountsTable rows={rows} onOpen={onOpen} sort={{ key: sort, order, onSort }} dim={list.loading} />
          <Pagination page={page} limit={LIMIT} total={list.data?.total ?? 0} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function SortTh({
  label,
  k,
  sort,
  align = "left",
}: {
  label: string;
  k: AdminAccountSort;
  sort?: { key: AdminAccountSort; order: Order; onSort: (k: AdminAccountSort) => void };
  align?: "left" | "right";
}) {
  if (!sort) return <th className={cx(TH, align === "right" && "text-right")}>{label}</th>;
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.order === "desc" ? ArrowDown : ArrowUp;
  return (
    <th className={cx(TH, align === "right" && "text-right")} aria-sort={active ? (sort.order === "desc" ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        onClick={() => sort.onSort(k)}
        className={cx(
          "inline-flex items-center gap-1 uppercase transition hover:text-slate-900 dark:hover:text-white",
          active && "text-slate-900 dark:text-white",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon className={cx("size-3.5", !active && "opacity-50")} aria-hidden />
      </button>
    </th>
  );
}

/** Account table, shared by the accounts and deliverability tabs (sorting only when `sort` is given). */
export function AccountsTable({
  rows,
  onOpen,
  sort,
  dim,
}: {
  rows: AdminAccountRow[];
  onOpen: (id: string) => void;
  sort?: { key: AdminAccountSort; order: Order; onSort: (k: AdminAccountSort) => void };
  dim?: boolean;
}) {
  return (
    <TableScroll minWidth={1080} dim={dim}>
      <thead className={THEAD}>
        <tr className="border-b border-slate-100 dark:border-slate-800">
          <th className={TH}>{t("Compte", "Account")}</th>
          <th className={TH}>{t("Santé", "Health")}</th>
          <SortTh label={t("Créé le", "Created")} k="created_at" sort={sort} />
          <SortTh label={t("Vu", "Last seen")} k="last_seen" sort={sort} />
          <SortTh label="Contacts" k="contacts" sort={sort} align="right" />
          <SortTh label={t("Emails 30 j", "Emails 30 d")} k="emails_30d" sort={sort} align="right" />
          <SortTh label={t("Rebond 30 j", "Bounce 30 d")} k="bounce_rate" sort={sort} align="right" />
          <th className={TH}>{t("Intégrations", "Integrations")}</th>
          <th className={TH}>{t("Domaine d'envoi", "Sending domain")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((a) => (
          <tr
            key={a.id}
            onClick={() => onOpen(a.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(a.id))}
            tabIndex={0}
            className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/40 dark:focus-visible:bg-slate-800/40"
          >
            <td className={TD}>
              <p className="max-w-[240px] truncate font-medium text-slate-900 dark:text-white">{a.name || "—"}</p>
              <p className="max-w-[240px] truncate text-xs text-slate-500 dark:text-slate-400">{a.email}</p>
            </td>
            <td className={TD}>
              <HealthBadge health={a.health} />
            </td>
            <td className={cx(TD, "whitespace-nowrap text-slate-500 dark:text-slate-400")}>{formatDate(a.created_at)}</td>
            <td className={cx(TD, "whitespace-nowrap text-slate-500 dark:text-slate-400")} title={a.last_seen_at ?? undefined}>
              {a.last_seen_at ? formatRelative(a.last_seen_at) : t("Jamais", "Never")}
            </td>
            <td className={cx(TD, "text-right text-slate-700 tabular-nums dark:text-slate-300")}>
              {formatNumber(a.contacts)}
              <span className="block text-[11px] text-slate-400">{t(`${formatNumber(a.contacts_subscribed)} abonnés`, `${formatNumber(a.contacts_subscribed)} subscribed`)}</span>
            </td>
            <td className={cx(TD, "text-right text-slate-700 tabular-nums dark:text-slate-300")}>{formatNumber(a.emails_30d)}</td>
            <td className={cx(TD, "text-right text-slate-700 tabular-nums dark:text-slate-300")}>
              {fmtRate(a.bounce_rate_30d)}
              {a.complaints_30d > 0 && (
                <span className="block text-[11px] text-slate-400">{t(`${a.complaints_30d} plainte${a.complaints_30d > 1 ? "s" : ""}`, `${a.complaints_30d} complaint${a.complaints_30d === 1 ? "" : "s"}`)}</span>
              )}
            </td>
            <td className={TD}>
              {a.integrations.length ? (
                <div className="flex max-w-[220px] flex-wrap gap-1">
                  {a.integrations.map((i) => (
                    <span key={i} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {INTEGRATION_LABEL[i] ?? i}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
            <td className={TD}>
              <DomainCell domain={a.sending_domain} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
}

export function DomainCell({ domain }: { domain: AdminAccountRow["sending_domain"] }) {
  if (!domain) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex max-w-[200px] items-center gap-1.5 text-slate-700 dark:text-slate-300">
      {domain.verified ? (
        <BadgeCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label={t("Vérifié", "Verified")} />
      ) : (
        <CircleDashed className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label={t("Non vérifié", "Not verified")} />
      )}
      <span className="truncate">{domain.domain}</span>
      <span className="sr-only">{domain.verified ? t("(vérifié)", "(verified)") : t("(non vérifié)", "(not verified)")}</span>
    </span>
  );
}

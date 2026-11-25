import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync, useDebounced } from "../../lib/useAsync";
import { formatDateTime, formatNumber } from "../../lib/format";
import type { CampaignRecipient, CampaignStats, RecipientFilter } from "../../lib/types";
import { Badge, Card, CardHeader, Input, Pagination, Segmented, TableSkeleton } from "../../components/ui/primitives";
import { t } from "../../lib/i18n";

const LIMIT = 50;

function outcome(r: CampaignRecipient): { label: string; tone: "green" | "blue" | "slate" | "red" | "amber"; at: string | null } {
  if (r.status === "failed" || r.status === "bounced") return { label: r.status === "bounced" ? t("Rejeté", "Bounced") : t("Échec", "Failed"), tone: "red", at: r.sent_at };
  if (r.status === "queued") return { label: t("En attente", "Queued"), tone: "amber", at: null };
  if (r.clicked_at) return { label: t("A cliqué", "Clicked"), tone: "green", at: r.clicked_at };
  if (r.opened_at) return { label: t("A ouvert", "Opened"), tone: "blue", at: r.opened_at };
  return { label: t("Reçu", "Delivered"), tone: "slate", at: r.sent_at };
}

/** Campaign report → the list of people it went to, filterable by what they did. */
export function CampaignRecipients({ campaignId, stats, live }: { campaignId: string; stats?: CampaignStats; live?: boolean }) {
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), 250);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter, search]);

  const list = useAsync(() => api.campaigns.recipients(campaignId, { filter, search: search || undefined, page, limit: LIMIT }), [campaignId, filter, search, page]);

  // Follow the sending progress.
  useEffect(() => {
    if (!live) return;
    // Every 10 s, and not while the tab is in the background.
    const timer = setInterval(() => {
      if (!document.hidden) void list.reload();
    }, 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const count = (n?: number) => (n == null ? "" : ` (${formatNumber(n)})`);
  const options: Array<{ value: RecipientFilter; label: string }> = [
    { value: "all", label: t("Tous", "All") + count(stats?.recipients) },
    { value: "opened", label: t("Ont ouvert", "Opened") + count(stats?.opened) },
    { value: "clicked", label: t("Ont cliqué", "Clicked") + count(stats?.clicked) },
    { value: "not_opened", label: t("Pas ouvert", "Not opened") },
    { value: "unsubscribed", label: t("Désabonnés", "Unsubscribed") + count(stats?.unsubscribed) },
    { value: "failed", label: t("Échecs", "Failed") + count(stats?.failed) },
  ];

  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Card className="mt-6">
      <CardHeader
        title={t("Destinataires", "Recipients")}
        description={t("Les personnes à qui la campagne a été envoyée, et ce qu'elles en ont fait.", "The people the campaign was sent to, and what they did with it.")}
      />
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
        <div className="overflow-x-auto">
          <Segmented value={filter} onChange={setFilter} options={options} />
        </div>
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Chercher un nom ou un email…", "Search a name or email…")} className="pl-9" aria-label={t("Chercher un destinataire", "Search a recipient")} />
        </div>
      </div>

      {list.loading && !list.data ? (
        <TableSkeleton rows={5} cols={3} />
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {search ? t("Aucun destinataire ne correspond à cette recherche.", "No recipient matches this search.") : t("Personne dans cette catégorie pour l'instant.", "Nobody in this category yet.")}
        </p>
      ) : (
        <>
          <div className={`overflow-x-auto ${list.loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:text-slate-400">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="px-5 py-3 font-medium">{t("Destinataire", "Recipient")}</th>
                  <th className="px-3 py-3 font-medium">{t("Résultat", "Outcome")}</th>
                  <th className="px-3 py-3 font-medium">{t("Envoyé le", "Sent")}</th>
                  <th className="px-5 py-3 font-medium">{t("Dernière action", "Last action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => {
                  const o = outcome(r);
                  const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
                  return (
                    <tr key={r.id}>
                      <td className="px-5 py-3">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{name || r.to_email}</p>
                        {name && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{r.to_email}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={o.tone} dot>
                            {o.label}
                          </Badge>
                          {r.unsubscribed && <Badge tone="amber">{t("Désabonné", "Unsubscribed")}</Badge>}
                        </div>
                        {r.error && (
                          <p className="mt-1 max-w-xs truncate text-xs text-red-600 dark:text-red-400" title={r.error}>
                            {r.error}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{r.sent_at ? formatDateTime(r.sent_at) : "—"}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{o.at && o.at !== r.sent_at ? formatDateTime(o.at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > LIMIT && <Pagination page={page} limit={LIMIT} total={total} onChange={setPage} />}
        </>
      )}
    </Card>
  );
}

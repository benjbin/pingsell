import { useState } from "react";
import { Search, Upload, UserPlus, Users } from "lucide-react";
import { api } from "../../lib/api";
import { useAsync, useDebounced } from "../../lib/useAsync";
import { CONTACT_SOURCE, CONTACT_STATUS } from "../../lib/constants";
import { formatCurrency, formatDate, fullName, initials } from "../../lib/format";
import type { ContactStatus } from "../../lib/types";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  TableSkeleton,
  TagChip,
} from "../../components/ui/primitives";
import { AddContactModal } from "./AddContactModal";
import { ImportContactsModal } from "./ImportContactsModal";
import { ContactDrawer } from "./ContactDrawer";

const LIMIT = 25;

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<ContactStatus | "">("");
  const [segmentId, setSegmentId] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = useDebounced(search, 300);

  const contacts = useAsync(
    () => api.contacts.list({ search: q, tag, status, segment_id: segmentId, page, limit: LIMIT }),
    [q, tag, status, segmentId, page],
  );
  const tags = useAsync(() => api.tags(), []);
  const segments = useAsync(() => api.segments.list(), []);

  const hasFilters = !!(q || tag || status || segmentId);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  function refreshAll() {
    void contacts.reload();
    void tags.reload();
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description={contacts.data ? `${contacts.data.total} contact${contacts.data.total > 1 ? "s" : ""}` : "Votre audience"}
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
              Importer un CSV
            </Button>
            <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
              Ajouter un contact
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Rechercher par nom ou email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:flex">
            <Select value={status} onChange={(e) => resetPage(setStatus)(e.target.value as ContactStatus | "")} className="xl:w-40" aria-label="Statut">
              <option value="">Tous les statuts</option>
              {(Object.keys(CONTACT_STATUS) as ContactStatus[]).map((s) => (
                <option key={s} value={s}>
                  {CONTACT_STATUS[s].label}
                </option>
              ))}
            </Select>
            <Select value={tag} onChange={(e) => resetPage(setTag)(e.target.value)} className="xl:w-40" aria-label="Tag">
              <option value="">Tous les tags</option>
              {(tags.data ?? []).map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </Select>
            <Select value={segmentId} onChange={(e) => resetPage(setSegmentId)(e.target.value)} className="xl:w-44" aria-label="Segment">
              <option value="">Tous les segments</option>
              {(segments.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {contacts.error ? (
          <div className="p-5">
            <ErrorState message={contacts.error} onRetry={contacts.reload} />
          </div>
        ) : contacts.loading && !contacts.data ? (
          <TableSkeleton rows={8} cols={5} />
        ) : contacts.data && contacts.data.data.length === 0 ? (
          hasFilters ? (
            <EmptyState icon={Search} title="Aucun résultat" description="Aucun contact ne correspond à ces filtres." />
          ) : (
            <EmptyState
              icon={Users}
              title="Aucun contact pour l'instant"
              description="Importez votre liste existante, connectez Shopify ou ajoutez un contact à la main."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                    Importer un CSV
                  </Button>
                  <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
                    Ajouter un contact
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <>
            <div className={`overflow-x-auto ${contacts.loading ? "opacity-60" : ""}`}>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase dark:text-slate-400">
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-5 py-3 font-medium">Contact</th>
                    <th className="px-3 py-3 font-medium">Statut</th>
                    <th className="px-3 py-3 font-medium">Tags</th>
                    <th className="px-3 py-3 text-right font-medium">Dépensé</th>
                    <th className="px-3 py-3 font-medium">Source</th>
                    <th className="px-5 py-3 font-medium">Ajouté le</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {contacts.data?.data.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar text={initials(c)} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-white">{fullName(c)}</p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={CONTACT_STATUS[c.status]?.tone} dot>
                          {CONTACT_STATUS[c.status]?.label ?? c.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <TagChip key={t} tag={t} />
                          ))}
                          {c.tags.length > 3 && <span className="text-xs text-slate-400">+{c.tags.length - 3}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700 tabular-nums dark:text-slate-300">{formatCurrency(c.total_spent)}</td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400">{CONTACT_SOURCE[c.source] ?? c.source}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {contacts.data && <Pagination page={page} limit={LIMIT} total={contacts.data.total} onChange={setPage} />}
          </>
        )}
      </Card>

      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={refreshAll} />
      <ImportContactsModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refreshAll} />
      <ContactDrawer contactId={selectedId} onClose={() => setSelectedId(null)} onChanged={refreshAll} />
    </>
  );
}

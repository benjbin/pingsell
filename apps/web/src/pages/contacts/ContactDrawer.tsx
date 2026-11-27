import { useState } from "react";
import {
  Activity,
  Ban,
  Eye,
  CalendarClock,
  MailOpen,
  MousePointerClick,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Trash2,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { languageName } from "../campaigns/TranslateSettings";
import { useAsync } from "../../lib/useAsync";
import { CONTACT_SOURCE, CONTACT_STATUS, EVENT_LABELS } from "../../lib/constants";
import { formatCurrency, formatDate, formatDateTime, formatRelative, fullName, initials } from "../../lib/format";
import type { ContactDetail, ContactEvent, ContactStatus, EventType } from "../../lib/types";
import { Avatar, Badge, Button, ErrorState, Select, Skeleton } from "../../components/ui/primitives";
import { ConfirmModal, Drawer } from "../../components/ui/Overlay";
import { TagInput } from "../../components/ui/TagInput";
import { useToast } from "../../components/ui/Toast";
import { t, LOCALE } from "../../lib/i18n";

const EVENT_ICONS: Record<EventType, { icon: LucideIcon; color: string }> = {
  open: { icon: MailOpen, color: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300" },
  click: { icon: MousePointerClick, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" },
  unsubscribe: { icon: Ban, color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  bounce: { icon: TriangleAlert, color: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300" },
  order: { icon: ShoppingBag, color: "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" },
  cart_abandoned: { icon: ShoppingCart, color: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" },
  tag_added: { icon: Tag, color: "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" },
  contact_created: { icon: UserPlus, color: "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" },
  event: { icon: CalendarClock, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300" },
};

function eventDetail(e: ContactEvent): string | null {
  const d = e.data ?? {};
  if (e.type === "tag_added" && typeof d.tag === "string") return `#${d.tag}`;
  if (e.type === "event" && typeof d.event === "string") {
    const when = typeof d.date === "string" && !Number.isNaN(Date.parse(d.date)) ? ` · ${new Date(d.date).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" })}` : "";
    return `${d.event}${d.status === "cancelled" ? t(" (annulé)", " (cancelled)") : ""}${when}`;
  }
  if (e.type === "click" && typeof d.url === "string") return d.url;
  if (e.type === "order") {
    const total = typeof d.total === "number" ? d.total : typeof d.total_price === "string" ? Number(d.total_price) : null;
    return total != null && !Number.isNaN(total) ? formatCurrency(total, true) : null;
  }
  if ((e.type === "open" || e.type === "click") && typeof d.subject === "string") return d.subject;
  return null;
}

export function ContactDrawer({ contactId, onClose, onChanged }: { contactId: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const detail = useAsync<ContactDetail | null>(() => (contactId ? api.contacts.get(contactId) : Promise.resolve(null)), [contactId]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = detail.data && detail.data.id === contactId ? detail.data : null;
  const tagSuggestions = useAsync(() => (contactId ? api.tags() : Promise.resolve([])), [contactId]);

  async function updateTags(next: string[]) {
    if (!c) return;
    const add = next.filter((tag) => !c.tags.includes(tag));
    const remove = c.tags.filter((tag) => !next.includes(tag));
    detail.setData({ ...c, tags: next });
    try {
      await api.contacts.tags(c.id, { add, remove });
      onChanged();
      if (add.length) void detail.reload(); // refresh timeline (tag_added events)
    } catch (err) {
      toast.error(err);
      void detail.reload();
    }
  }

  async function updateStatus(status: ContactStatus) {
    if (!c) return;
    try {
      await api.contacts.update(c.id, { status });
      detail.setData({ ...c, status });
      onChanged();
      toast.success(t("Statut mis à jour", "Status updated"));
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!c) return;
    setDeleting(true);
    try {
      await api.contacts.remove(c.id);
      toast.success(t("Contact supprimé", "Contact deleted"));
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Drawer open={!!contactId} onClose={onClose} title={t("Fiche contact", "Contact details")}>
      {detail.error ? (
        <div className="p-5">
          <ErrorState message={detail.error} onRetry={detail.reload} />
        </div>
      ) : !c ? (
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-6 p-5">
          <div className="flex items-start gap-4">
            <Avatar text={initials(c)} className="size-12 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-slate-900 dark:text-white">{fullName(c)}</p>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{c.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={CONTACT_STATUS[c.status]?.tone} dot>
                  {CONTACT_STATUS[c.status]?.label}
                </Badge>
                <Badge tone="slate">{CONTACT_SOURCE[c.source] ?? c.source}</Badge>
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: t("Total dépensé", "Total spent"), value: formatCurrency(c.total_spent, true) },
              { label: t("Commandes", "Orders"), value: String(c.orders_count ?? 0) },
              { label: t("Dernière commande", "Last order"), value: formatDate(c.last_order_at) },
              { label: t("Inscrit le", "Joined"), value: formatDate(c.created_at) },
              { label: t("Téléphone", "Phone"), value: c.phone || "—" },
              { label: t("Langue", "Language"), value: c.language
                  ? `${languageName(c.language)}${
                      c.language_source === "guess"
                        ? t(" (estimée d'après le pays, le téléphone ou l'email)", " (estimated from country, phone or email)")
                        : c.language_source === "browser"
                          ? t(" (langue de son navigateur)", " (their browser's language)")
                          : ""
                    }`
                  : t("Inconnue", "Unknown") },
              { label: t("ID externe", "External ID"), value: c.external_id || "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                <dt className="text-xs text-slate-500 dark:text-slate-400">{s.label}</dt>
                <dd className="mt-0.5 truncate text-sm font-medium text-slate-900 tabular-nums dark:text-white">{s.value}</dd>
              </div>
            ))}
          </dl>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">Tags</h4>
            <TagInput id="drawer-tags" value={c.tags} onChange={updateTags} suggestions={(tagSuggestions.data ?? []).map((s) => s.tag)} />
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{t("Statut d'abonnement", "Subscription status")}</h4>
            <Select value={c.status} onChange={(e) => void updateStatus(e.target.value as ContactStatus)}>
              {(Object.keys(CONTACT_STATUS) as ContactStatus[]).map((s) => (
                <option key={s} value={s}>
                  {CONTACT_STATUS[s].label}
                </option>
              ))}
            </Select>
          </section>

          {Object.keys(c.attributes ?? {}).length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{t("Attributs", "Attributes")}</h4>
              <dl className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
                {Object.entries(c.attributes).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
                    <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd className="truncate text-right text-slate-900 dark:text-white">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h4 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{t("Activité", "Activity")}</h4>
            {c.events.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("Aucune activité enregistrée.", "No activity recorded yet.")}</p>
            ) : (
              <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-slate-200 dark:before:bg-slate-800">
                {c.events.map((e) => {
                  const meta = EVENT_ICONS[e.type] ?? EVENT_ICONS.contact_created;
                  const detailText = eventDetail(e);
                  return (
                    <li key={e.id} className="relative flex gap-3">
                      <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-900 ${meta.color}`}>
                        <meta.icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{EVENT_LABELS[e.type] ?? e.type}</p>
                        {detailText && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{detailText}</p>}
                        <p className="mt-0.5 text-xs text-slate-400" title={formatDateTime(e.created_at)}>
                          {formatRelative(e.created_at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {(c.site?.total ?? 0) > 0 && c.site && (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <Activity className="size-3.5" />
                {t(`Sur le site · ${c.site.total} page${c.site.total > 1 ? "s" : ""}`, `On the site · ${c.site.total} page${c.site.total > 1 ? "s" : ""}`)}
              </h4>
              <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
                {c.site.visits.slice(0, 12).map((v, i) => (
                  <li key={`${v.created_at}-${i}`} className="flex items-center gap-3 px-3 py-2">
                    {v.product?.image ? (
                      <img src={v.product.image} alt="" className="size-9 shrink-0 rounded-lg object-cover" loading="lazy" />
                    ) : v.product ? (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-900/30"><Eye className="size-4" /></span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <a href={v.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm text-slate-900 hover:text-brand-600 dark:text-white">
                        {v.product?.name ?? v.title ?? v.path}
                      </a>
                      <p className="truncate text-xs text-slate-400">
                        {v.product?.price !== undefined ? `${v.product.price}${v.product.currency ? ` ${v.product.currency}` : ""} · ` : ""}
                        <span title={formatDateTime(v.created_at)}>{formatRelative(v.created_at)}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {c.messages.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{t("Emails reçus", "Emails received")}</h4>
              <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800">
                {c.messages.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-900 dark:text-white">{m.subject}</p>
                      <p className="text-xs text-slate-400">{formatDateTime(m.sent_at ?? m.created_at)}</p>
                    </div>
                    {m.clicked_at ? (
                      <Badge tone="green">{t("Cliqué", "Clicked")}</Badge>
                    ) : m.opened_at ? (
                      <Badge tone="blue">{t("Ouvert", "Opened")}</Badge>
                    ) : m.status === "failed" || m.status === "bounced" ? (
                      <Badge tone="red">{t("Échec", "Failed")}</Badge>
                    ) : (
                      <Badge tone="slate">{t("Envoyé", "Sent")}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
            <Button variant="ghost" icon={Trash2} className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40" onClick={() => setConfirmDelete(true)}>
              {t("Supprimer ce contact", "Delete this contact")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={deleting}
        danger
        title={t("Supprimer ce contact ?", "Delete this contact?")}
        description={t("Le contact et son historique seront définitivement supprimés.", "This contact and their history will be permanently deleted.")}
        confirmLabel={t("Supprimer", "Delete")}
      />
    </Drawer>
  );
}

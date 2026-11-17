import { useEffect, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useAsync } from "../lib/useAsync";
import { cx, formatRelative } from "../lib/format";
import type { Tone } from "../lib/constants";
import type { MessageStatus } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../components/ui/primitives";
import { EmailPreview } from "../components/EmailPreview";

const MESSAGE_STATUS: Record<MessageStatus, { label: string; tone: Tone }> = {
  queued: { label: t("En file", "Queued"), tone: "amber" },
  sent: { label: t("Envoyé", "Sent"), tone: "green" },
  failed: { label: t("Échec", "Failed"), tone: "red" },
  bounced: { label: t("Rejeté", "Bounced"), tone: "red" },
};

/** Remove the open-tracking pixel so previewing here doesn't count as an open. */
function withoutOpenPixel(html: string): string {
  return html.replace(/<img\b[^>]*\/t\/o\/[^>]*>/gi, "");
}

export function OutboxPage() {
  const outbox = useAsync(() => api.outbox(50), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const messages = outbox.data ?? [];
  const selected = messages.find((m) => m.id === selectedId) ?? messages[0];

  useEffect(() => {
    if (!selectedId && messages[0]) setSelectedId(messages[0].id);
  }, [messages, selectedId]);

  return (
    <>
      <PageHeader
        title={t("Boîte d'envoi (dev)", "Outbox (dev)")}
        description={t(
          "Les derniers emails « envoyés » par le fournisseur log. Idéal pour tester sans envoyer de vrais emails.",
          "The latest emails “sent” by the log provider. Perfect for testing without sending real emails.",
        )}
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={outbox.reload} loading={outbox.loading && !!outbox.data}>
            {t("Actualiser", "Refresh")}
          </Button>
        }
      />

      {outbox.error ? (
        <ErrorState message={outbox.error} onRetry={outbox.reload} />
      ) : outbox.loading && !outbox.data ? (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      ) : messages.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={t("Boîte d'envoi vide", "Outbox is empty")}
            description={t("Envoyez un email de test depuis une campagne pour le voir apparaître ici.", "Send a test email from a campaign to see it here.")}
           />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto xl:max-h-[calc(100vh-14rem)]">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={cx(
                      "w-full px-4 py-3 text-left transition",
                      selected?.id === m.id ? "bg-brand-50 dark:bg-brand-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{m.to_email}</p>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelative(m.sent_at ?? m.created_at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">{m.subject}</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Badge tone={MESSAGE_STATUS[m.status]?.tone ?? "slate"}>{MESSAGE_STATUS[m.status]?.label ?? m.status}</Badge>
                      {m.campaign_id && <Badge tone="brand">{t("Campagne", "Campaign")}</Badge>}
                      {m.automation_id && <Badge tone="blue">{t("Automatisation", "Automation")}</Badge>}
                      {!m.campaign_id && !m.automation_id && <Badge tone="slate">Test</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected && (
            <Card className="min-w-0">
              <div className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {t("À : ", "To: ")}<span className="font-medium text-slate-700 dark:text-slate-200">{selected.to_email}</span>
                {selected.error && <span className="ml-2 text-red-600 dark:text-red-400">· {selected.error}</span>}
              </div>
              <EmailPreview html={withoutOpenPixel(selected.html ?? "")} subject={selected.subject} height={620} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}

import { useState, type FormEvent } from "react";
import { KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import type { ApiKey } from "../lib/types";
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Skeleton, PageHeader } from "../components/ui/primitives";
import { ConfirmModal, Modal } from "../components/ui/Overlay";
import { useToast } from "../components/ui/Toast";
import { CopyButton } from "../components/CopyButton";
import { SendingDomainCard } from "../components/SendingDomainCard";
import { t } from "../lib/i18n";

function maskKey(k: ApiKey): string {
  if (k.key_preview) return k.key_preview;
  if (!k.key) return "msv_••••••••••••";
  if (k.key.includes("•") || k.key.includes("*") || k.key.length < 16) return k.key;
  return `${k.key.slice(0, 8)}••••••••${k.key.slice(-4)}`;
}

export function SettingsPage() {
  const toast = useToast();
  const { account, usage, canManage } = useAuth();
  const keys = useAsync(() => (canManage ? api.apiKeys.list() : Promise.resolve([] as ApiKey[])), [canManage]);

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const k = await api.apiKeys.create(label.trim() || t("Clé API", "API key"));
      setNewKey(k);
      setCreateOpen(false);
      setLabel("");
      await keys.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    if (!toRevoke) return;
    setRevoking(true);
    try {
      await api.apiKeys.revoke(toRevoke.id);
      keys.setData((prev) => (prev ?? []).filter((k) => k.id !== toRevoke.id));
      toast.success(t("Clé révoquée", "Key revoked"));
      setToRevoke(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <PageHeader title={t("Paramètres", "Settings")} description={t("Votre compte, votre adresse d'envoi pro et vos clés API. Votre profil et l'équipe sont dans « Profil & équipe ».", "Your account, work sending address and API keys. Your profile and team live under “Profile & team”.")} />

      <div className="space-y-6">
        <Card>
          <CardHeader title={t("Compte", "Account")} />
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: t("Nom", "Name"), value: account?.name },
              { label: t("Email", "Email"), value: account?.email },
              { label: t("Client depuis", "Customer since"), value: account ? formatDate(account.created_at) : undefined },
              { label: t("Emails envoyés ce mois", "Emails sent this month"), value: usage ? formatNumber(usage.emails_sent_month) : undefined },
            ].map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{row.label}</dt>
                <dd className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white">{row.value ?? <Skeleton className="h-5 w-32" />}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <SendingDomainCard canManage={canManage} />

        {!canManage ? (
          <Card>
            <CardHeader title={t("Clés API", "API keys")} description={t("Réservées au propriétaire et aux administrateurs du compte.", "Only the account owner and admins can manage these.")} />
          </Card>
        ) : (
        <Card>
          <CardHeader
            title={t("Clés API", "API keys")}
            description={t("Utilisez-les pour l'API publique et vos intégrations. Traitez-les comme des mots de passe.", "Use them for the public API and your integrations. Treat them like passwords.")}
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
                {t("Créer une clé", "Create key")}
              </Button>
            }
          />
          {keys.error ? (
            <div className="p-5">
              <ErrorState message={keys.error} onRetry={keys.reload} />
            </div>
          ) : keys.loading && !keys.data ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (keys.data ?? []).length === 0 ? (
            <EmptyState icon={KeyRound} title={t("Aucune clé API", "No API keys")} description={t("Créez une clé pour connecter vos outils.", "Create a key to connect your tools.")} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {keys.data!.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <KeyRound className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{k.label || t("Sans nom", "Untitled")}</p>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{maskKey(k)}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                    <p>{t(`Créée le ${formatDate(k.created_at)}`, `Created ${formatDate(k.created_at)}`)}</p>
                    <p>{k.last_used_at ? t(`Utilisée ${formatRelative(k.last_used_at)}`, `Used ${formatRelative(k.last_used_at)}`) : t("Jamais utilisée", "Never used")}</p>
                  </div>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToRevoke(k)} aria-label={t("Révoquer", "Revoke")} title={t("Révoquer", "Revoke")} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="sm"
        title={t("Nouvelle clé API", "New API key")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" form="create-key-form" loading={creating}>
              {t("Créer", "Create")}
            </Button>
          </>
        }
      >
        <form id="create-key-form" onSubmit={createKey}>
          <Field label={t("Nom de la clé", "Key name")} htmlFor="key-label" hint={t("Pour vous souvenir de son usage, ex : « Back-office boutique ».", "So you remember what it's for, e.g. “Store back office”.")}>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Back-office boutique", "Store back office")} autoFocus />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        title={t("Votre nouvelle clé API", "Your new API key")}
        footer={<Button onClick={() => setNewKey(null)}>{t("J'ai copié ma clé", "I've copied my key")}</Button>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {t("Copiez-la maintenant : elle ne sera plus affichée en entier.", "Copy it now: it won't be shown in full again.")}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-2 pl-3 dark:bg-slate-800">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900 dark:text-white">{newKey?.key}</code>
            {newKey?.key && <CopyButton text={newKey.key} />}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!toRevoke}
        onClose={() => setToRevoke(null)}
        onConfirm={revoke}
        loading={revoking}
        danger
        title={t("Révoquer cette clé ?", "Revoke this key?")}
        description={t(`Les applications utilisant « ${toRevoke?.label ?? ""} » perdront immédiatement l'accès.`, `Apps using “${toRevoke?.label ?? ""}” will lose access immediately.`)}
        confirmLabel={t("Révoquer", "Revoke")}
      />
    </>
  );
}

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
      const k = await api.apiKeys.create(label.trim() || "Clé API");
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
      toast.success("Clé révoquée");
      setToRevoke(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <PageHeader title="Paramètres" description="Votre compte et vos clés API. Votre profil et l'équipe sont dans « Profil & équipe »." />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Compte" />
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Nom", value: account?.name },
              { label: "Email", value: account?.email },
              { label: "Client depuis", value: account ? formatDate(account.created_at) : undefined },
              { label: "Emails envoyés ce mois", value: usage ? formatNumber(usage.emails_sent_month) : undefined },
            ].map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{row.label}</dt>
                <dd className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white">{row.value ?? <Skeleton className="h-5 w-32" />}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {!canManage ? (
          <Card>
            <CardHeader title="Clés API" description="Réservées au propriétaire et aux administrateurs du compte." />
          </Card>
        ) : (
        <Card>
          <CardHeader
            title="Clés API"
            description="Utilisez-les pour l'API publique et vos intégrations. Traitez-les comme des mots de passe."
            action={
              <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
                Créer une clé
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
            <EmptyState icon={KeyRound} title="Aucune clé API" description="Créez une clé pour connecter vos outils." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {keys.data!.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <KeyRound className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{k.label || "Sans nom"}</p>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{maskKey(k)}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                    <p>Créée le {formatDate(k.created_at)}</p>
                    <p>{k.last_used_at ? `Utilisée ${formatRelative(k.last_used_at)}` : "Jamais utilisée"}</p>
                  </div>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToRevoke(k)} aria-label="Révoquer" title="Révoquer" />
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
        title="Nouvelle clé API"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" form="create-key-form" loading={creating}>
              Créer
            </Button>
          </>
        }
      >
        <form id="create-key-form" onSubmit={createKey}>
          <Field label="Nom de la clé" htmlFor="key-label" hint="Pour vous souvenir de son usage, ex : « Back-office boutique ».">
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Back-office boutique" autoFocus />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!newKey}
        onClose={() => setNewKey(null)}
        title="Votre nouvelle clé API"
        footer={<Button onClick={() => setNewKey(null)}>J'ai copié ma clé</Button>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            Copiez-la maintenant : elle ne sera plus affichée en entier.
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
        title="Révoquer cette clé ?"
        description={`Les applications utilisant « ${toRevoke?.label ?? ""} » perdront immédiatement l'accès.`}
        confirmLabel="Révoquer"
      />
    </>
  );
}

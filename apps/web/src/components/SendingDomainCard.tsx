import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Globe, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatRelative } from "../lib/format";
import type { DnsRecord, SendingDomain, SendingDomainResponse } from "../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, Skeleton } from "./ui/primitives";
import { ConfirmModal } from "./ui/Overlay";
import { useToast } from "./ui/Toast";
import { CopyButton } from "./CopyButton";
import { t } from "../lib/i18n";

const errorText = (e: SendingDomain["last_error"]) =>
  e === "dkim_missing"
    ? t("L'enregistrement DKIM est introuvable pour l'instant. Les changements DNS prennent de quelques minutes à quelques heures : réessayez un peu plus tard.", "The DKIM record can't be found yet. DNS changes take from a few minutes to a few hours: try again a little later.")
    : e === "dkim_mismatch"
      ? t("Un enregistrement DKIM existe, mais sa valeur ne correspond pas. Copiez-la à nouveau en entier, sans guillemets ni espaces.", "A DKIM record exists but its value doesn't match. Copy it again in full, with no quotes or spaces.")
      : e === "dns_error"
        ? t("Le DNS de ce domaine n'a pas répondu. Réessayez dans un instant.", "This domain's DNS didn't answer. Try again in a moment.")
        : null;

function RecordRow({ record, domain }: { record: DnsRecord; domain: string }) {
  const relative = record.host.endsWith(`.${domain}`) ? record.host.slice(0, -domain.length - 1) : record.host;
  return (
    <li className="space-y-2 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="slate">{record.type}</Badge>
        <span className="text-sm font-medium text-slate-900 dark:text-white">
          {record.required ? t("Signature DKIM", "DKIM signature") : t("Politique DMARC", "DMARC policy")}
        </span>
        {record.ok ? (
          <Badge tone="green" dot>{t("Trouvé", "Found")}</Badge>
        ) : record.required ? (
          <Badge tone="amber" dot>{t("À ajouter", "To add")}</Badge>
        ) : (
          <Badge tone="slate">{t("Recommandé", "Recommended")}</Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div>
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{t("Nom / sous-domaine", "Name / host")}</p>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 py-1 pr-1 pl-3 dark:bg-slate-800">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white" title={record.host}>{relative}</code>
            <CopyButton text={relative} />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{t("Valeur", "Value")}</p>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 py-1 pr-1 pl-3 dark:bg-slate-800">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white" title={record.value}>{record.value}</code>
            <CopyButton text={record.value} />
          </div>
        </div>
      </div>
      {!record.required && !record.ok && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("Gmail et Yahoo l'exigent pour les envois en nombre. Ajoutez-le seulement si votre domaine n'a pas déjà un enregistrement DMARC.", "Gmail and Yahoo require it for bulk sending. Only add it if your domain doesn't already have a DMARC record.")}
        </p>
      )}
    </li>
  );
}

/** Settings → send from the shop's own address (hello@shop.com), signed with its own DKIM key. */
export function SendingDomainCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const state = useAsync(() => api.sendingDomain.get(), []);
  const [domainInput, setDomainInput] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [busy, setBusy] = useState<"add" | "verify" | "from" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const data = state.data;
  const domain = data?.domain ?? null;

  useEffect(() => {
    if (domain?.status !== "verified") return;
    const current = domain.from_email;
    setLocalPart(current && current.endsWith(`@${domain.domain}`) ? current.slice(0, -domain.domain.length - 1) : "bonjour");
  }, [domain?.status, domain?.domain, domain?.from_email]);

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<SendingDomainResponse | void>, success?: (r: SendingDomainResponse | void) => string | null) {
    setBusy(kind);
    try {
      const r = await fn();
      if (r) state.setData((prev) => ({ ...(prev ?? {}), ...r }) as SendingDomainResponse);
      else await state.reload();
      const msg = success?.(r);
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    void act("add", () => api.sendingDomain.create(domainInput), () => {
      setDomainInput("");
      return null;
    });
  };
  const verify = () =>
    act("verify", () => api.sendingDomain.verify(), (r) =>
      r && r.domain?.status === "verified" ? t("Domaine vérifié", "Domain verified") : null,
    );
  const saveFrom = (e: FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    void act("from", () => api.sendingDomain.setFrom(`${localPart.trim()}@${domain.domain}`), () => t("Adresse d'expéditeur enregistrée", "Sender address saved"));
  };

  const description = t(
    "Envoyez vos emails depuis l'adresse de votre boutique (ex. bonjour@ma-boutique.fr) plutôt que depuis Pingsell. Meilleure image, meilleure délivrabilité.",
    "Send your emails from your shop's address (e.g. hello@my-shop.com) instead of Pingsell's. Better branding, better deliverability.",
  );

  return (
    <Card>
      <CardHeader
        title={t("Domaine d'envoi", "Sending domain")}
        description={description}
        action={
          domain && (
            <Badge tone={domain.status === "verified" ? "green" : "amber"} dot>
              {domain.status === "verified" ? t("Vérifié", "Verified") : t("En attente du DNS", "Waiting for DNS")}
            </Badge>
          )
        }
      />

      {state.error ? (
        <div className="p-6">
          <ErrorState message={state.error} onRetry={state.reload} />
        </div>
      ) : !data ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !domain ? (
        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Pour l'instant, vos emails partent de ", "Right now your emails are sent from ")}
            <strong className="font-medium text-slate-900 dark:text-white">{data.from_email}</strong>
            {t(", avec le nom de votre boutique. Les réponses de vos clients vous arrivent quand même.", ", with your shop's name. Your customers' replies still reach you.")}
          </p>
          {canManage ? (
            <form onSubmit={add} className="flex flex-wrap items-end gap-3">
              <Field label={t("Votre nom de domaine", "Your domain name")} htmlFor="sending-domain" className="min-w-0 flex-1" hint={t("Celui de votre site ou de votre adresse email pro.", "Your website's, or your work email's.")}>
                <Input id="sending-domain" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="ma-boutique.fr" autoComplete="off" spellCheck={false} />
              </Field>
              <Button type="submit" icon={Globe} loading={busy === "add"} disabled={!domainInput.trim()}>
                {t("Ajouter", "Add")}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("Le propriétaire ou un administrateur du compte peut l'ajouter.", "The account owner or an admin can add one.")}</p>
          )}
        </div>
      ) : (
        <>
          {domain.status === "pending" && (
            <div className="space-y-2 border-b border-slate-900/10 px-6 py-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
              <p>
                {t("Ajoutez l'entrée ci-dessous dans la zone DNS de ", "Add the record below to the DNS zone of ")}
                <strong className="font-medium text-slate-900 dark:text-white">{domain.domain}</strong>
                {t(", chez l'hébergeur de votre nom de domaine (OVH, GoDaddy, Gandi, IONOS, Cloudflare…), puis cliquez sur « Vérifier ».", ", at your domain provider (GoDaddy, Namecheap, Cloudflare, OVH…), then click “Verify”.")}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(`Le nom est à saisir tel quel : l'hébergeur ajoute « .${domain.domain} » tout seul. Si votre hébergeur demande le nom complet, utilisez `, `Enter the name as is: your provider adds “.${domain.domain}” itself. If it asks for the full name, use `)}
                <code className="font-mono">{domain.records[0]?.host}</code>.
              </p>
              {errorText(domain.last_error) && domain.last_checked_at && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{errorText(domain.last_error)}</p>
              )}
            </div>
          )}

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {domain.records.map((r) => (
              <RecordRow key={r.host} record={r} domain={domain.domain} />
            ))}
          </ul>

          {domain.status === "verified" && (
            <form onSubmit={saveFrom} className="flex flex-wrap items-end gap-3 border-t border-slate-900/10 px-6 py-5 dark:border-white/10">
              <Field
                label={t("Adresse d'expéditeur par défaut", "Default sender address")}
                htmlFor="from-local"
                className="min-w-0 flex-1"
                hint={t(`Utilisée pour vos nouvelles campagnes et automatisations. Actuellement : ${data.from_email}`, `Used for new campaigns and automations. Currently: ${data.from_email}`)}
              >
                <div className="flex items-center gap-2">
                  <Input id="from-local" value={localPart} onChange={(e) => setLocalPart(e.target.value.replace(/[\s@]/g, ""))} disabled={!canManage} className="max-w-48" />
                  <span className="truncate text-sm text-slate-600 dark:text-slate-300">@{domain.domain}</span>
                </div>
              </Field>
              {canManage && (
                <Button type="submit" variant="secondary" loading={busy === "from"} disabled={!localPart.trim()}>
                  {t("Enregistrer", "Save")}
                </Button>
              )}
            </form>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-900/10 px-6 py-4 dark:border-white/10">
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              {domain.status === "verified" && <CheckCircle2 className="size-3.5 text-emerald-600" />}
              {domain.last_checked_at ? t(`Dernière vérification ${formatRelative(domain.last_checked_at)}`, `Last checked ${formatRelative(domain.last_checked_at)}`) : t("Pas encore vérifié", "Not checked yet")}
            </p>
            {canManage && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  {t("Retirer", "Remove")}
                </Button>
                <Button size="sm" variant={domain.status === "verified" ? "secondary" : "primary"} icon={RefreshCw} loading={busy === "verify"} onClick={verify}>
                  {domain.status === "verified" ? t("Revérifier", "Check again") : t("Vérifier", "Verify")}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => act("delete", () => api.sendingDomain.remove(), () => { setConfirmDelete(false); return t("Domaine retiré", "Domain removed"); })}
        loading={busy === "delete"}
        danger
        title={t("Retirer ce domaine ?", "Remove this domain?")}
        description={t(`Vos emails repartiront de ${data?.default_from_email ?? "l'adresse Pingsell"}. Pour le réutiliser, il faudra publier une nouvelle clé DKIM.`, `Your emails will go out from ${data?.default_from_email ?? "Pingsell's address"} again. To use it again you'll need to publish a new DKIM key.`)}
        confirmLabel={t("Retirer", "Remove")}
      />
    </Card>
  );
}

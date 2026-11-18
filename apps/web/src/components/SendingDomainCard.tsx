import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronDown, ExternalLink, Globe, Mail, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { cx, formatRelative } from "../lib/format";
import type { DnsRecord, SendingDomain, SendingDomainResponse } from "../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, Skeleton } from "./ui/primitives";
import { ConfirmModal } from "./ui/Overlay";
import { useToast } from "./ui/Toast";
import { CopyButton, copyText } from "./CopyButton";
import { DNS_GUIDES, guideFor } from "./dnsGuides";
import { t } from "../lib/i18n";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const shortHost = (record: DnsRecord, domain: string) => (record.host.endsWith(`.${domain}`) ? record.host.slice(0, -domain.length - 1) : record.host);

const errorText = (e: SendingDomain["last_error"]) =>
  e === "dkim_missing"
    ? t("La ligne n'est pas encore visible sur Internet. C'est normal juste après l'avoir ajoutée : les changements DNS prennent de quelques minutes à quelques heures. Réessayez un peu plus tard.", "The record isn't visible on the internet yet. That's normal right after adding it: DNS changes take from a few minutes to a few hours. Try again a little later.")
    : e === "dkim_mismatch"
      ? t("Une ligne existe, mais sa valeur ne correspond pas. Supprimez-la chez votre hébergeur, puis recopiez la valeur avec le bouton « Copier », sans guillemets ni espaces en trop.", "A record exists but its value doesn't match. Delete it at your provider, then copy the value again with the “Copy” button, with no extra quotes or spaces.")
      : e === "dns_error"
        ? t("Le DNS de ce domaine n'a pas répondu. Réessayez dans un instant.", "This domain's DNS didn't answer. Try again in a moment.")
        : null;

/** Plain-text instructions for whoever manages the merchant's domain. */
function instructions(domain: SendingDomain): string {
  const [dkim, dmarc] = domain.records;
  const lines = [
    t("Bonjour,", "Hello,"),
    "",
    t(
      `Pour que nos emails partent de notre adresse @${domain.domain}, pourrais-tu ajouter ${dmarc && !dmarc.ok ? "ces deux lignes" : "cette ligne"} dans la zone DNS de ${domain.domain} ?`,
      `So our emails can go out from our @${domain.domain} address, could you add ${dmarc && !dmarc.ok ? "these two records" : "this record"} to the DNS zone of ${domain.domain}?`,
    ),
    "",
    t("1) Signature DKIM (obligatoire)", "1) DKIM signature (required)"),
    "   Type : TXT",
    `   ${t("Nom", "Name")} : ${shortHost(dkim, domain.domain)}   (${dkim.host})`,
    `   ${t("Valeur", "Value")} : ${dkim.value}`,
  ];
  if (dmarc && !dmarc.ok) {
    lines.push(
      "",
      t("2) Politique DMARC (seulement s'il n'existe pas déjà une ligne _dmarc)", "2) DMARC policy (only if there is no _dmarc record yet)"),
      "   Type : TXT",
      `   ${t("Nom", "Name")} : ${shortHost(dmarc, domain.domain)}   (${dmarc.host})`,
      `   ${t("Valeur", "Value")} : ${dmarc.value}`,
    );
  }
  lines.push("", t("Aucune autre ligne n'est à modifier (MX, SPF…). Merci !", "No other record needs to change (MX, SPF…). Thanks!"));
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Steps({ current }: { current: number }) {
  const labels = [t("Votre domaine", "Your domain"), t("Une ligne chez votre hébergeur", "One record at your provider"), t("Vérification", "Verification"), t("Votre adresse", "Your address")];
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cx(
              "flex size-6 items-center justify-center rounded-full",
              i + 1 < current ? "bg-emerald-500 text-white" : i + 1 === current ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-200 text-slate-500 dark:bg-slate-800",
            )}
          >
            {i + 1 < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={i + 1 === current ? "text-slate-900 dark:text-white" : "text-slate-400"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 py-1 pr-1 pl-3 dark:bg-slate-800">
        <code className={cx("min-w-0 flex-1 truncate text-xs text-slate-900 dark:text-white", mono && "font-mono")} title={value}>
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-slate-100 last:border-0 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-slate-900 dark:text-white">
        {q}
        <ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="pb-3 text-sm text-slate-600 dark:text-slate-300">{children}</div>
    </details>
  );
}

/** Before / after, so the merchant sees what changes for their customers. */
function Explainer({ brand, fallback, domain }: { brand: string; fallback: string; domain?: string }) {
  const own = `bonjour@${domain ?? t("votre-boutique.fr", "your-shop.com")}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-900/5 dark:bg-slate-800/40">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("Sans votre domaine", "Without your domain")}</p>
          <p className="mt-2 truncate text-sm text-slate-900 dark:text-white">
            <strong>{brand}</strong> <span className="text-slate-500">&lt;{fallback}&gt;</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{t("Ça marche, mais l'adresse est celle de Pingsell.", "It works, but the address is Pingsell's.")}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-600/15 dark:bg-emerald-900/20">
          <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">{t("Avec votre domaine", "With your domain")}</p>
          <p className="mt-2 truncate text-sm text-slate-900 dark:text-white">
            <strong>{brand}</strong> <span className="text-slate-500">&lt;{own}&gt;</span>
          </p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{t("Vos emails viennent vraiment de vous.", "Your emails truly come from you.")}</p>
        </div>
      </div>
      <ul className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 dark:text-slate-300">
        <li className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-brand-500" />{t("Plus professionnel : vos clients reconnaissent votre adresse.", "More professional: customers recognise your address.")}</li>
        <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-brand-500" />{t("Moins de spam : Gmail et Outlook font davantage confiance à un email signé par votre domaine.", "Less spam: Gmail and Outlook trust email signed by your own domain more.")}</li>
        <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" />{t("Plus sûr : personne ne peut envoyer de faux emails en votre nom sans être repéré.", "Safer: nobody can send fake emails in your name without being caught.")}</li>
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

/** Settings → send from the shop's own address (hello@shop.com), signed with its own DKIM key. */
export function SendingDomainCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { account } = useAuth();
  const brand = account?.name || t("Votre boutique", "Your shop");
  const state = useAsync(() => api.sendingDomain.get(), []);
  const [domainInput, setDomainInput] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "verify" | "from" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const data = state.data;
  const domain = data?.domain ?? null;
  const fallback = data?.default_from_email ?? "bonjour@pingsell";

  useEffect(() => {
    if (domain?.status !== "verified") return;
    const current = domain.from_email;
    setLocalPart(current && current.endsWith(`@${domain.domain}`) ? current.slice(0, -domain.domain.length - 1) : "bonjour");
  }, [domain?.status, domain?.domain, domain?.from_email]);

  // Open the guide of the provider we detected from the domain's name servers.
  useEffect(() => {
    if (domain && !provider) setProvider(guideFor(domain.dns_provider)?.id ?? null);
  }, [domain, provider]);

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
    setProvider(null);
    void act("add", () => api.sendingDomain.create(domainInput), () => {
      setDomainInput("");
      return null;
    });
  };
  const verify = () =>
    act("verify", () => api.sendingDomain.verify(), (r) => (r && r.domain?.status === "verified" ? t("C'est vérifié : vos emails peuvent partir de votre domaine", "Verified: your emails can now go out from your domain") : null));
  const saveFrom = (e: FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    void act("from", () => api.sendingDomain.setFrom(`${localPart.trim()}@${domain.domain}`), () => t("Adresse d'expéditeur enregistrée", "Sender address saved"));
  };

  const guide = guideFor(provider);
  const detected = domain ? guideFor(domain.dns_provider) : null;
  const [dkim, dmarc] = domain?.records ?? [];

  return (
    <Card>
      <CardHeader
        title={t("Domaine d'envoi", "Sending domain")}
        description={t("Envoyez vos emails depuis l'adresse de votre boutique plutôt que depuis celle de Pingsell. Facultatif · 5 minutes · une seule fois.", "Send your emails from your shop's address instead of Pingsell's. Optional · 5 minutes · one time only.")}
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
        /* ------------------------------ Step 1 ------------------------------ */
        <div className="space-y-6 p-6">
          <Explainer brand={brand} fallback={data.from_email} />
          <div className="space-y-4 border-t border-slate-900/10 pt-6 dark:border-white/10">
            <Steps current={1} />
            {canManage ? (
              <form onSubmit={add} className="flex flex-wrap items-end gap-3">
                <Field
                  label={t("Quel est le nom de domaine de votre boutique ?", "What is your shop's domain name?")}
                  htmlFor="sending-domain"
                  className="min-w-0 flex-1"
                  hint={t("C'est la fin de l'adresse de votre site ou de votre email pro : pour www.ma-boutique.fr, tapez ma-boutique.fr.", "It's the end of your website or work email address: for www.my-shop.com, type my-shop.com.")}
                >
                  <Input id="sending-domain" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="ma-boutique.fr" autoComplete="off" spellCheck={false} />
                </Field>
                <Button type="submit" icon={Globe} loading={busy === "add"} disabled={!domainInput.trim()}>
                  {t("Continuer", "Continue")}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("Le propriétaire ou un administrateur du compte peut s'en occuper.", "The account owner or an admin can set this up.")}</p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("Pas de domaine ? Aucun problème : vos emails continuent de partir de ", "No domain? No problem: your emails keep going out from ")}
              <strong className="font-medium">{data.from_email}</strong>
              {t(" avec le nom de votre boutique, et les réponses de vos clients vous arrivent quand même.", " with your shop's name, and your customers' replies still reach you.")}
            </p>
          </div>
        </div>
      ) : domain.status === "pending" ? (
        /* --------------------------- Steps 2 and 3 -------------------------- */
        <div className="space-y-6 p-6">
          <Steps current={2} />

          <section className="space-y-3">
            <h4 className="font-display text-base font-bold text-slate-900 dark:text-white">{t("Où ajouter la ligne ?", "Where do I add the record?")}</h4>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t(
                <>Chez l'entreprise qui gère votre nom de domaine <strong>{domain.domain}</strong>, celle à qui vous le payez chaque année. Choisissez-la pour voir le chemin exact :</>,
                <>At the company that manages your domain name <strong>{domain.domain}</strong>, the one you pay for it every year. Pick it to see the exact path:</>,
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {DNS_GUIDES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setProvider(g.id)}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                    provider === g.id ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900" : "bg-white text-slate-700 ring-slate-900/15 hover:ring-slate-900/40 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/15",
                  )}
                >
                  {g.name}
                  {detected?.id === g.id && <span className={cx("rounded-full px-1.5 text-[10px]", provider === g.id ? "bg-white/20" : "bg-emerald-100 text-emerald-700")}>{t("détecté", "detected")}</span>}
                </button>
              ))}
            </div>

            {guide ? (
              <div className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-900/5 dark:bg-slate-800/40">
                <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  {guide.steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 ring-1 ring-slate-900/10 dark:bg-slate-900 dark:text-slate-200">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                  <li className="flex gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 ring-1 ring-slate-900/10 dark:bg-slate-900 dark:text-slate-200">{guide.steps.length + 1}</span>
                    {t("Remplissez le formulaire comme ci-dessous, puis enregistrez.", "Fill in the form as below, then save.")}
                  </li>
                </ol>
                {guide.url && (
                  <a href={guide.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    {t(`Ouvrir ${guide.name}`, `Open ${guide.name}`)} <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Vous ne savez pas lequel ? Cherchez dans vos emails la facture de votre nom de domaine : elle indique le nom de l'entreprise.", "Not sure which one? Search your inbox for your domain name's invoice: it shows the company's name.")}</p>
            )}
          </section>

          {dkim && (
            <section className="space-y-3 rounded-xl p-4 ring-1 ring-slate-900/10 dark:ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber" dot>{t("Obligatoire", "Required")}</Badge>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{t("Ligne 1 : la signature de vos emails (DKIM)", "Record 1: your email signature (DKIM)")}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("Elle permet à Gmail, Outlook et aux autres de vérifier que vos emails viennent vraiment de vous. Elle ne touche pas à vos boîtes mail actuelles.", "It lets Gmail, Outlook and others check that your emails really come from you. It doesn't affect your current mailboxes.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,16rem)_minmax(0,1fr)]">
                <div>
                  <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{t("Type", "Type")}</p>
                  <p className="flex h-10 items-center rounded-lg bg-slate-100 px-3 font-mono text-xs font-semibold text-slate-900 dark:bg-slate-800 dark:text-white">TXT</p>
                </div>
                <CopyField label={guide?.nameField ?? t("Nom / sous-domaine", "Name / host")} value={shortHost(dkim, domain.domain)} />
                <CopyField label={guide?.valueField ?? t("Valeur", "Value")} value={dkim.value} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("Le champ TTL ou « durée » : laissez la valeur par défaut. Si votre hébergeur demande le nom complet, utilisez ", "TTL field: keep the default. If your provider asks for the full name, use ")}
                <code className="font-mono">{dkim.host}</code>.
              </p>
            </section>
          )}

          {dmarc && !dmarc.ok && (
            <section className="space-y-3 rounded-xl p-4 ring-1 ring-slate-900/10 dark:ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="slate">{t("Conseillée", "Recommended")}</Badge>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{t("Ligne 2 : votre règle anti-usurpation (DMARC)", "Record 2: your anti-spoofing rule (DMARC)")}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("Gmail et Yahoo l'exigent pour les envois en nombre. Elle indique quoi faire d'un faux email à votre nom ; « p=none » veut dire « surveiller seulement », sans aucun risque pour vos emails.", "Gmail and Yahoo require it for bulk sending. It says what to do with a fake email in your name; “p=none” means “monitor only”, with no risk to your emails.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,16rem)_minmax(0,1fr)]">
                <div>
                  <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{t("Type", "Type")}</p>
                  <p className="flex h-10 items-center rounded-lg bg-slate-100 px-3 font-mono text-xs font-semibold text-slate-900 dark:bg-slate-800 dark:text-white">TXT</p>
                </div>
                <CopyField label={guide?.nameField ?? t("Nom / sous-domaine", "Name / host")} value={shortHost(dmarc, domain.domain)} />
                <CopyField label={guide?.valueField ?? t("Valeur", "Value")} value={dmarc.value} />
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">{t("Si votre zone contient déjà une ligne « _dmarc », n'en ajoutez pas une deuxième : gardez l'existante.", "If your zone already has a “_dmarc” record, don't add a second one: keep the existing one.")}</p>
            </section>
          )}

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50/60 p-4 dark:bg-brand-900/20">
            <p className="text-sm text-slate-700 dark:text-slate-200">{t("Ce n'est pas vous qui gérez le site ? Envoyez ces instructions à la personne qui s'en occupe.", "Someone else manages your website? Send them these instructions.")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  if (await copyText(instructions(domain))) toast.success(t("Instructions copiées", "Instructions copied"));
                }}
              >
                {t("Copier les instructions", "Copy instructions")}
              </Button>
              <a
                href={`mailto:?subject=${encodeURIComponent(t(`Ajout d'une ligne DNS pour ${domain.domain}`, `DNS record to add for ${domain.domain}`))}&body=${encodeURIComponent(instructions(domain))}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-900 px-3.5 font-display text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                <Mail className="size-4" /> {t("Envoyer par email", "Send by email")}
              </a>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-900/10 pt-6 dark:border-white/10">
            <Steps current={3} />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Une fois la ligne enregistrée chez votre hébergeur, cliquez sur « Vérifier ». Si ce n'est pas encore visible, patientez quelques minutes : vous pouvez fermer cette page et revenir plus tard.", "Once the record is saved at your provider, click “Verify”. If it isn't visible yet, wait a few minutes: you can close this page and come back later.")}
            </p>
            {errorText(domain.last_error) && domain.last_checked_at && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{errorText(domain.last_error)}</p>
            )}
            {canManage && (
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={RefreshCw} loading={busy === "verify"} onClick={verify}>
                  {t("Vérifier", "Verify")}
                </Button>
                {domain.last_checked_at && <span className="text-xs text-slate-500">{t(`Dernière vérification ${formatRelative(domain.last_checked_at)}`, `Last checked ${formatRelative(domain.last_checked_at)}`)}</span>}
              </div>
            )}
          </section>

          <section className="rounded-xl px-4 ring-1 ring-slate-900/10 dark:ring-white/10">
            <Faq q={t("Est-ce que ça touche à mes emails actuels ?", "Does this affect my current emails?")}>
              {t("Non. Vous ajoutez une ligne, vous n'en modifiez aucune. Vos boîtes mail, votre site et vos autres outils continuent de fonctionner exactement pareil.", "No. You add a record and change nothing else. Your mailboxes, website and other tools keep working exactly the same.")}
            </Faq>
            <Faq q={t("Je ne sais pas qui gère mon nom de domaine", "I don't know who manages my domain")}>
              {t("C'est l'entreprise à qui vous payez votre domaine chaque année (OVH, GoDaddy, IONOS, Shopify…). Cherchez « facture nom de domaine » dans vos emails. Si une agence ou un freelance a créé votre site, utilisez « Envoyer par email » : il saura quoi faire.", "It's the company you pay for your domain every year (GoDaddy, Namecheap, Shopify…). Search your inbox for a domain name invoice. If an agency or freelancer built your site, use “Send by email”: they'll know what to do.")}
              {detected && t(` D'après nos vérifications, le vôtre semble géré par ${detected.name}.`, ` From our checks, yours seems to be managed by ${detected.name}.`)}
            </Faq>
            <Faq q={t("Combien de temps ça prend ?", "How long does it take?")}>
              {t("Quelques minutes pour ajouter la ligne. Elle devient ensuite visible sur Internet en quelques minutes, parfois jusqu'à quelques heures.", "A few minutes to add the record. It then becomes visible on the internet within minutes, sometimes up to a few hours.")}
            </Faq>
            <Faq q={t("Et si je ne le fais pas ?", "What if I skip it?")}>
              {t(`Vos emails partent quand même, depuis ${fallback} avec le nom de votre boutique, et les réponses vous arrivent. Votre propre domaine est simplement plus professionnel et aide à éviter les spams.`, `Your emails still go out, from ${fallback} with your shop's name, and replies still reach you. Your own domain is simply more professional and helps avoid spam folders.`)}
            </Faq>
          </section>

          {canManage && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                {t("Changer de domaine", "Change domain")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------ Verified ----------------------------- */
        <div className="space-y-6 p-6">
          <div className="flex gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">{t(`${domain.domain} est prêt.`, `${domain.domain} is ready.`)}</p>
              <p className="mt-0.5">
                {data.from_email.endsWith(`@${domain.domain}`) ? (
                  <>
                    {t(`Vos emails partent de `, `Your emails go out from `)}
                    <strong>{data.from_email}</strong>
                  </>
                ) : (
                  t("Dernière étape : choisissez ci-dessous votre adresse d'expéditeur. Vos emails partiront de cette adresse", "Last step: choose your sender address below. Your emails will go out from it")
                )}
                {t(`, signés au nom de ${domain.domain}. Vos clients voient votre adresse, et Gmail ou Outlook savent qu'ils viennent bien de vous.`, `, signed for ${domain.domain}. Your customers see your address, and Gmail or Outlook know it's really you.`)}
              </p>
            </div>
          </div>

          <form onSubmit={saveFrom} className="flex flex-wrap items-end gap-3">
            <Field
              label={t("Adresse d'expéditeur par défaut", "Default sender address")}
              htmlFor="from-local"
              className="min-w-0 flex-1"
              hint={t("Utilisée pour vos nouvelles campagnes et automatisations. Choisissez une adresse qui reçoit bien les réponses, plutôt qu'un « noreply » : c'est meilleur pour la délivrabilité.", "Used for new campaigns and automations. Pick an address that receives replies rather than a “noreply”: it's better for deliverability.")}
            >
              <div className="flex items-center gap-2">
                <Input id="from-local" value={localPart} onChange={(e) => setLocalPart(e.target.value.replace(/[\s@]/g, ""))} disabled={!canManage} className="max-w-48" />
                <span className="truncate text-sm text-slate-600 dark:text-slate-300">@{domain.domain}</span>
              </div>
            </Field>
            {canManage && (
              <Button type="submit" variant="secondary" loading={busy === "from"} disabled={!localPart.trim()} icon={ArrowRight}>
                {t("Enregistrer", "Save")}
              </Button>
            )}
          </form>

          <details className="group rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
              {t("Vos lignes DNS (à ne pas supprimer)", "Your DNS records (don't delete them)")}
              <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("Elles sont en place chez votre hébergeur. Si vous les supprimez, vos emails repartiront de l'adresse Pingsell.", "They're in place at your provider. If you delete them, your emails will go back to Pingsell's address.")}</p>
              {domain.records.map((r) => (
                <div key={r.host} className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                    {r.required ? t("Signature DKIM", "DKIM signature") : t("Règle DMARC", "DMARC rule")}
                    {r.ok ? <Badge tone="green" dot>{t("Trouvée", "Found")}</Badge> : <Badge tone="slate">{t("Conseillée", "Recommended")}</Badge>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                    <CopyField label={t("Nom", "Name")} value={shortHost(r, domain.domain)} />
                    <CopyField label={t("Valeur", "Value")} value={r.value} />
                  </div>
                </div>
              ))}
            </div>
          </details>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {domain.last_checked_at ? t(`Dernière vérification ${formatRelative(domain.last_checked_at)}`, `Last checked ${formatRelative(domain.last_checked_at)}`) : ""}
            </p>
            {canManage && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  {t("Retirer", "Remove")}
                </Button>
                <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "verify"} onClick={verify}>
                  {t("Revérifier", "Check again")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          act("delete", () => api.sendingDomain.remove(), () => {
            setConfirmDelete(false);
            setProvider(null);
            return t("Domaine retiré", "Domain removed");
          })
        }
        loading={busy === "delete"}
        danger
        title={t("Retirer ce domaine ?", "Remove this domain?")}
        description={t(
          `Vos emails repartiront de ${fallback}. Pour réutiliser ce domaine plus tard, il faudra publier une nouvelle ligne DKIM : vous pourrez supprimer l'ancienne chez votre hébergeur.`,
          `Your emails will go out from ${fallback} again. To use this domain later you'll need to publish a new DKIM record: you can delete the old one at your provider.`,
        )}
        confirmLabel={t("Retirer", "Remove")}
      />
    </Card>
  );
}

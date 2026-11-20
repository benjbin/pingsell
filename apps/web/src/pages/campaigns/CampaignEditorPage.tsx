import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, BarChart3, CalendarClock, Code2, Eye, FlaskConical, LayoutGrid, PenLine, Save, Send, Users, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/useAsync";
import { CAMPAIGN_STATUS } from "../../lib/constants";
import { formatDateTime, formatNumber, toDateTimeLocal } from "../../lib/format";
import type { Campaign, CampaignInput, SendingDomainResponse } from "../../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea } from "../../components/ui/primitives";
import { ConfirmModal, Modal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { AiGeneratePanel } from "../../components/AiGeneratePanel";
import { EmailPreview, renderMergeTags } from "../../components/EmailPreview";
import { EmailBuilder } from "../../components/email-builder/EmailBuilder";
import { ContactPicker } from "./ContactPicker";
import { t } from "../../lib/i18n";
import { PRESETS, applyBrandKit, parseBrandKit, parseDesign, renderEmail, serializeDesign, type Design, type Preset } from "../../components/email-builder/model";

interface FormState {
  name: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  html: string;
  design: string;
  segment_id: string;
  audience: "all" | "segment" | "contacts";
  contact_ids: string[];
}

function toForm(c: Campaign): FormState {
  return {
    name: c.name ?? "",
    subject: c.subject ?? "",
    preheader: c.preheader ?? "",
    from_name: c.from_name ?? "",
    from_email: c.from_email ?? "",
    html: c.html ?? "",
    design: c.design ?? "",
    segment_id: c.segment_id ?? "",
    audience: c.contact_ids ? "contacts" : c.segment_id ? "segment" : "all",
    contact_ids: c.contact_ids ?? [],
  };
}

function toInput(f: FormState, html: string): CampaignInput {
  return {
    name: f.name.trim() || (f.subject.trim() ? campaignNameFrom(f.subject) : t("Campagne sans titre", "Untitled campaign")),
    subject: f.subject.trim(),
    preheader: f.preheader.trim() || undefined,
    from_name: f.from_name.trim() || undefined,
    // Empty = the account's default address (null clears an older choice).
    from_email: f.from_email.trim() || null,
    html,
    design: f.design || null,
    segment_id: f.audience === "segment" ? f.segment_id || null : null,
    contact_ids: f.audience === "contacts" ? f.contact_ids : null,
  };
}

/** Sender address: only the addresses the account may send from (its verified address, other ones on that domain, Pingsell's). */
function SenderSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [data, setData] = useState<SendingDomainResponse | null>(null);
  useEffect(() => {
    api.sendingDomain.get().then(setData, () => undefined);
  }, []);
  const [custom, setCustom] = useState(false);
  if (!data) return <Select id="cp-from-email" disabled><option>{t("Chargement…", "Loading…")}</option></Select>;

  const verified = data.domain?.status === "verified" ? data.domain.domain : null;
  const shared = data.default_from_email ?? "";
  const current = value.trim().toLowerCase();
  const onDomain = !!verified && (current.endsWith(`@${verified}`) || current.endsWith(`.${verified}`));
  const allowed = !current || current === shared.toLowerCase() || onDomain;
  const extras = [shared].filter((e) => e && e !== data.from_email);
  const isCustom = custom || (onDomain && current !== data.from_email);
  const selectValue = !allowed ? "" : isCustom ? "__custom" : current === data.from_email ? "" : current;
  const localPart = onDomain ? current.slice(0, current.lastIndexOf("@")) : "";

  return (
    <div className="space-y-2">
      <Select
        id="cp-from-email"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom") {
            setCustom(true);
            onChange("");
          } else {
            setCustom(false);
            onChange(v);
          }
        }}
      >
        <option value="">{data.from_email}{t(" (par défaut)", " (default)")}</option>
        {extras.map((e) => (
          <option key={e} value={e}>
            {e}{t(" (adresse Pingsell)", " (Pingsell address)")}
          </option>
        ))}
        {verified && <option value="__custom">{t(`Une autre adresse @${verified}…`, `Another @${verified} address…`)}</option>}
      </Select>
      {isCustom && verified && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={t("Début de l'adresse", "Address name")}
            value={localPart}
            onChange={(e) => {
              const l = e.target.value.replace(/[\s@]/g, "");
              onChange(l ? `${l}@${verified}` : "");
            }}
            placeholder="contact"
            className="max-w-40"
          />
          <span className="truncate text-sm text-slate-600 dark:text-slate-300">@{verified}</span>
        </div>
      )}
      {!allowed && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t(`${value} n'est pas une adresse autorisée : la campagne partira de ${data.from_email}.`, `${value} isn't an allowed address: the campaign will go out from ${data.from_email}.`)}
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {verified
          ? t("Vos adresses se gèrent dans ", "Manage your addresses in ")
          : t("Pour envoyer depuis votre adresse pro, ajoutez-la dans ", "To send from your work address, add it in ")}
        <Link to="/parametres" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t("Paramètres", "Settings")}
        </Link>
        .
      </p>
    </div>
  );
}

/** Derive a readable internal name from a subject, dropping merge tags. */
function campaignNameFrom(subject: string): string {
  const clean = subject.replace(/\{\{[^}]*\}\}[,:]?\s*/g, "").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : t("Nouvelle campagne", "New campaign");
}

export function CampaignEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { account } = useAuth();

  const campaign = useAsync(() => (id ? api.campaigns.get(id) : Promise.resolve(null)), [id]);
  const segments = useAsync(() => api.segments.list(), []);

  const brand = account?.name ?? t("Votre marque", "Your brand");
  const [form, setForm] = useState<FormState>(() => ({
    name: "",
    subject: "",
    preheader: "",
    from_name: account?.name ?? "",
    from_email: "",
    html: "",
    design: serializeDesign(PRESETS[0].build(account?.name ?? t("Votre marque", "Your brand"))),
    segment_id: "",
    audience: "all",
    contact_ids: [],
  }));
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [toVisualOpen, setToVisualOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // New campaigns open straight into the full-screen editor.
  const [editorOpen, setEditorOpen] = useState(!id);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");

  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState(account?.email ?? "");
  const [testing, setTesting] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 24 * 3600 * 1000)));
  const [scheduling, setScheduling] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<number | null>(null);

  // New campaign: start from the account's brand kit (theme, logo, socials, footer) if one is saved.
  const designTouched = useRef(false);
  useEffect(() => {
    if (id) return;
    let cancelled = false;
    api.brandKit
      .get()
      .then((raw) => {
        const kit = parseBrandKit(raw);
        if (!kit || cancelled) return;
        setForm((f) => {
          const d = parseDesign(f.design);
          if (!d || designTouched.current) return f;
          return { ...f, design: serializeDesign(applyBrandKit(d, kit)) };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (campaign.data) {
      const f = toForm(campaign.data);
      setForm(f);
      setMode(f.design ? "visual" : "html");
      setSavedSnapshot(JSON.stringify(f));
    }
  }, [campaign.data]);

  const c = campaign.data ?? null;
  const editable = !c || c.status === "draft";
  const dirty = JSON.stringify(form) !== savedSnapshot;
  const selectedSegment = useMemo(() => segments.data?.find((s) => s.id === form.segment_id), [segments.data, form.segment_id]);

  const design = useMemo(() => parseDesign(form.design), [form.design]);
  const visual = mode === "visual" && !!design;
  /** HTML actually saved/sent: rendered from blocks in visual mode, raw otherwise. */
  const html = useMemo(() => (visual && design ? renderEmail(design, form.preheader) : form.html), [visual, design, form.preheader, form.html]);

  function onDesignChange(d: Design) {
    designTouched.current = true;
    setForm((f) => ({ ...f, design: serializeDesign(d) }));
  }

  /** Apply a preset. When `withDesign` is false the editor already swapped the blocks (with undo). */
  function applyPreset(p: Preset, withDesign = true) {
    designTouched.current = true;
    setForm((f) => ({
      ...f,
      design: withDesign ? serializeDesign(p.build(brand)) : f.design,
      subject: p.subject && (!f.subject || f.subject === lastPresetSubject.current) ? p.subject : f.subject,
      preheader: p.preheader && (!f.preheader || f.preheader === lastPresetPreheader.current) ? p.preheader : f.preheader,
      name: f.name || (p.key !== "blank" ? p.name : ""),
    }));
    lastPresetSubject.current = p.subject;
    lastPresetPreheader.current = p.preheader;
    setMode("visual");
  }
  const lastPresetSubject = useRef("");
  const lastPresetPreheader = useRef("");

  function switchMode(next: "visual" | "html") {
    if (next === "html") {
      // Freeze the current rendering into the HTML editor.
      setForm((f) => ({ ...f, html }));
      setMode("html");
    } else if (design) {
      setMode("visual");
    } else {
      setToVisualOpen(true);
    }
  }

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Persist the draft; returns the campaign id (creating it if needed). */
  async function persist(silent = false): Promise<string | null> {
    if (!form.subject.trim()) {
      toast.error(t("L'objet de l'email est obligatoire", "Email subject is required"));
      return null;
    }
    setSaving(true);
    try {
      let saved: Campaign;
      if (!id) {
        saved = await api.campaigns.create(toInput(form, html));
        navigate(`/campagnes/${saved.id}`, { replace: true });
      } else if (dirty) {
        saved = await api.campaigns.update(id, toInput(form, html));
      } else {
        return id;
      }
      setSavedSnapshot(JSON.stringify(form));
      if (!silent) toast.success(t("Brouillon enregistré", "Draft saved"));
      return saved.id ?? id ?? null;
    } catch (err) {
      toast.error(err);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const cid = await persist(true);
    if (!cid) return;
    setTesting(true);
    try {
      await api.campaigns.sendTest(cid, testTo.trim());
      toast.success(t("Email de test envoyé", "Test email sent"), testTo.trim());
      setTestOpen(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  }

  /** Never fall back to everyone because the segment or the contacts were left empty. */
  function audienceReady(): boolean {
    if (form.audience === "segment" && !form.segment_id) {
      toast.error(t("Choisissez un segment avant d'envoyer.", "Choose a segment before sending."));
      return false;
    }
    if (form.audience === "contacts" && !form.contact_ids.length) {
      toast.error(t("Ajoutez au moins un contact avant d'envoyer.", "Add at least one contact before sending."));
      return false;
    }
    return true;
  }

  async function openSendConfirm() {
    if (!audienceReady()) return;
    setRecipients(null);
    setSendOpen(true);
    try {
      if (form.audience === "contacts") {
        let total = 0;
        for (let i = 0; i < form.contact_ids.length; i += 200) {
          const res = await api.contacts.list({ status: "subscribed", ids: form.contact_ids.slice(i, i + 200).join(","), limit: 1 });
          total += res.total;
        }
        setRecipients(total);
        return;
      }
      const res = await api.contacts.list({ status: "subscribed", segment_id: form.audience === "segment" ? form.segment_id || undefined : undefined, limit: 1 });
      setRecipients(res.total);
    } catch {
      setRecipients(selectedSegment?.count ?? null);
    }
  }

  async function sendNow() {
    const cid = await persist(true);
    if (!cid) return;
    setSending(true);
    try {
      await api.campaigns.send(cid);
      toast.success(t("Envoi lancé", "Sending started"), t("Vos emails partent en ce moment.", "Your emails are on their way."));
      navigate(`/campagnes/${cid}/rapport`);
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
      setSendOpen(false);
    }
  }

  async function schedule() {
    if (!audienceReady()) return;
    const date = new Date(scheduleAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
      toast.error(t("Choisissez une date dans le futur", "Pick a date in the future"));
      return;
    }
    const cid = await persist(true);
    if (!cid) return;
    setScheduling(true);
    try {
      await api.campaigns.schedule(cid, date.toISOString());
      toast.success(t("Campagne programmée", "Campaign scheduled"), formatDateTime(date.toISOString()));
      setScheduleOpen(false);
      await campaign.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setScheduling(false);
    }
  }

  async function unschedule() {
    if (!id) return;
    try {
      await api.campaigns.unschedule(id);
      toast.success(t("Programmation annulée", "Schedule canceled"), t("La campagne est de nouveau un brouillon.", "The campaign is back to draft."));
      await campaign.reload();
    } catch (err) {
      toast.error(err);
    }
  }

  if (campaign.error) return <ErrorState message={campaign.error} onRetry={campaign.reload} />;
  if (id && campaign.loading && !c) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  const status = c ? CAMPAIGN_STATUS[c.status] : CAMPAIGN_STATUS.draft;

  const settingsCard = (
    <Card>
      <CardHeader title={t("Paramètres", "Settings")} />
      <fieldset disabled={!editable} className={`grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 `}>
        <Field label={t("Nom interne", "Internal name")} htmlFor="cp-name" className="sm:col-span-2">
          <Input id="cp-name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder={t("ex : Soldes d'hiver 2026", "e.g. Winter Sale 2026")} />
        </Field>
        <Field label={t("Objet *", "Subject *")} htmlFor="cp-subject" className="sm:col-span-2" hint={t("Astuce : personnalisez avec {{first_name}}.", "Tip: personalize with {{first_name}}.")}>
          <Input id="cp-subject" value={form.subject} onChange={(e) => set("subject")(e.target.value)} placeholder={t("{{first_name}}, vos -20 % vous attendent", "{{first_name}}, your 20% off is waiting")} />
        </Field>
        <Field label={t("Pré-en-tête", "Preheader")} htmlFor="cp-preheader" className="sm:col-span-2">
          <Input id="cp-preheader" value={form.preheader} onChange={(e) => set("preheader")(e.target.value)} placeholder={t("Texte affiché après l'objet dans la boîte de réception", "Text shown after the subject line in the inbox")} />
        </Field>
        <Field label={t("Nom de l'expéditeur", "Sender name")} htmlFor="cp-from-name">
          <Input id="cp-from-name" value={form.from_name} onChange={(e) => set("from_name")(e.target.value)} />
        </Field>
        <Field label={t("Email de l'expéditeur", "Sender email")} htmlFor="cp-from-email">
          <SenderSelect value={form.from_email} onChange={set("from_email")} />
        </Field>
        <div className="space-y-3 pt-2 sm:col-span-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t("Destinataires", "Recipients")}</p>
          <div>
            <Segmented
              value={form.audience}
              onChange={(v) => set("audience")(v)}
              options={[
                { value: "all", label: t("Tous mes contacts", "All my contacts") },
                { value: "segment", label: t("Un segment", "A segment") },
                { value: "contacts", label: t("Contacts choisis", "Chosen contacts") },
              ]}
            />
          </div>
          {form.audience === "segment" && (
            <Select id="cp-segment" aria-label={t("Segment", "Segment")} value={form.segment_id} onChange={(e) => set("segment_id")(e.target.value)}>
              <option value="">{t("Choisissez un segment…", "Choose a segment…")}</option>
              {(segments.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.count != null ? ` (${s.count})` : ""}
                </option>
              ))}
            </Select>
          )}
          {form.audience === "contacts" && <ContactPicker ids={form.contact_ids} onChange={set("contact_ids")} disabled={!editable} />}
          {form.audience !== "contacts" && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Users className="size-3.5 shrink-0" />
              {form.audience === "segment"
                ? selectedSegment
                  ? t(`${formatNumber(selectedSegment.count)} contacts dans ce segment (seuls les abonnés recevront l'email)`, `${formatNumber(selectedSegment.count)} ${selectedSegment.count === 1 ? "contact" : "contacts"} in this segment (only subscribers will receive the email)`)
                  : t("Choisissez le segment à qui envoyer.", "Choose the segment to send to.")
                : t("Tous vos contacts abonnés recevront l'email.", "All your subscribed contacts will receive the email.")}
            </p>
          )}
        </div>
      </fieldset>
    </Card>
  );

  return (
    <>
      <PageHeader
        back={
          <Link to="/campagnes" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="size-4" /> {t("Campagnes", "Campaigns")}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {form.name || (id ? t("Campagne", "Campaign") : t("Nouvelle campagne", "New campaign"))}
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </span>
        }
        actions={
          editable ? (
            <>
              <Button variant="secondary" icon={Save} onClick={() => void persist()} loading={saving} disabled={!!id && !dirty}>
                {id && !dirty ? t("Enregistré", "Saved") : t("Enregistrer", "Save")}
              </Button>
              <Button variant="secondary" icon={FlaskConical} onClick={() => setTestOpen(true)}>
                {t("Tester", "Test")}
              </Button>
              <Button variant="secondary" icon={CalendarClock} onClick={() => setScheduleOpen(true)}>
                {t("Programmer", "Schedule")}
              </Button>
              <Button icon={Send} onClick={openSendConfirm}>
                {t("Envoyer", "Send")}
              </Button>
            </>
          ) : c?.status === "scheduled" ? (
            <Button variant="secondary" icon={XCircle} onClick={unschedule}>
              {t("Annuler la programmation", "Cancel schedule")}
            </Button>
          ) : (
            <Link to={`/campagnes/${id}/rapport`}>
              <Button icon={BarChart3}>{t("Voir le rapport", "View report")}</Button>
            </Link>
          )
        }
      />

      {!editable && c && (
        <div className="mb-6 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900">
          {c.status === "scheduled"
            ? t(`Cette campagne est programmée pour le ${formatDateTime(c.scheduled_at)}. Annulez la programmation pour la modifier.`, `This campaign is scheduled for ${formatDateTime(c.scheduled_at)}. Cancel the schedule to edit it.`)
            : t("Cette campagne a déjà été envoyée : elle n'est plus modifiable.", "This campaign has already been sent and can no longer be edited.")}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={visual ? "visual" : "html"}
          onChange={(v) => switchMode(v)}
          options={[
            { value: "visual", label: t("Éditeur visuel", "Visual editor"), icon: LayoutGrid },
            { value: "html", label: t("Code HTML", "HTML code"), icon: Code2 },
          ]}
        />
        {visual && (
          <Button variant="secondary" size="sm" icon={Eye} onClick={() => setPreviewOpen(true)}>
            {t("Aperçu boîte de réception", "Inbox preview")}
          </Button>
        )}
      </div>

      {visual && design ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          {settingsCard}
          <Card className="overflow-hidden">
            <CardHeader
              title={t("Contenu", "Content")}
              description={t(`${design.blocks.length} blocs · éditeur visuel`, `${design.blocks.length} ${design.blocks.length === 1 ? "block" : "blocks"} · visual editor`)}
              action={
                <Button size="sm" icon={PenLine} onClick={() => setEditorOpen(true)}>
                  {editable ? t("Ouvrir l'éditeur", "Open editor") : t("Voir le design", "View design")}
                </Button>
              }
            />
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="group relative block h-[420px] w-full overflow-hidden"
              style={{ background: design.theme.background }}
              aria-label={t("Ouvrir l'éditeur", "Open editor")}
            >
              <iframe
                title={t("Miniature de l'email", "Email thumbnail")}
                srcDoc={renderMergeTags(html)}
                tabIndex={-1}
                className="pointer-events-none absolute top-0 left-1/2 h-[1000px] w-[680px] origin-top -translate-x-1/2 scale-[0.6] border-0"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 transition group-hover:bg-slate-900/40">
                <span className="flex translate-y-2 items-center gap-2 rounded-full bg-white px-5 py-2.5 font-display text-sm font-semibold text-slate-900 opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100">
                  <PenLine className="size-4" /> {t("Modifier le design", "Edit design")}
                </span>
              </span>
            </button>
          </Card>
          {editorOpen && (
            <EmailBuilder
              design={design}
              onChange={onDesignChange}
              onApplyPreset={(p) => applyPreset(p, false)}
              brand={brand}
              disabled={!editable}
              subject={form.subject}
              preheader={form.preheader}
              fromName={form.from_name}
              onSubjectChange={set("subject")}
              onPreheaderChange={set("preheader")}
              title={form.name || (id ? t("Campagne", "Campaign") : t("Nouvelle campagne", "New campaign"))}
              saving={saving}
              dirty={!id || dirty}
              onClose={() => setEditorOpen(false)}
              onSave={() => void persist()}
              onTest={() => setTestOpen(true)}
              onPreview={() => setPreviewOpen(true)}
              onCodeMode={() => {
                setEditorOpen(false);
                switchMode("html");
              }}
            />
          )}
        </div>
      ) : (
      <>
      <div className="mb-4 xl:hidden">
        <Segmented
          value={mobileTab}
          onChange={setMobileTab}
          options={[
            { value: "edit", label: t("Édition", "Edit"), icon: Code2 },
            { value: "preview", label: t("Aperçu", "Preview"), icon: Eye },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className={`space-y-6 ${mobileTab === "preview" ? "hidden xl:block" : ""}`}>
          {settingsCard}

          {editable && (
            <AiGeneratePanel
              defaultBrand={account?.name}
              onGenerated={(email) =>
                setForm((f) => ({
                  ...f,
                  subject: email.subject,
                  preheader: email.preheader,
                  html: email.html,
                  design: "",
                  name: f.name || campaignNameFrom(email.subject),
                }))
              }
            />
          )}

          <Card>
            <CardHeader
              title={t("Contenu HTML", "HTML content")}
              description={t("Balises disponibles : {{first_name}}, {{last_name}}, {{email}}, {{unsubscribe_url}}", "Available tags: {{first_name}}, {{last_name}}, {{email}}, {{unsubscribe_url}}")}
            />
            <div className="p-4">
              <Textarea
                value={form.html}
                onChange={(e) => setForm((f) => ({ ...f, html: e.target.value, design: "" }))}
                readOnly={!editable}
                spellCheck={false}
                rows={18}
                className="font-mono text-xs leading-relaxed"
                aria-label={t("Code HTML de l'email", "Email HTML code")}
              />
              <GmailImageWarning html={form.html} />
            </div>
          </Card>
        </div>

        <div className={mobileTab === "edit" ? "hidden xl:block" : ""}>
          <Card className="xl:sticky xl:top-24">
            <EmailPreview html={html} subject={form.subject} preheader={form.preheader} fromName={form.from_name} height={680} />
          </Card>
        </div>
      </div>
      </>
      )}

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        size="sm"
        title={t("Envoyer un email de test", "Send a test email")}
        description={t("Les balises seront remplacées par des valeurs d'exemple.", "Merge tags will be replaced with sample values.")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button icon={FlaskConical} onClick={sendTest} loading={testing || saving} disabled={!testTo.trim()}>
              {t("Envoyer le test", "Send test")}
            </Button>
          </>
        }
      >
        <Field label={t("Adresse de réception", "Recipient address")} htmlFor="test-to">
          <Input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        size="sm"
        title={t("Programmer l'envoi", "Schedule send")}
        description={t("La campagne partira automatiquement à la date choisie (heure locale).", "The campaign will go out automatically at the chosen date and time (local time).")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button icon={CalendarClock} onClick={schedule} loading={scheduling || saving}>
              {t("Programmer", "Schedule")}
            </Button>
          </>
        }
      >
        <Field label={t("Date et heure d'envoi", "Send date and time")} htmlFor="schedule-at">
          <Input id="schedule-at" type="datetime-local" value={scheduleAt} min={toDateTimeLocal(new Date())} onChange={(e) => setScheduleAt(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} size="lg" title={t("Aperçu", "Preview")}>
        <EmailPreview html={html} subject={form.subject} preheader={form.preheader} fromName={form.from_name} height={640} />
      </Modal>

      <ConfirmModal
        open={toVisualOpen}
        onClose={() => setToVisualOpen(false)}
        onConfirm={() => {
          applyPreset(PRESETS[0]);
          setToVisualOpen(false);
        }}
        title={t("Passer à l'éditeur visuel ?", "Switch to the visual editor?")}
        confirmLabel={t("Repartir d'une page blanche", "Start from a blank page")}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t(
            "Ce contenu a été écrit en HTML : il ne peut pas être converti en blocs. Vous repartirez d'un modèle visuel, et le HTML actuel sera remplacé à l'enregistrement.",
            "This content was written in HTML and can't be converted into blocks. You'll start from a visual template, and the current HTML will be replaced when you save.",
          )}
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={sendNow}
        loading={sending || saving}
        title={t("Envoyer la campagne maintenant ?", "Send the campaign now?")}
        confirmLabel={recipients != null ? t(`Envoyer à ${formatNumber(recipients)} contacts`, `Send to ${formatNumber(recipients)} ${recipients === 1 ? "contact" : "contacts"}`) : t("Envoyer", "Send")}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-4 rounded-xl bg-brand-50 p-4 dark:bg-brand-900/30">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Users className="size-5" />
            </span>
            <div>
              {recipients == null ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatNumber(recipients)}</p>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("destinataires abonnés", recipients === 1 ? "subscribed recipient" : "subscribed recipients")} · {form.audience === "contacts" ? t("contacts choisis", "chosen contacts") : form.audience === "segment" && selectedSegment ? t(`segment « ${selectedSegment.name} »`, `segment “${selectedSegment.name}”`) : t("tous les abonnés", "all subscribers")}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("Objet :", "Subject:")} <span className="font-medium text-slate-700 dark:text-slate-200">{form.subject || "—"}</span>
          </p>
          <p className="text-xs text-slate-400">{t("Cette action est irréversible.", "This action can't be undone.")}</p>
        </div>
      </ConfirmModal>
    </>
  );
}

/** Gmail drops SVG and does not show WebP pictures: say which ones before the email goes out. */
function GmailImageWarning({ html }: { html: string }) {
  const svg = (html.match(/<svg[\s>]/gi) ?? []).length + (html.match(/<img\b[^>]*src=["'][^"']*(?:\.svg(?:[?#][^"']*)?|data:image\/svg[^"']*)["']/gi) ?? []).length;
  const webp = (html.match(/<img\b[^>]*src=["'][^"']*(?:\.webp(?:[?#][^"']*)?|data:image\/webp[^"']*)["']/gi) ?? []).length;
  if (!svg && !webp) return null;
  const parts = [
    svg ? t(`${svg} image${svg > 1 ? "s" : ""} SVG`, `${svg} SVG image${svg > 1 ? "s" : ""}`) : "",
    webp ? t(`${webp} image${webp > 1 ? "s" : ""} WebP`, `${webp} WebP image${webp > 1 ? "s" : ""}`) : "",
  ].filter(Boolean);
  return (
    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-900/20 dark:text-amber-200">
      {t(
        `Cet email contient ${parts.join(" et ")}. Gmail ne les affiche pas : vos destinataires sur Gmail verront un vide à leur place. Utilisez plutôt des images PNG ou JPG.`,
        `This email contains ${parts.join(" and ")}. Gmail doesn't show them: your recipients on Gmail will see a gap instead. Use PNG or JPG images instead.`,
      )}
    </p>
  );
}

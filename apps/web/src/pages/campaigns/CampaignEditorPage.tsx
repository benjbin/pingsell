import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, BarChart3, CalendarClock, Code2, Eye, FlaskConical, LayoutGrid, Save, Send, Users, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/useAsync";
import { CAMPAIGN_STATUS } from "../../lib/constants";
import { formatDateTime, formatNumber, toDateTimeLocal } from "../../lib/format";
import type { Campaign, CampaignInput } from "../../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea } from "../../components/ui/primitives";
import { ConfirmModal, Modal } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { AiGeneratePanel } from "../../components/AiGeneratePanel";
import { EmailPreview } from "../../components/EmailPreview";
import { EmailBuilder } from "../../components/email-builder/EmailBuilder";
import { PRESETS, parseDesign, renderEmail, serializeDesign, type Design, type Preset } from "../../components/email-builder/model";

interface FormState {
  name: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  html: string;
  design: string;
  segment_id: string;
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
  };
}

function toInput(f: FormState, html: string): CampaignInput {
  return {
    name: f.name.trim() || "Campagne sans titre",
    subject: f.subject.trim(),
    preheader: f.preheader.trim() || undefined,
    from_name: f.from_name.trim() || undefined,
    from_email: f.from_email.trim() || undefined,
    html,
    design: f.design || null,
    segment_id: f.segment_id || null,
  };
}

/** Derive a readable internal name from a subject, dropping merge tags. */
function campaignNameFrom(subject: string): string {
  const clean = subject.replace(/\{\{[^}]*\}\}[,:]?\s*/g, "").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Nouvelle campagne";
}

export function CampaignEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { account } = useAuth();

  const campaign = useAsync(() => (id ? api.campaigns.get(id) : Promise.resolve(null)), [id]);
  const segments = useAsync(() => api.segments.list(), []);

  const brand = account?.name ?? "Votre marque";
  const [form, setForm] = useState<FormState>(() => ({
    name: "",
    subject: "",
    preheader: "",
    from_name: account?.name ?? "",
    from_email: "",
    html: "",
    design: serializeDesign(PRESETS[0].build(account?.name ?? "Votre marque")),
    segment_id: "",
  }));
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [toVisualOpen, setToVisualOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
    setForm((f) => ({ ...f, design: serializeDesign(d) }));
  }

  function applyPreset(p: Preset) {
    setForm((f) => ({
      ...f,
      design: serializeDesign(p.build(brand)),
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
      toast.error("L'objet de l'email est obligatoire");
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
      if (!silent) toast.success("Brouillon enregistré");
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
      toast.success("Email de test envoyé", testTo.trim());
      setTestOpen(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  }

  async function openSendConfirm() {
    setRecipients(null);
    setSendOpen(true);
    try {
      const res = await api.contacts.list({ status: "subscribed", segment_id: form.segment_id || undefined, limit: 1 });
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
      toast.success("Envoi lancé", "Vos emails partent en ce moment.");
      navigate(`/campagnes/${cid}/rapport`);
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
      setSendOpen(false);
    }
  }

  async function schedule() {
    const date = new Date(scheduleAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
      toast.error("Choisissez une date dans le futur");
      return;
    }
    const cid = await persist(true);
    if (!cid) return;
    setScheduling(true);
    try {
      await api.campaigns.schedule(cid, date.toISOString());
      toast.success("Campagne programmée", formatDateTime(date.toISOString()));
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
      toast.success("Programmation annulée", "La campagne est de nouveau un brouillon.");
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
      <CardHeader title="Paramètres" />
      <fieldset disabled={!editable} className={`grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 ${visual ? "lg:grid-cols-4" : ""}`}>
        <Field label="Nom interne" htmlFor="cp-name" className="sm:col-span-2">
          <Input id="cp-name" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="ex : Soldes d'hiver 2026" />
        </Field>
        <Field label="Objet *" htmlFor="cp-subject" className="sm:col-span-2" hint="Astuce : personnalisez avec {{first_name}}.">
          <Input id="cp-subject" value={form.subject} onChange={(e) => set("subject")(e.target.value)} placeholder="{{first_name}}, vos -20 % vous attendent" />
        </Field>
        <Field label="Pré-en-tête" htmlFor="cp-preheader" className="sm:col-span-2">
          <Input id="cp-preheader" value={form.preheader} onChange={(e) => set("preheader")(e.target.value)} placeholder="Texte affiché après l'objet dans la boîte de réception" />
        </Field>
        <Field label="Nom de l'expéditeur" htmlFor="cp-from-name">
          <Input id="cp-from-name" value={form.from_name} onChange={(e) => set("from_name")(e.target.value)} />
        </Field>
        <Field label="Email de l'expéditeur" htmlFor="cp-from-email">
          <Input id="cp-from-email" type="email" value={form.from_email} onChange={(e) => set("from_email")(e.target.value)} placeholder="bonjour@maboutique.fr" />
        </Field>
        <Field
          label="Destinataires"
          htmlFor="cp-segment"
          className="sm:col-span-2"
          hint={
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {selectedSegment
                ? `${formatNumber(selectedSegment.count)} contacts dans ce segment (seuls les abonnés recevront l'email)`
                : "Tous les contacts abonnés"}
            </span>
          }
        >
          <Select id="cp-segment" value={form.segment_id} onChange={(e) => set("segment_id")(e.target.value)}>
            <option value="">Tous les abonnés</option>
            {(segments.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.count != null ? ` (${s.count})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
    </Card>
  );

  return (
    <>
      <PageHeader
        back={
          <Link to="/campagnes" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="size-4" /> Campagnes
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {form.name || (id ? "Campagne" : "Nouvelle campagne")}
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </span>
        }
        actions={
          editable ? (
            <>
              <Button variant="secondary" icon={Save} onClick={() => void persist()} loading={saving} disabled={!!id && !dirty}>
                {id && !dirty ? "Enregistré" : "Enregistrer"}
              </Button>
              <Button variant="secondary" icon={FlaskConical} onClick={() => setTestOpen(true)}>
                Tester
              </Button>
              <Button variant="secondary" icon={CalendarClock} onClick={() => setScheduleOpen(true)}>
                Programmer
              </Button>
              <Button icon={Send} onClick={openSendConfirm}>
                Envoyer
              </Button>
            </>
          ) : c?.status === "scheduled" ? (
            <Button variant="secondary" icon={XCircle} onClick={unschedule}>
              Annuler la programmation
            </Button>
          ) : (
            <Link to={`/campagnes/${id}/rapport`}>
              <Button icon={BarChart3}>Voir le rapport</Button>
            </Link>
          )
        }
      />

      {!editable && c && (
        <div className="mb-6 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900">
          {c.status === "scheduled"
            ? `Cette campagne est programmée pour le ${formatDateTime(c.scheduled_at)}. Annulez la programmation pour la modifier.`
            : "Cette campagne a déjà été envoyée : elle n'est plus modifiable."}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={visual ? "visual" : "html"}
          onChange={(v) => switchMode(v)}
          options={[
            { value: "visual", label: "Éditeur visuel", icon: LayoutGrid },
            { value: "html", label: "Code HTML", icon: Code2 },
          ]}
        />
        {visual && (
          <Button variant="secondary" size="sm" icon={Eye} onClick={() => setPreviewOpen(true)}>
            Aperçu boîte de réception
          </Button>
        )}
      </div>

      {visual && design ? (
        <div className="space-y-6">
          {settingsCard}
          <EmailBuilder design={design} onChange={onDesignChange} onApplyPreset={applyPreset} brand={brand} disabled={!editable} />
        </div>
      ) : (
      <>
      <div className="mb-4 xl:hidden">
        <Segmented
          value={mobileTab}
          onChange={setMobileTab}
          options={[
            { value: "edit", label: "Édition", icon: Code2 },
            { value: "preview", label: "Aperçu", icon: Eye },
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
              title="Contenu HTML"
              description="Balises disponibles : {{first_name}}, {{last_name}}, {{email}}, {{unsubscribe_url}}"
            />
            <div className="p-4">
              <Textarea
                value={form.html}
                onChange={(e) => setForm((f) => ({ ...f, html: e.target.value, design: "" }))}
                readOnly={!editable}
                spellCheck={false}
                rows={18}
                className="font-mono text-xs leading-relaxed"
                aria-label="Code HTML de l'email"
              />
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
        title="Envoyer un email de test"
        description="Les balises seront remplacées par des valeurs d'exemple."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestOpen(false)}>
              Annuler
            </Button>
            <Button icon={FlaskConical} onClick={sendTest} loading={testing || saving} disabled={!testTo.trim()}>
              Envoyer le test
            </Button>
          </>
        }
      >
        <Field label="Adresse de réception" htmlFor="test-to">
          <Input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        size="sm"
        title="Programmer l'envoi"
        description="La campagne partira automatiquement à la date choisie (heure locale)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
              Annuler
            </Button>
            <Button icon={CalendarClock} onClick={schedule} loading={scheduling || saving}>
              Programmer
            </Button>
          </>
        }
      >
        <Field label="Date et heure d'envoi" htmlFor="schedule-at">
          <Input id="schedule-at" type="datetime-local" value={scheduleAt} min={toDateTimeLocal(new Date())} onChange={(e) => setScheduleAt(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} size="lg" title="Aperçu">
        <EmailPreview html={html} subject={form.subject} preheader={form.preheader} fromName={form.from_name} height={640} />
      </Modal>

      <ConfirmModal
        open={toVisualOpen}
        onClose={() => setToVisualOpen(false)}
        onConfirm={() => {
          applyPreset(PRESETS[0]);
          setToVisualOpen(false);
        }}
        title="Passer à l'éditeur visuel ?"
        confirmLabel="Repartir d'une page blanche"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Ce contenu a été écrit en HTML : il ne peut pas être converti en blocs. Vous repartirez d'un modèle visuel, et le HTML actuel sera remplacé à
          l'enregistrement.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={sendNow}
        loading={sending || saving}
        title="Envoyer la campagne maintenant ?"
        confirmLabel={recipients != null ? `Envoyer à ${formatNumber(recipients)} contacts` : "Envoyer"}
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
                <p className="display text-[34px] leading-none text-slate-950 tabular-nums dark:text-white">{formatNumber(recipients)}</p>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                destinataires abonnés · {selectedSegment ? `segment « ${selectedSegment.name} »` : "tous les abonnés"}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Objet : <span className="font-medium text-slate-700 dark:text-slate-200">{form.subject || "—"}</span>
          </p>
          <p className="text-xs text-slate-400">Cette action est irréversible.</p>
        </div>
      </ConfirmModal>
    </>
  );
}

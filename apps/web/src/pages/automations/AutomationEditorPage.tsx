import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BellRing,
  Clock,
  Eye,
  EyeOff,
  Flag,
  Mail,
  Pause,
  Play,
  Plus,
  Save,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  Trash2,
  UserPlus,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/useAsync";
import { TRIGGERS } from "../../lib/constants";
import { cx } from "../../lib/format";
import type { AutomationStep, AutomationTrigger } from "../../lib/types";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "../../components/ui/primitives";
import { useToast } from "../../components/ui/Toast";
import { AiGeneratePanel } from "../../components/AiGeneratePanel";
import { EmailPreview } from "../../components/EmailPreview";
import { DEFAULT_EMAIL_HTML } from "../campaigns/defaultTemplate";

const TRIGGER_ICONS: Record<AutomationTrigger, LucideIcon> = {
  contact_created: UserPlus,
  tag_added: Tag,
  order_created: ShoppingBag,
  cart_abandoned: ShoppingCart,
};

interface KeyedStep {
  key: string;
  step: AutomationStep;
}

let keySeq = 0;
const keyed = (step: AutomationStep): KeyedStep => ({ key: `s${++keySeq}`, step });

const newEmailStep = (): AutomationStep => ({ type: "email", subject: "", html: DEFAULT_EMAIL_HTML });
const newWaitStep = (): AutomationStep => ({ type: "wait", hours: 24 });
const newPushStep = (): AutomationStep => ({ type: "push", title: "", body: "", url: "", in_app: true });

type PushStep = Extract<AutomationStep, { type: "push" }>;

function PushStepEditor({ step, onChange }: { step: PushStep; onChange: (s: PushStep) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Titre">
        <Input maxLength={120} value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} placeholder="{{first_name|Bonjour}}, votre panier vous attend" />
      </Field>
      <Field label="Texte">
        <Textarea rows={2} maxLength={500} value={step.body} onChange={(e) => onChange({ ...step, body: e.target.value })} placeholder="Finalisez votre commande, la livraison est offerte." />
      </Field>
      <Field label="Lien à l'ouverture (optionnel)" hint="Envoyée sur tous les appareils du contact enregistrés dans votre application.">
        <Input value={step.url ?? ""} onChange={(e) => onChange({ ...step, url: e.target.value })} placeholder="https://… ou monapp://panier" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" className="size-4 accent-brand-500" checked={step.in_app !== false} onChange={(e) => onChange({ ...step, in_app: e.target.checked })} />
        Garder aussi la notification dans l'app (centre de notifications)
      </label>
    </div>
  );
}

function WaitStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "wait" }>; onChange: (s: AutomationStep) => void }) {
  const [unit, setUnit] = useState<"hours" | "days">(() => (step.hours >= 24 && step.hours % 24 === 0 ? "days" : "hours"));
  const display = unit === "days" ? step.hours / 24 : step.hours;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>Attendre</span>
      <Input
        type="number"
        min={1}
        className="h-9 w-24"
        value={Number.isFinite(display) ? display : ""}
        onChange={(e) => {
          const n = Math.max(0, Number(e.target.value));
          onChange({ type: "wait", hours: unit === "days" ? n * 24 : n });
        }}
        aria-label="Durée"
      />
      <Select
        className="h-9 w-auto"
        value={unit}
        onChange={(e) => {
          const u = e.target.value as "hours" | "days";
          setUnit(u);
          onChange({ type: "wait", hours: u === "days" ? Math.max(1, Math.round(step.hours / 24)) * 24 : step.hours });
        }}
        aria-label="Unité"
      >
        <option value="hours">heure(s)</option>
        <option value="days">jour(s)</option>
      </Select>
      <span>avant l'étape suivante</span>
    </div>
  );
}

function EmailStepEditor({
  step,
  onChange,
  brand,
}: {
  step: Extract<AutomationStep, { type: "email" }>;
  onChange: (s: AutomationStep) => void;
  brand?: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [showAi, setShowAi] = useState(false);
  return (
    <div className="space-y-3">
      <Field label="Objet">
        <Input value={step.subject} onChange={(e) => onChange({ ...step, subject: e.target.value })} placeholder="Bienvenue {{first_name}} !" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={Sparkles} onClick={() => setShowAi((v) => !v)}>
          {showAi ? "Masquer les modèles" : "Partir d'un modèle"}
        </Button>
        <Button variant="secondary" size="sm" icon={showPreview ? EyeOff : Eye} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? "Voir le code" : "Aperçu"}
        </Button>
      </div>
      {showAi && (
        <AiGeneratePanel
          compact
          defaultBrand={brand}
          onGenerated={(email) => {
            onChange({ type: "email", subject: email.subject, html: email.html });
            setShowAi(false);
            setShowPreview(true);
          }}
        />
      )}
      {showPreview ? (
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
          <EmailPreview html={step.html} height={420} />
        </div>
      ) : (
        <Textarea
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          value={step.html}
          onChange={(e) => onChange({ ...step, html: e.target.value })}
          aria-label="HTML de l'email"
        />
      )}
    </div>
  );
}

function InsertStep({ onInsert }: { onInsert: (s: AutomationStep) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <Button variant="secondary" size="sm" icon={Clock} onClick={() => onInsert(newWaitStep())}>
        Attente
      </Button>
      <Button variant="secondary" size="sm" icon={Mail} onClick={() => onInsert(newEmailStep())}>
        Email
      </Button>
      <Button variant="secondary" size="sm" icon={BellRing} onClick={() => onInsert(newPushStep())}>
        Push
      </Button>
    </div>
  );
}

function Connector() {
  return <div className="mx-auto h-6 w-px bg-slate-300 dark:bg-slate-700" />;
}

export function AutomationEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { account } = useAuth();
  const existing = useAsync(() => (id ? api.automations.get(id) : Promise.resolve(null)), [id]);
  const tags = useAsync(() => api.tags(), []);

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("contact_created");
  const [tag, setTag] = useState("");
  const [steps, setSteps] = useState<KeyedStep[]>(() => [
    keyed({ type: "email", subject: "Bienvenue {{first_name}} !", html: DEFAULT_EMAIL_HTML }),
    keyed({ type: "wait", hours: 72 }),
    keyed(newEmailStep()),
  ]);
  const [status, setStatus] = useState<"active" | "paused">("paused");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    setName(a.name);
    setTrigger(a.trigger);
    setTag(typeof a.trigger_config?.tag === "string" ? a.trigger_config.tag : "");
    setSteps((a.steps ?? []).map(keyed));
    setStatus(a.status);
  }, [existing.data]);

  const updateStep = (key: string, step: AutomationStep) => setSteps((list) => list.map((s) => (s.key === key ? { ...s, step } : s)));
  const removeStep = (key: string) => setSteps((list) => list.filter((s) => s.key !== key));
  const insertAt = (index: number, step: AutomationStep) => setSteps((list) => [...list.slice(0, index), keyed(step), ...list.slice(index)]);
  const move = (index: number, delta: number) =>
    setSteps((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  function validate(): string | null {
    if (!name.trim()) return "Donnez un nom à l'automatisation";
    if (trigger === "tag_added" && !tag.trim()) return "Indiquez le tag qui déclenche l'automatisation";
    if (!steps.some((s) => s.step.type === "email" || s.step.type === "push")) return "Ajoutez au moins une étape email ou push";
    for (const { step } of steps) {
      if (step.type === "email" && !step.subject.trim()) return "Chaque email doit avoir un objet";
      if (step.type === "push" && (!step.title.trim() || !step.body.trim())) return "Chaque notification push doit avoir un titre et un texte";
      if (step.type === "wait" && !(step.hours > 0)) return "Chaque attente doit durer au moins 1 heure";
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    const input = {
      name: name.trim(),
      trigger,
      trigger_config: trigger === "tag_added" ? { tag: tag.trim().toLowerCase() } : {},
      steps: steps.map((s) => s.step),
    };
    try {
      if (isNew) {
        const created = await api.automations.create(input);
        toast.success("Automatisation créée", "Activez-la quand vous êtes prêt.");
        navigate(`/automatisations/${created.id}`, { replace: true });
      } else {
        await api.automations.update(id, input);
        toast.success("Automatisation enregistrée");
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!id) return;
    setToggling(true);
    try {
      if (status === "active") await api.automations.pause(id);
      else await api.automations.activate(id);
      setStatus(status === "active" ? "paused" : "active");
      toast.success(status === "active" ? "Automatisation en pause" : "Automatisation activée");
    } catch (err) {
      toast.error(err);
    } finally {
      setToggling(false);
    }
  }

  if (existing.error) return <ErrorState message={existing.error} onRetry={existing.reload} />;
  if (id && existing.loading && !existing.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        back={
          <Link to="/automatisations" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="size-4" /> Automatisations
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name || (isNew ? "Nouvelle automatisation" : "Automatisation")}
            {!isNew && (
              <Badge tone={status === "active" ? "green" : "slate"} dot>
                {status === "active" ? "Active" : "En pause"}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {!isNew && (
              <Button variant="secondary" icon={status === "active" ? Pause : Play} onClick={toggleStatus} loading={toggling}>
                {status === "active" ? "Mettre en pause" : "Activer"}
              </Button>
            )}
            <Button icon={Save} onClick={save} loading={saving}>
              Enregistrer
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-3xl">
        <Card className="p-5">
          <Field label="Nom" htmlFor="auto-name">
            <Input id="auto-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : Série de bienvenue" />
          </Field>
        </Card>

        <Connector />

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
              <Zap className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Déclencheur</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(TRIGGERS) as AutomationTrigger[]).map((t) => {
              const Icon = TRIGGER_ICONS[t];
              const active = t === trigger;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTrigger(t)}
                  className={cx(
                    "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition",
                    active
                      ? "bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-900/30"
                      : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50",
                  )}
                >
                  <Icon className={cx("mt-0.5 size-5 shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">{TRIGGERS[t].label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{TRIGGERS[t].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {trigger === "tag_added" && (
            <Field label="Tag déclencheur" htmlFor="auto-tag" className="mt-4" hint="L'automatisation démarre quand ce tag est ajouté à un contact.">
              <Input id="auto-tag" list="auto-tag-options" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ex : vip" />
              <datalist id="auto-tag-options">
                {(tags.data ?? []).map((t) => (
                  <option key={t.tag} value={t.tag} />
                ))}
              </datalist>
            </Field>
          )}
        </Card>

        <Connector />
        <InsertStep onInsert={(s) => insertAt(0, s)} />

        {steps.map(({ key, step }, index) => (
          <div key={key}>
            <Connector />
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <span
                  className={cx(
                    "flex size-8 items-center justify-center rounded-lg",
                    step.type === "email"
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
                      : step.type === "push"
                        ? "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300"
                        : "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
                  )}
                >
                  {step.type === "email" ? <Mail className="size-4" /> : step.type === "push" ? <BellRing className="size-4" /> : <Clock className="size-4" />}
                </span>
                <h3 className="flex-1 text-sm font-semibold text-slate-900 dark:text-white">
                  Étape {index + 1} · {step.type === "email" ? "Envoyer un email" : step.type === "push" ? "Notification push" : "Attendre"}
                </h3>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="sm" icon={ArrowUp} onClick={() => move(index, -1)} disabled={index === 0} aria-label="Monter" />
                  <Button variant="ghost" size="sm" icon={ArrowDown} onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label="Descendre" />
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => removeStep(key)} aria-label="Supprimer l'étape" />
                </div>
              </div>
              {step.type === "wait" ? (
                <WaitStepEditor step={step} onChange={(s) => updateStep(key, s)} />
              ) : step.type === "push" ? (
                <PushStepEditor step={step} onChange={(s) => updateStep(key, s)} />
              ) : (
                <EmailStepEditor step={step} onChange={(s) => updateStep(key, s)} brand={account?.name} />
              )}
            </Card>
            <Connector />
            <InsertStep onInsert={(s) => insertAt(index + 1, s)} />
          </div>
        ))}

        <Connector />
        <div className="flex flex-col items-center gap-2 pb-8 text-sm text-slate-500 dark:text-slate-400">
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Flag className="size-4" />
          </span>
          Fin du parcours
        </div>
        {steps.length === 0 && (
          <p className="pb-6 text-center text-sm text-slate-500">
            <Plus className="mr-1 inline size-4" />
            Ajoutez une première étape ci-dessus.
          </p>
        )}
      </div>
    </>
  );
}

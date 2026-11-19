import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BellRing,
  CalendarClock,
  CalendarHeart,
  Clock,
  CircleStop,
  Package,
  Smartphone,
  Eye,
  Globe,
  EyeOff,
  Flag,
  GitBranch,
  Hourglass,
  Mail,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Pointer,
  Save,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Split,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/useAsync";
import { EXIT_CONDITIONS, SITE_ACTIONS, SITE_ACTION_KINDS, TRIGGERS, siteLabel } from "../../lib/constants";
import { cx } from "../../lib/format";
import type { AutomationStep, AutomationTrigger, BranchCondition, ExitCondition, Segment, SiteActionKind, WebSite, WebSiteAction } from "../../lib/types";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "../../components/ui/primitives";
import { useToast } from "../../components/ui/Toast";
import { AiGeneratePanel } from "../../components/AiGeneratePanel";
import { EmailPreview } from "../../components/EmailPreview";
import { DEFAULT_EMAIL_HTML } from "../campaigns/defaultTemplate";
import { t, LOCALE } from "../../lib/i18n";
import { RECIPES } from "./recipes";
import { EventNeverSent, eventSlug } from "../../components/connect/SiteEvents";
import { SITE_ACTION_ICONS, timesSeen, useSites } from "../../components/connect/Sites";

const TRIGGER_ICONS: Record<AutomationTrigger, LucideIcon> = {
  contact_created: UserPlus,
  tag_added: Tag,
  order_created: ShoppingBag,
  cart_abandoned: ShoppingCart,
  order_fulfilled: Package,
  app_signed_in: Smartphone,
  push_subscribed: BellRing,
  event: CalendarClock,
  email_clicked: MousePointerClick,
  date_anniversary: CalendarHeart,
  inactive: Hourglass,
  segment_entered: Users,
  page_visited: Globe,
  product_viewed: Eye,
  site_action: Pointer,
};

/* ------------------------------------------------------------------ step tree in the editor */

type UIStep =
  | Exclude<AutomationStep, { type: "branch" } | { type: "split" }>
  | { type: "branch"; condition: BranchCondition; yes: KeyedStep[]; no: KeyedStep[] }
  | { type: "split"; percent: number; a: KeyedStep[]; b: KeyedStep[] };

interface KeyedStep {
  key: string;
  step: UIStep;
}

let keySeq = 0;
function keyed(step: AutomationStep): KeyedStep {
  const k = `s${++keySeq}`;
  if (step.type === "branch") return { key: k, step: { ...step, yes: step.yes.map(keyed), no: step.no.map(keyed) } };
  if (step.type === "split") return { key: k, step: { ...step, a: step.a.map(keyed), b: step.b.map(keyed) } };
  return { key: k, step };
}
function plain(list: KeyedStep[]): AutomationStep[] {
  return list.map(({ step }) =>
    step.type === "branch"
      ? { ...step, yes: plain(step.yes), no: plain(step.no) }
      : step.type === "split"
        ? { ...step, a: plain(step.a), b: plain(step.b) }
        : step,
  );
}
/** Every step, branches included (for validation). */
function walk(list: KeyedStep[]): UIStep[] {
  return list.flatMap(({ step }) => [step, ...(step.type === "branch" ? [...walk(step.yes), ...walk(step.no)] : step.type === "split" ? [...walk(step.a), ...walk(step.b)] : [])]);
}

const newEmailStep = (): AutomationStep => ({ type: "email", subject: "", html: DEFAULT_EMAIL_HTML });
const newWaitStep = (): AutomationStep => ({ type: "wait", hours: 24 });
const newPushStep = (): AutomationStep => ({ type: "push", title: "", body: "", url: "", in_app: true });
const newExitStep = (): AutomationStep => ({ type: "exit_if", condition: "push_opened" });
const newWaitUntilStep = (): AutomationStep => ({ type: "wait_until", hours: 24, direction: "before" });

const STEP_META: Record<UIStep["type"], { label: string; icon: LucideIcon; tone: string }> = {
  email: { label: t("Envoyer un email", "Send an email"), icon: Mail, tone: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" },
  push: { label: t("Notification push", "Push notification"), icon: BellRing, tone: "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300" },
  wait: { label: t("Attendre", "Wait"), icon: Clock, tone: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300" },
  wait_until: { label: t("Attendre la date", "Wait for the date"), icon: CalendarClock, tone: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300" },
  send_window: { label: t("Créneau d'envoi", "Sending window"), icon: Clock, tone: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300" },
  exit_if: { label: t("Condition d'arrêt", "Exit condition"), icon: CircleStop, tone: "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300" },
  branch: { label: t("Si / sinon", "If / else"), icon: GitBranch, tone: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" },
  split: { label: t("Test A/B", "A/B test"), icon: Split, tone: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" },
  tag: { label: t("Tag", "Tag"), icon: Tag, tone: "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-300" },
  notify: { label: t("Alerter mon équipe", "Alert my team"), icon: Megaphone, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" },
  webhook: { label: t("Webhook (Zapier, Make…)", "Webhook (Zapier, Make…)"), icon: Webhook, tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

interface Ctx {
  trigger: AutomationTrigger;
  brand?: string;
  segments: Segment[];
  tags: string[];
}

function WaitUntilStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "wait_until" }>; onChange: (s: AutomationStep) => void }) {
  const [unit, setUnit] = useState<"hours" | "days">(() => (step.hours >= 24 && step.hours % 24 === 0 ? "days" : "hours"));
  const display = unit === "days" ? step.hours / 24 : step.hours;
  return (
    <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("Attendre jusqu'à", "Wait until")}</span>
        <Input
          type="number"
          min={0}
          className="h-9 w-20"
          value={Number.isFinite(display) ? display : ""}
          onChange={(e) => {
            const n = Math.max(0, Number(e.target.value));
            onChange({ ...step, hours: unit === "days" ? n * 24 : n });
          }}
          aria-label={t("Durée", "Duration")}
        />
        <Select
          className="h-9 w-auto"
          value={unit}
          onChange={(e) => {
            const u = e.target.value as "hours" | "days";
            setUnit(u);
            onChange({ ...step, hours: u === "days" ? Math.max(1, Math.round(step.hours / 24)) * 24 : step.hours });
          }}
          aria-label={t("Unité", "Unit")}
        >
          <option value="hours">{t("heure(s)", "hour(s)")}</option>
          <option value="days">{t("jour(s)", "day(s)")}</option>
        </Select>
        <Select className="h-9 w-auto" value={step.direction} onChange={(e) => onChange({ ...step, direction: e.target.value as "before" | "after" })} aria-label={t("Avant ou après", "Before or after")}>
          <option value="before">{t("avant", "before")}</option>
          <option value="after">{t("après", "after")}</option>
        </Select>
        <span>{t("la date de l'événement", "the event's date")}</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t(
          "La date est celle que votre site envoie (champ date). Si ce moment est déjà passé, l'étape suivante part tout de suite. Si la date change, le rappel suit.",
          "The date is the one your site sends (date field). If that moment has already passed, the next step goes out right away. If the date changes, the reminder follows.",
        )}
      </p>
    </div>
  );
}

function ExitStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "exit_if" }>; onChange: (s: AutomationStep) => void }) {
  return (
    <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("Arrêter le parcours si le client", "Stop the journey if the customer")}</span>
        <Select
          className="h-9 w-auto"
          value={step.condition}
          onChange={(e) => onChange({ type: "exit_if", condition: e.target.value as ExitCondition })}
          aria-label={t("Condition d'arrêt", "Exit condition")}
        >
          {(Object.keys(EXIT_CONDITIONS) as ExitCondition[]).map((c) => (
            <option key={c} value={c}>
              {EXIT_CONDITIONS[c]}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Placez-la après une attente : les clients qui ont déjà réagi ne reçoivent pas les relances suivantes.", "Place it after a wait: customers who already engaged won't get the follow-ups.")}
      </p>
    </div>
  );
}

type PushStep = Extract<AutomationStep, { type: "push" }>;

function PushStepEditor({ step, onChange }: { step: PushStep; onChange: (s: PushStep) => void }) {
  return (
    <div className="space-y-3">
      <Field label={t("Titre", "Title")}>
        <Input maxLength={120} value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} placeholder={t("{{first_name|Bonjour}}, votre panier vous attend", "{{first_name|Hi}}, your cart is waiting")} />
      </Field>
      <Field label={t("Texte", "Text")}>
        <Textarea rows={2} maxLength={500} value={step.body} onChange={(e) => onChange({ ...step, body: e.target.value })} placeholder={t("Finalisez votre commande, la livraison est offerte.", "Complete your order, shipping is on us.")} />
      </Field>
      <Field label={t("Lien à l'ouverture (optionnel)", "Link on open (optional)")} hint={t("Envoyée sur tous les appareils du contact enregistrés dans votre application.", "Sent to every device the contact has registered in your app.")}>
        <Input value={step.url ?? ""} onChange={(e) => onChange({ ...step, url: e.target.value })} placeholder={t("https://… ou monapp://panier", "https://… or myapp://cart")} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" className="size-4 accent-brand-500" checked={step.in_app !== false} onChange={(e) => onChange({ ...step, in_app: e.target.checked })} />
        {t("Garder aussi la notification dans l'app (centre de notifications)", "Also keep the notification in the app (notification center)")}
      </label>
    </div>
  );
}

function WaitStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "wait" }>; onChange: (s: AutomationStep) => void }) {
  const [unit, setUnit] = useState<"hours" | "days">(() => (step.hours >= 24 && step.hours % 24 === 0 ? "days" : "hours"));
  const display = unit === "days" ? step.hours / 24 : step.hours;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span>{t("Attendre", "Wait")}</span>
      <Input
        type="number"
        min={1}
        className="h-9 w-24"
        value={Number.isFinite(display) ? display : ""}
        onChange={(e) => {
          const n = Math.max(0, Number(e.target.value));
          onChange({ type: "wait", hours: unit === "days" ? n * 24 : n });
        }}
        aria-label={t("Durée", "Duration")}
      />
      <Select
        className="h-9 w-auto"
        value={unit}
        onChange={(e) => {
          const u = e.target.value as "hours" | "days";
          setUnit(u);
          onChange({ type: "wait", hours: u === "days" ? Math.max(1, Math.round(step.hours / 24)) * 24 : step.hours });
        }}
        aria-label={t("Unité", "Unit")}
      >
        <option value="hours">{t("heure(s)", "hour(s)")}</option>
        <option value="days">{t("jour(s)", "day(s)")}</option>
      </Select>
      <span>{t("avant l'étape suivante", "before the next step")}</span>
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
      <Field label={t("Objet", "Subject")}>
        <Input value={step.subject} onChange={(e) => onChange({ ...step, subject: e.target.value })} placeholder={t("Bienvenue {{first_name}} !", "Welcome {{first_name}}!")} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={Sparkles} onClick={() => setShowAi((v) => !v)}>
          {showAi ? t("Masquer les modèles", "Hide templates") : t("Partir d'un modèle", "Start from a template")}
        </Button>
        <Button variant="secondary" size="sm" icon={showPreview ? EyeOff : Eye} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? t("Voir le code", "View code") : t("Aperçu", "Preview")}
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
          aria-label={t("HTML de l'email", "Email HTML")}
        />
      )}
    </div>
  );
}

const DAY_LABELS = [t("Lun", "Mon"), t("Mar", "Tue"), t("Mer", "Wed"), t("Jeu", "Thu"), t("Ven", "Fri"), t("Sam", "Sat"), t("Dim", "Sun")];

function SendWindowEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "send_window" }>; onChange: (s: AutomationStep) => void }) {
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
      <div className="flex flex-wrap gap-1.5">
        {DAY_LABELS.map((label, i) => {
          const d = i + 1;
          const on = step.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ ...step, days: on ? step.days.filter((x) => x !== d) : [...step.days, d].sort() })}
              className={cx("rounded-full px-3 py-1.5 text-xs font-semibold transition", on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("entre", "between")}</span>
        <Select className="h-9 w-auto" value={step.start_hour} onChange={(e) => onChange({ ...step, start_hour: Number(e.target.value) })} aria-label={t("De", "From")}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h} h`}</option>)}
        </Select>
        <span>{t("et", "and")}</span>
        <Select className="h-9 w-auto" value={step.end_hour} onChange={(e) => onChange({ ...step, end_hour: Number(e.target.value) })} aria-label={t("À", "To")}>
          {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{`${h} h`}</option>)}
        </Select>
        <span>{t("(heure de Paris)", "(Paris time)")}</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t("En dehors de ce créneau, le parcours attend le prochain : pas d'email à 3 h du matin ni le dimanche si vous le décochez.", "Outside this window, the journey waits for the next one: no email at 3 am, nor on Sunday if you untick it.")}</p>
    </div>
  );
}

function TagStepEditor({ step, onChange, tags }: { step: Extract<AutomationStep, { type: "tag" }>; onChange: (s: AutomationStep) => void; tags: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <Select className="h-9 w-auto" value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value as "add" | "remove" })} aria-label={t("Action", "Action")}>
        <option value="add">{t("Ajouter le tag", "Add the tag")}</option>
        <option value="remove">{t("Retirer le tag", "Remove the tag")}</option>
      </Select>
      <Input className="h-9 w-48" list="step-tag-options" value={step.tag} onChange={(e) => onChange({ ...step, tag: e.target.value })} placeholder={t("ex : client_fidele", "e.g. loyal")} />
      <datalist id="step-tag-options">{tags.map((tg) => <option key={tg} value={tg} />)}</datalist>
      {step.action === "add" && <p className="w-full text-xs text-slate-500">{t("Ajouter un tag lance aussi les automatisations « Tag ajouté » correspondantes.", "Adding a tag also starts the matching “Tag added” automations.")}</p>}
    </div>
  );
}

function NotifyStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "notify" }>; onChange: (s: AutomationStep) => void }) {
  return (
    <div className="space-y-3">
      <Field label={t("Destinataires", "Recipients")} hint={t("Vide = l'adresse du compte. Plusieurs adresses : séparez-les par des virgules.", "Empty = the account address. Several addresses: separate with commas.")}>
        <Input value={step.to ?? ""} onChange={(e) => onChange({ ...step, to: e.target.value })} placeholder="equipe@maboutique.fr" />
      </Field>
      <Field label={t("Objet", "Subject")}>
        <Input value={step.subject} onChange={(e) => onChange({ ...step, subject: e.target.value })} placeholder={t("Nouvelle réservation de {{first_name}}", "New booking from {{first_name}}")} />
      </Field>
      <Field label={t("Message (optionnel)", "Message (optional)")} hint={t("Les infos du client et de l'événement sont ajoutées automatiquement.", "Customer and event details are added automatically.")}>
        <Textarea rows={2} value={step.message ?? ""} onChange={(e) => onChange({ ...step, message: e.target.value })} placeholder={t("{{event.couverts}} couverts le {{event.date}}", "{{event.guests}} guests on {{event.date}}")} />
      </Field>
    </div>
  );
}

function WebhookStepEditor({ step, onChange }: { step: Extract<AutomationStep, { type: "webhook" }>; onChange: (s: AutomationStep) => void }) {
  return (
    <div className="space-y-2">
      <Field label={t("Adresse du webhook", "Webhook URL")}>
        <Input value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} placeholder="https://hooks.zapier.com/hooks/catch/…" />
      </Field>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t(
          "Pingsell envoie le client (email, nom, tags, total dépensé…) et l'événement en JSON. Avec Zapier ou Make, vous le branchez à 7 000 applis : Google Sheets, Slack, votre CRM, un SMS…",
          "Pingsell sends the customer (email, name, tags, total spent…) and the event as JSON. With Zapier or Make, plug it into 7,000 apps: Google Sheets, Slack, your CRM, an SMS…",
        )}
      </p>
    </div>
  );
}

const CONDITION_LABELS: Record<BranchCondition["type"], string> = {
  email_opened: t("a ouvert un email de ce parcours", "opened an email from this journey"),
  email_clicked: t("a cliqué dans un email de ce parcours", "clicked in an email from this journey"),
  push_opened: t("a ouvert une notification de ce parcours", "opened a notification from this journey"),
  ordered: t("a commandé depuis le début du parcours", "ordered since the journey started"),
  has_tag: t("a le tag…", "has the tag…"),
  in_segment: t("fait partie du segment…", "is in the segment…"),
  has_app: t("a votre app (notifications actives)", "has your app (notifications on)"),
  total_spent: t("a dépensé au moins… €", "spent at least… €"),
  orders_count: t("a passé au moins… commandes", "placed at least… orders"),
  event_field: t("champ de l'événement égal à…", "event field equals…"),
};

function defaultCondition(type: BranchCondition["type"]): BranchCondition {
  if (type === "has_tag") return { type, tag: "" };
  if (type === "in_segment") return { type, segment_id: "" };
  if (type === "total_spent") return { type, min: 100 };
  if (type === "orders_count") return { type, min: 2 };
  if (type === "event_field") return { type, field: "", value: "" };
  return { type } as BranchCondition;
}

function ConditionEditor({ value, onChange, ctx }: { value: BranchCondition; onChange: (c: BranchCondition) => void; ctx: Ctx }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <span className="font-medium text-slate-900 dark:text-white">{t("Si le client", "If the customer")}</span>
      <Select className="h-9 w-auto" value={value.type} onChange={(e) => onChange(defaultCondition(e.target.value as BranchCondition["type"]))} aria-label={t("Condition", "Condition")}>
        {(Object.keys(CONDITION_LABELS) as BranchCondition["type"][]).map((c) => (
          <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
        ))}
      </Select>
      {value.type === "has_tag" && (
        <>
          <Input className="h-9 w-40" list="cond-tag-options" value={value.tag} onChange={(e) => onChange({ ...value, tag: e.target.value })} placeholder="vip" />
          <datalist id="cond-tag-options">{ctx.tags.map((tg) => <option key={tg} value={tg} />)}</datalist>
        </>
      )}
      {value.type === "in_segment" && (
        <Select className="h-9 w-auto" value={value.segment_id} onChange={(e) => onChange({ ...value, segment_id: e.target.value })} aria-label={t("Segment", "Segment")}>
          <option value="">{t("Choisir…", "Choose…")}</option>
          {ctx.segments.map((sg) => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
        </Select>
      )}
      {(value.type === "total_spent" || value.type === "orders_count") && (
        <Input type="number" min={0} className="h-9 w-24" value={value.min} onChange={(e) => onChange({ ...value, min: Math.max(0, Number(e.target.value)) })} />
      )}
      {value.type === "event_field" && (
        <>
          <Input className="h-9 w-36" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })} placeholder={t("champ, ex : formule", "field, e.g. plan")} />
          <span>=</span>
          <Input className="h-9 w-36" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} placeholder={t("valeur, ex : premium", "value, e.g. premium")} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ add-step menu */

function InsertStep({ onInsert, ctx }: { onInsert: (s: AutomationStep) => void; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const pick = (s: AutomationStep) => {
    onInsert(s);
    setOpen(false);
  };
  const groups: Array<{ title: string; items: Array<{ label: string; icon: LucideIcon; make: () => AutomationStep }> }> = [
    {
      title: t("Envoyer", "Send"),
      items: [
        { label: t("Email", "Email"), icon: Mail, make: newEmailStep },
        { label: t("Push", "Push"), icon: BellRing, make: newPushStep },
        { label: t("Alerter mon équipe", "Alert my team"), icon: Megaphone, make: () => ({ type: "notify", subject: t("Nouveau : {{first_name}}", "New: {{first_name}}") }) },
      ],
    },
    {
      title: t("Attendre", "Wait"),
      items: [
        { label: t("Un délai", "A delay"), icon: Clock, make: newWaitStep },
        ...(ctx.trigger === "event" ? [{ label: t("Avant / après la date", "Before / after the date"), icon: CalendarClock, make: newWaitUntilStep }] : []),
        { label: t("Un créneau (jours, heures)", "A window (days, hours)"), icon: Clock, make: () => ({ type: "send_window", days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 19 }) as AutomationStep },
      ],
    },
    {
      title: t("Logique", "Logic"),
      items: [
        { label: t("Si / sinon", "If / else"), icon: GitBranch, make: () => ({ type: "branch", condition: { type: "email_opened" }, yes: [], no: [] }) as AutomationStep },
        { label: t("Test A/B", "A/B test"), icon: Split, make: () => ({ type: "split", percent: 50, a: [newEmailStep()], b: [newEmailStep()] }) as AutomationStep },
        { label: t("Arrêter si…", "Stop if…"), icon: CircleStop, make: newExitStep },
      ],
    },
    {
      title: t("Agir", "Act"),
      items: [
        { label: t("Ajouter / retirer un tag", "Add / remove a tag"), icon: Tag, make: () => ({ type: "tag", action: "add", tag: "" }) as AutomationStep },
        { label: t("Webhook (Zapier, Make…)", "Webhook (Zapier, Make…)"), icon: Webhook, make: () => ({ type: "webhook", url: "" }) as AutomationStep },
      ],
    },
  ];
  if (!open) {
    return (
      <div className="flex justify-center py-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex size-8 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:text-brand-600 hover:ring-brand-400 dark:bg-slate-900 dark:ring-slate-700"
          aria-label={t("Ajouter une étape", "Add a step")}
        >
          <Plus className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative my-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
      <button type="button" onClick={() => setOpen(false)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-700" aria-label={t("Fermer", "Close")}>
        <X className="size-4" />
      </button>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{g.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((it) => (
                <Button key={it.label} variant="secondary" size="sm" icon={it.icon} onClick={() => pick(it.make())}>
                  {it.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Connector() {
  return <div className="mx-auto h-5 w-px bg-slate-300 dark:bg-slate-700" />;
}

/* ------------------------------------------------------------------ recursive step list */

function StepList({ items, onChange, ctx, depth = 0 }: { items: KeyedStep[]; onChange: (next: KeyedStep[]) => void; ctx: Ctx; depth?: number }) {
  const update = (key: string, step: UIStep) => onChange(items.map((s) => (s.key === key ? { ...s, step } : s)));
  const remove = (key: string) => onChange(items.filter((s) => s.key !== key));
  const insertAt = (index: number, step: AutomationStep) => onChange([...items.slice(0, index), keyed(step), ...items.slice(index)]);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <>
      <InsertStep onInsert={(s) => insertAt(0, s)} ctx={ctx} />
      {items.map(({ key, step }, index) => (
        <div key={key}>
          <Connector />
          <StepCard
            step={step}
            title={`${depth === 0 ? `${t("Étape", "Step")} ${index + 1} · ` : ""}${STEP_META[step.type].label}`}
            onChange={(s) => update(key, s)}
            onRemove={() => remove(key)}
            onUp={index > 0 ? () => move(index, -1) : undefined}
            onDown={index < items.length - 1 ? () => move(index, 1) : undefined}
            ctx={ctx}
            depth={depth}
          />
          <Connector />
          <InsertStep onInsert={(s) => insertAt(index + 1, s)} ctx={ctx} />
        </div>
      ))}
    </>
  );
}

function Path({ title, tone, children }: { title: ReactNode; tone: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
      <p className={cx("mb-1 text-center text-xs font-bold tracking-wide uppercase", tone)}>{title}</p>
      {children}
    </div>
  );
}

function StepCard({
  step,
  title,
  onChange,
  onRemove,
  onUp,
  onDown,
  ctx,
  depth,
}: {
  step: UIStep;
  title: string;
  onChange: (s: UIStep) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
  ctx: Ctx;
  depth: number;
}) {
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  // Leaf editors only ever produce leaf steps, which are valid UI steps as they are.
  const setLeaf = (s: AutomationStep) => onChange(s as UIStep);
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.tone)}>
          <Icon className="size-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="sm" icon={ArrowUp} onClick={onUp} disabled={!onUp} aria-label={t("Monter", "Move up")} />
          <Button variant="ghost" size="sm" icon={ArrowDown} onClick={onDown} disabled={!onDown} aria-label={t("Descendre", "Move down")} />
          <Button variant="ghost" size="sm" icon={Trash2} onClick={onRemove} aria-label={t("Supprimer l'étape", "Delete step")} />
        </div>
      </div>
      {step.type === "branch" ? (
        <div className="space-y-4">
          <ConditionEditor value={step.condition} onChange={(condition) => onChange({ ...step, condition })} ctx={ctx} />
          <div className="grid gap-3 lg:grid-cols-2">
            <Path title={t("Oui", "Yes")} tone="text-emerald-600">
              <StepList items={step.yes} onChange={(yes) => onChange({ ...step, yes })} ctx={ctx} depth={depth + 1} />
            </Path>
            <Path title={t("Non", "No")} tone="text-rose-600">
              <StepList items={step.no} onChange={(no) => onChange({ ...step, no })} ctx={ctx} depth={depth + 1} />
            </Path>
          </div>
          <p className="text-xs text-slate-500">{t("Après la branche, le parcours continue avec l'étape suivante. Une branche vide = ne rien faire.", "After the branch, the journey goes on with the next step. An empty path = do nothing.")}</p>
        </div>
      ) : step.type === "split" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span>{t("Version A pour", "Version A for")}</span>
            <Input type="number" min={1} max={99} className="h-9 w-20" value={step.percent} onChange={(e) => onChange({ ...step, percent: Math.min(99, Math.max(1, Number(e.target.value))) })} />
            <span>{t(`% des clients, version B pour les ${100 - step.percent} % restants.`, `% of customers, version B for the other ${100 - step.percent}%.`)}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Path title={`A · ${step.percent} %`} tone="text-brand-600">
              <StepList items={step.a} onChange={(a) => onChange({ ...step, a })} ctx={ctx} depth={depth + 1} />
            </Path>
            <Path title={`B · ${100 - step.percent} %`} tone="text-violet-600">
              <StepList items={step.b} onChange={(b) => onChange({ ...step, b })} ctx={ctx} depth={depth + 1} />
            </Path>
          </div>
          <p className="text-xs text-slate-500">{t("Chaque client reste toujours dans la même version. Comparez les ouvertures et les ventes dans Statistiques.", "Each customer always stays in the same version. Compare opens and sales in Statistics.")}</p>
        </div>
      ) : step.type === "wait_until" ? (
        <WaitUntilStepEditor step={step} onChange={setLeaf} />
      ) : step.type === "wait" ? (
        <WaitStepEditor step={step} onChange={setLeaf} />
      ) : step.type === "send_window" ? (
        <SendWindowEditor step={step} onChange={setLeaf} />
      ) : step.type === "push" ? (
        <PushStepEditor step={step} onChange={setLeaf} />
      ) : step.type === "exit_if" ? (
        <ExitStepEditor step={step} onChange={setLeaf} />
      ) : step.type === "tag" ? (
        <TagStepEditor step={step} onChange={setLeaf} tags={ctx.tags} />
      ) : step.type === "notify" ? (
        <NotifyStepEditor step={step} onChange={setLeaf} />
      ) : step.type === "webhook" ? (
        <WebhookStepEditor step={step} onChange={setLeaf} />
      ) : (
        <EmailStepEditor step={step} onChange={setLeaf} brand={ctx.brand} />
      )}
    </Card>
  );
}

export function AutomationEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const recipeId = new URLSearchParams(window.location.search).get("modele");
  const recipe = isNew && recipeId ? RECIPES.find((rc) => rc.id === recipeId) : undefined;
  // ?evenement=reservation (from Intégrations › Site sur mesure): start on that site event.
  const presetEvent = isNew && !recipe ? eventSlug(new URLSearchParams(window.location.search).get("evenement") ?? "") : "";
  // ?declencheur=site_action&action=signup&site=<host>&form=<form_key> (from Intégrations › Vos sites).
  const presetSite = isNew && !recipe ? sitePreset(new URLSearchParams(window.location.search)) : null;
  const siteRecipe = presetSite?.action === "signup" ? RECIPES.find((rc) => rc.id === "compte-bienvenue") : undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const { account } = useAuth();
  const existing = useAsync(() => (id ? api.automations.get(id) : Promise.resolve(null)), [id]);
  const tags = useAsync(() => api.tags(), []);
  const eventNames = useAsync(() => api.automations.eventNames().catch(() => null), []);
  const segments = useAsync(() => api.segments.list().catch(() => [] as Segment[]), []);
  const sites = useSites();
  const [eventName, setEventName] = useState(typeof recipe?.trigger_config?.event === "string" ? recipe.trigger_config.event : presetEvent);
  const [cfg, setCfg] = useState<Record<string, unknown>>(recipe?.trigger_config ?? presetSite ?? {});

  const [name, setName] = useState(
    recipe?.name ??
      (presetSite
        ? (siteRecipe?.name ?? t(`Après ${SITE_ACTIONS[presetSite.action].short} sur votre site`, `After ${SITE_ACTIONS[presetSite.action].short} on your site`))
        : presetEvent
          ? t(`Quand votre site envoie «\u00a0${presetEvent}\u00a0»`, `When your site sends “${presetEvent}”`)
          : ""),
  );
  const [trigger, setTrigger] = useState<AutomationTrigger>(recipe?.trigger ?? (presetSite ? "site_action" : presetEvent ? "event" : "contact_created"));
  const [tag, setTag] = useState(typeof recipe?.trigger_config?.tag === "string" ? recipe.trigger_config.tag : "");
  const [steps, setSteps] = useState<KeyedStep[]>(() =>
    (recipe?.steps ??
      siteRecipe?.steps ??
      (presetEvent || presetSite
        ? [{ type: "email", subject: t("Merci {{first_name|}}\u00a0!", "Thank you {{first_name|}}!"), html: DEFAULT_EMAIL_HTML }]
        : [
            { type: "email", subject: t("Bienvenue {{first_name}} !", "Welcome {{first_name}}!"), html: DEFAULT_EMAIL_HTML },
            { type: "wait", hours: 72 },
            newEmailStep(),
          ])
    ).map(keyed),
  );
  const [status, setStatus] = useState<"active" | "paused">("paused");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    setName(a.name);
    setTrigger(a.trigger);
    setTag(typeof a.trigger_config?.tag === "string" ? a.trigger_config.tag : "");
    setEventName(typeof a.trigger_config?.event === "string" ? a.trigger_config.event : "");
    setCfg(a.trigger_config ?? {});
    setSteps((a.steps ?? []).map(keyed));
    setStatus(a.status);
  }, [existing.data]);

  function validate(): string | null {
    if (!name.trim()) return t("Donnez un nom à l'automatisation", "Give your automation a name");
    if (trigger === "tag_added" && !tag.trim()) return t("Indiquez le tag qui déclenche l'automatisation", "Enter the tag that triggers the automation");
    if (trigger === "event" && !eventSlug(eventName)) return t("Indiquez le nom de l'événement (ex : reservation)", "Enter the event name (e.g. booking)");
    if (trigger !== "event" && steps.some((s) => s.step.type === "wait_until"))
      return t("L'étape « avant / après la date » ne marche qu'avec le déclencheur « Événement de votre site »", "The “before / after the date” step only works with the “Event from your site” trigger");
    if (trigger === "segment_entered" && !cfg.segment_id) return t("Choisissez le segment", "Choose the segment");
    if (trigger === "site_action" && !SITE_ACTION_KINDS.includes(cfg.action as SiteActionKind)) return t("Choisissez l'action sur votre site", "Choose the action on your site");
    const all = walk(steps);
    if (!all.some((st) => ["email", "push", "notify", "webhook", "tag"].includes(st.type))) return t("Ajoutez au moins une action (email, push, alerte, tag ou webhook)", "Add at least one action (email, push, alert, tag or webhook)");
    for (const step of all) {
      if (step.type === "email" && !step.subject.trim()) return t("Chaque email doit avoir un objet", "Every email needs a subject");
      if (step.type === "push" && (!step.title.trim() || !step.body.trim())) return t("Chaque notification push doit avoir un titre et un texte", "Every push notification needs a title and text");
      if (step.type === "wait" && !(step.hours > 0)) return t("Chaque attente doit durer au moins 1 heure", "Every wait must last at least 1 hour");
      if (step.type === "tag" && !step.tag.trim()) return t("Indiquez le tag à ajouter ou retirer", "Enter the tag to add or remove");
      if (step.type === "webhook" && !/^https:\/\/.+/.test(step.url.trim())) return t("L'adresse du webhook doit commencer par https://", "The webhook URL must start with https://");
      if (step.type === "notify" && !step.subject.trim()) return t("Chaque alerte équipe doit avoir un objet", "Every team alert needs a subject");
      if (step.type === "send_window" && (!step.days.length || step.end_hour <= step.start_hour)) return t("Le créneau d'envoi doit avoir au moins un jour et une heure de fin après celle de début", "The sending window needs at least one day and an end hour after the start");
      if (step.type === "branch" && step.condition.type === "has_tag" && !step.condition.tag.trim()) return t("Indiquez le tag de la condition « Si / sinon »", "Enter the tag of the “If / else” condition");
      if (step.type === "branch" && step.condition.type === "in_segment" && !step.condition.segment_id) return t("Choisissez le segment de la condition « Si / sinon »", "Choose the segment of the “If / else” condition");
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
    const host = typeof cfg.host === "string" && cfg.host.trim() ? { host: cfg.host.trim() } : {};
    const input = {
      name: name.trim(),
      trigger,
      trigger_config:
        trigger === "tag_added"
          ? { tag: tag.trim().toLowerCase() }
          : trigger === "event"
            ? { event: eventSlug(eventName) }
            : trigger === "site_action"
              ? siteActionConfig(cfg, sites.data ?? [])
            : trigger === "email_clicked" || trigger === "page_visited"
              ? { ...(typeof cfg.url_contains === "string" && cfg.url_contains.trim() ? { url_contains: cfg.url_contains.trim() } : {}), ...(trigger === "page_visited" ? host : {}) }
              : trigger === "product_viewed"
                ? { hours: Number(cfg.hours ?? 2), ...host }
              : trigger === "date_anniversary"
                ? { field: typeof cfg.field === "string" && cfg.field.trim() ? cfg.field.trim() : "birthday", days_before: Number(cfg.days_before ?? 0) }
                : trigger === "inactive"
                  ? { days: Number(cfg.days ?? 90) }
                  : trigger === "segment_entered"
                    ? { segment_id: cfg.segment_id }
                    : {},
      steps: plain(steps),
    };
    try {
      if (isNew) {
        // Created paused: nothing goes out before the merchant has reviewed the copy and clicked « Activer ».
        const created = await api.automations.create({ ...input, status: "paused" });
        toast.success(t("Automatisation créée", "Automation created"), t("Activez-la quand vous êtes prêt.", "Turn it on when you're ready."));
        navigate(`/automatisations/${created.id}`, { replace: true });
      } else {
        await api.automations.update(id, input);
        toast.success(t("Automatisation enregistrée", "Automation saved"));
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
      toast.success(status === "active" ? t("Automatisation en pause", "Automation paused") : t("Automatisation activée", "Automation activated"));
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
            <ArrowLeft className="size-4" /> {t("Automatisations", "Automations")}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name || (isNew ? t("Nouvelle automatisation", "New automation") : t("Automatisation", "Automation"))}
            {!isNew && (
              <Badge tone={status === "active" ? "green" : "slate"} dot>
                {status === "active" ? t("Active", "Active") : t("En pause", "Paused")}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {!isNew && (
              <Button variant="secondary" icon={status === "active" ? Pause : Play} onClick={toggleStatus} loading={toggling}>
                {status === "active" ? t("Mettre en pause", "Pause") : t("Activer", "Activate")}
              </Button>
            )}
            <Button icon={Save} onClick={save} loading={saving}>
              {t("Enregistrer", "Save")}
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-4xl">
        <Card className="p-5">
          <Field label={t("Nom", "Name")} htmlFor="auto-name">
            <Input id="auto-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ex : Série de bienvenue", "e.g. Welcome series")} />
          </Field>
        </Card>

        <Connector />

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
              <Zap className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("Déclencheur", "Trigger")}</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(TRIGGERS) as AutomationTrigger[]).map((tr) => {
              const Icon = TRIGGER_ICONS[tr];
              const active = tr === trigger;
              return (
                <button
                  key={tr}
                  type="button"
                  onClick={() => {
                    setTrigger(tr);
                    if (tr === "site_action" && !cfg.action) setCfg({ ...cfg, action: "signup" });
                  }}
                  className={cx(
                    "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition",
                    active
                      ? "bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-900/30"
                      : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50",
                  )}
                >
                  <Icon className={cx("mt-0.5 size-5 shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">{TRIGGERS[tr].label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{TRIGGERS[tr].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {trigger === "event" && (
            <div className="mt-4 space-y-3">
              <Field
                label={t("Nom de l'événement", "Event name")}
                htmlFor="auto-event"
                hint={
                  eventSlug(eventName)
                    ? t(`Votre site envoie : "event": "${eventSlug(eventName)}"`, `Your site sends: "event": "${eventSlug(eventName)}"`)
                    : t("Le nom que votre site envoie dans le champ event, par exemple reservation, rendez_vous, avis, anniversaire.", "The name your site sends in the event field, e.g. booking, appointment, review, birthday.")
                }
              >
                <Input id="auto-event" list="auto-event-options" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder={t("ex : reservation", "e.g. booking")} />
                <datalist id="auto-event-options">
                  {(eventNames.data ?? []).map((ev) => (
                    <option key={ev.name} value={ev.name} />
                  ))}
                </datalist>
              </Field>
              {(eventNames.data ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>{t("Déjà reçus de votre site :", "Already received from your site:")}</span>
                  {(eventNames.data ?? []).slice(0, 8).map((ev) => (
                    <button
                      key={ev.name}
                      type="button"
                      onClick={() => setEventName(ev.name)}
                      className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {ev.name} · {ev.count}
                    </button>
                  ))}
                </div>
              )}
              {eventNames.data && eventSlug(eventName) && !eventNames.data.some((ev) => eventSlug(ev.name) === eventSlug(eventName)) && (
                <div className="space-y-1.5">
                  <EventNeverSent event={eventSlug(eventName)} onUseTrigger={setTrigger} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <Link to="/integrations?outil=site" className="font-semibold text-brand-600">
                      {t("Voir ce que votre site envoie déjà", "See what your site already sends")}
                    </Link>
                  </p>
                </div>
              )}
              <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                {t(
                  "Dans vos messages, reprenez ce que le site envoie : {{event.date}} (écrite en toutes lettres), {{event.id}} ou n'importe quel champ, par exemple {{event.restaurant}}. Pour un rappel, ajoutez l'étape « Avant / après la date ».",
                  "In your messages, reuse what the site sends: {{event.date}} (written out in full), {{event.id}} or any field, for example {{event.restaurant}}. For a reminder, add the “Before / after the date” step.",
                )}
              </p>
            </div>
          )}
          {trigger === "email_clicked" && (
            <Field label={t("Lien contenant (optionnel)", "Link containing (optional)")} htmlFor="auto-url" className="mt-4" hint={t("Vide = n'importe quel lien de vos emails. Ex : « promo-noel » pour ne viser que cette page.", "Empty = any link in your emails. E.g. “xmas-sale” to target that page only.")}>
              <Input id="auto-url" value={String(cfg.url_contains ?? "")} onChange={(e) => setCfg({ ...cfg, url_contains: e.target.value })} placeholder="promo-noel" />
            </Field>
          )}
          {trigger === "site_action" && <SiteActionEditor cfg={cfg} setCfg={setCfg} sites={sites.data} />}
          {trigger === "page_visited" && (
            <div className="mt-4 space-y-3">
              <SiteSelect sites={sites.data} value={String(cfg.host ?? "")} onChange={(h) => setCfg({ ...cfg, host: h })} />
              <Field label={t("Adresse de la page contenant (optionnel)", "Page address containing (optional)")} htmlFor="auto-page" hint={t("Vide = n'importe quelle page. Ex : « /tarifs », « /reservation », « /contact ».", "Empty = any page. E.g. “/pricing”, “/booking”, “/contact”.")}>
                <Input id="auto-page" value={String(cfg.url_contains ?? "")} onChange={(e) => setCfg({ ...cfg, url_contains: e.target.value })} placeholder="/tarifs" />
              </Field>
              <TopPages sites={sites.data} host={String(cfg.host ?? "")} value={String(cfg.url_contains ?? "")} onPick={(path) => setCfg({ ...cfg, url_contains: path })} />
              <TrackingHint />
            </div>
          )}
          {trigger === "product_viewed" && (
            <div className="mt-4 space-y-3">
              <SiteSelect sites={sites.data} value={String(cfg.host ?? "")} onChange={(h) => setCfg({ ...cfg, host: h })} />
              <Field label={t("Sans achat depuis", "Not bought after")} htmlFor="auto-hours" hint={t("Rien ne part s'il a commandé ou rempli un panier entre-temps (la relance panier prend le relais). Une relance tous les 3 jours au plus.", "Nothing goes out if they ordered or filled a cart in the meantime (the cart reminder takes over). At most one reminder every 3 days.")}>
                <Select id="auto-hours" value={String(cfg.hours ?? 2)} onChange={(e) => setCfg({ ...cfg, hours: Number(e.target.value) })}>
                  {[1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{t(`${h} heure${h > 1 ? "s" : ""}`, `${h} hour${h > 1 ? "s" : ""}`)}</option>)}
                </Select>
              </Field>
              <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                {t(
                  "Dans vos messages : {{event.product}} (nom), {{event.url}} (lien), {{event.image}} (photo), {{event.price}} et {{event.currency}}, {{event.views}} (nombre de fois vu).",
                  "In your messages: {{event.product}} (name), {{event.url}} (link), {{event.image}} (photo), {{event.price}} and {{event.currency}}, {{event.views}} (times viewed).",
                )}
              </p>
              <TrackingHint />
            </div>
          )}
          {trigger === "date_anniversary" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t("Quelle date ?", "Which date?")} hint={t("Anniversaire : champ birthday de la fiche (format 1990-05-14 ou 14/05/1990), envoyé par votre site ou un import.", "Birthday: the record's birthday field (1990-05-14 or 14/05/1990), sent by your site or an import.")}>
                <Select value={["birthday", "created_at"].includes(String(cfg.field ?? "birthday")) ? String(cfg.field ?? "birthday") : "custom"} onChange={(e) => setCfg({ ...cfg, field: e.target.value === "custom" ? "" : e.target.value })}>
                  <option value="birthday">{t("Anniversaire du client", "Customer's birthday")}</option>
                  <option value="created_at">{t("Date d'inscription (chaque année)", "Sign-up date (every year)")}</option>
                  <option value="custom">{t("Autre champ de la fiche…", "Other record field…")}</option>
                </Select>
                {!["birthday", "created_at"].includes(String(cfg.field ?? "birthday")) && (
                  <Input className="mt-2" value={String(cfg.field ?? "")} onChange={(e) => setCfg({ ...cfg, field: e.target.value })} placeholder={t("ex : date_adhesion", "e.g. membership_date")} />
                )}
              </Field>
              <Field label={t("Quand ?", "When?")} hint={t("Dans vos messages : {{event.years}} = l'âge ou le nombre d'années.", "In your messages: {{event.years}} = age or number of years.")}>
                <Select value={String(cfg.days_before ?? 0)} onChange={(e) => setCfg({ ...cfg, days_before: Number(e.target.value) })}>
                  <option value="0">{t("Le jour J", "On the day")}</option>
                  {[1, 2, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{t(`${d} jour${d > 1 ? "s" : ""} avant`, `${d} day${d > 1 ? "s" : ""} before`)}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {trigger === "inactive" && (
            <Field label={t("Sans commande depuis", "No order for")} htmlFor="auto-days" className="mt-4" hint={t("Concerne les clients qui ont déjà commandé. Une seule relance par période d'inactivité.", "Applies to customers who have ordered before. One reminder per inactivity period.")}>
              <Select id="auto-days" value={String(cfg.days ?? 90)} onChange={(e) => setCfg({ ...cfg, days: Number(e.target.value) })}>
                {[30, 45, 60, 90, 120, 180, 365].map((d) => <option key={d} value={d}>{t(`${d} jours`, `${d} days`)}</option>)}
              </Select>
            </Field>
          )}
          {trigger === "segment_entered" && (
            <Field label={t("Segment", "Segment")} htmlFor="auto-seg" className="mt-4" hint={t("Démarre pour chaque client qui rejoint le segment après l'activation (vérifié toutes les 5 minutes).", "Starts for every customer who joins the segment after activation (checked every 5 minutes).")}>
              <Select id="auto-seg" value={String(cfg.segment_id ?? "")} onChange={(e) => setCfg({ ...cfg, segment_id: e.target.value })}>
                <option value="">{t("Choisir un segment…", "Choose a segment…")}</option>
                {(segments.data ?? []).map((sg) => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
              </Select>
              {(segments.data ?? []).length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {t("Aucun segment pour l'instant. ", "No segment yet. ")}
                  <Link to="/segments" className="font-semibold text-brand-600">{t("Créer un segment", "Create a segment")}</Link>
                </p>
              )}
            </Field>
          )}
          {trigger === "tag_added" && (
            <Field label={t("Tag déclencheur", "Trigger tag")} htmlFor="auto-tag" className="mt-4" hint={t("L'automatisation démarre quand ce tag est ajouté à un contact.", "The automation starts when this tag is added to a contact.")}>
              <Input id="auto-tag" list="auto-tag-options" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t("ex : vip", "e.g. vip")} />
              <datalist id="auto-tag-options">
                {(tags.data ?? []).map((tg) => (
                  <option key={tg.tag} value={tg.tag} />
                ))}
              </datalist>
            </Field>
          )}
        </Card>

        <Connector />
        <StepList items={steps} onChange={setSteps} ctx={{ trigger, brand: account?.name, segments: segments.data ?? [], tags: (tags.data ?? []).map((tg) => tg.tag) }} />

        <Connector />
        <div className="flex flex-col items-center gap-2 pb-8 text-sm text-slate-500 dark:text-slate-400">
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Flag className="size-4" />
          </span>
          {t("Fin du parcours", "End of journey")}
        </div>
        {steps.length === 0 && (
          <p className="pb-6 text-center text-sm text-slate-500">
            <Plus className="mr-1 inline size-4" />
            {t("Ajoutez une première étape ci-dessus.", "Add a first step above.")}
          </p>
        )}
      </div>
    </>
  );
}

/** Both site triggers need the one-line script on the site. */
function TrackingHint() {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {t("Il faut le script Pingsell sur votre site (une ligne à coller). ", "Requires the Pingsell script on your site (one line to paste). ")}
      <Link to="/integrations?outil=suivi" className="font-semibold text-brand-600">{t("Voir comment", "See how")}</Link>
    </p>
  );
}

/* ------------------------------------------------------------------ « Une action sur votre site » */

function sitePreset(p: URLSearchParams): { action: SiteActionKind; host?: string; form?: string } | null {
  if (p.get("declencheur") !== "site_action") return null;
  const a = p.get("action") as SiteActionKind | null;
  const host = p.get("site")?.trim();
  const form = p.get("form")?.trim();
  return { action: a && SITE_ACTION_KINDS.includes(a) ? a : "signup", ...(host ? { host } : {}), ...(form ? { form } : {}) };
}

/** Detected actions of the chosen site (or every site), each with its site. */
function actionsOf(sites: WebSite[], host: string): Array<WebSiteAction & { site: WebSite }> {
  return sites
    .filter((s) => !host || s.host === host)
    .flatMap((site) => site.actions.map((a) => ({ ...a, site })))
    .sort((a, b) => b.count - a.count);
}

/** trigger_config sent to the API; form_label only keeps the list readable. */
function siteActionConfig(cfg: Record<string, unknown>, sites: WebSite[]): Record<string, unknown> {
  const host = typeof cfg.host === "string" ? cfg.host.trim() : "";
  const form = typeof cfg.form === "string" ? cfg.form.trim() : "";
  const found = form ? actionsOf(sites, host).find((a) => a.form_key === form && a.kind === cfg.action) : undefined;
  const label = found?.label ?? (typeof cfg.form_label === "string" ? cfg.form_label : "");
  return { action: cfg.action, ...(host ? { host } : {}), ...(form ? { form, ...(label ? { form_label: label } : {}) } : {}) };
}

function SiteSelect({ sites, value, onChange }: { sites: WebSite[] | undefined; value: string; onChange: (host: string) => void }) {
  if (!sites || (sites.length === 0 && !value)) return null;
  const known = sites.some((s) => s.host === value);
  return (
    <Field label={t("Sur quel site ?", "On which site?")} htmlFor="auto-site">
      <Select id="auto-site" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Tous mes sites", "All my sites")}</option>
        {sites.map((s) => (
          <option key={s.host} value={s.host}>
            {s.name ? `${s.name} (${s.host})` : s.host}
          </option>
        ))}
        {value && !known && <option value={value}>{value}</option>}
      </Select>
    </Field>
  );
}

function NothingSpotted({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {children}{" "}
      <Link to="/integrations?outil=suivi" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
        {t("Ouvrir Vos sites", "Open Your sites")}
      </Link>
    </p>
  );
}

function SiteActionEditor({ cfg, setCfg, sites }: { cfg: Record<string, unknown>; setCfg: (c: Record<string, unknown>) => void; sites: WebSite[] | undefined }) {
  const host = String(cfg.host ?? "");
  const action = (SITE_ACTION_KINDS.includes(cfg.action as SiteActionKind) ? cfg.action : "signup") as SiteActionKind;
  const form = String(cfg.form ?? "");
  const detected = actionsOf(sites ?? [], host);
  const nothingAnywhere = !!sites && sites.every((s) => s.actions.length === 0);
  const inbound = useAsync(() => api.inbound.get().catch(() => null), []);
  const tr = inbound.data?.tracking;
  const captureOff = !!tr && (!tr.enabled || tr.capture_actions === false);

  function changeSite(next: string) {
    // The precise form only stays if the new site has it.
    const keep = form && actionsOf(sites ?? [], next).some((a) => a.form_key === form && a.kind === action);
    setCfg({ ...cfg, host: next, ...(keep ? {} : { form: "", form_label: "" }) });
  }

  const option = (on: boolean) =>
    cx(
      "flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition",
      on ? "bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-900/30" : "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50",
    );

  return (
    <div className="mt-4 space-y-4">
      {captureOff && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
          {t("Le repérage des actions est désactivé\u00a0: ce déclencheur ne partira pas. ", "Action spotting is turned off: this trigger won't fire. ")}
          <Link to="/integrations?outil=suivi" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            {t("Le réactiver dans Vos sites", "Turn it back on in Your sites")}
          </Link>
        </p>
      )}
      <SiteSelect sites={sites} value={host} onChange={changeSite} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Quelle action ?", "Which action?")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SITE_ACTION_KINDS.map((kind) => {
            const Icon = SITE_ACTION_ICONS[kind];
            const on = action === kind && !form;
            const n = detected.filter((a) => a.kind === kind).reduce((sum, a) => sum + a.count, 0);
            const fem = kind === "signup" || kind === "login" || kind === "newsletter";
            return (
              <button key={kind} type="button" className={option(on)} onClick={() => setCfg({ ...cfg, action: kind, form: "", form_label: "" })}>
                <Icon className={cx("mt-0.5 size-4 shrink-0", on ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">{SITE_ACTIONS[kind].any}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {n > 0
                      ? t(`Repéré${fem ? "e" : ""} ${n.toLocaleString(LOCALE)} fois`, `Spotted ${n.toLocaleString(LOCALE)} time${n === 1 ? "" : "s"}`)
                      : t(`Pas encore repéré${fem ? "e" : ""}`, "Not spotted yet")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {detected.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            {host ? t("Ou un formulaire précis repéré sur ce site :", "Or a precise form spotted on this site:") : t("Ou un formulaire précis repéré sur vos sites :", "Or a precise form spotted on your sites:")}
          </p>
          <div className="space-y-2">
            {detected.map((a) => {
              const Icon = SITE_ACTION_ICONS[a.kind] ?? Pointer;
              const on = form === a.form_key && action === a.kind && (!host || host === a.site.host);
              return (
                <button
                  key={`${a.site.host}|${a.kind}|${a.form_key}`}
                  type="button"
                  className={option(on)}
                  onClick={() => setCfg({ ...cfg, action: a.kind, form: a.form_key, form_label: a.label ?? "", host: a.site.host })}
                >
                  <Icon className={cx("mt-0.5 size-4 shrink-0", on ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-white">
                      {SITE_ACTIONS[a.kind]?.label ?? a.kind}
                      {a.label && <span className="font-normal text-slate-600 dark:text-slate-300">{t(` · « ${a.label} »`, ` · “${a.label}”`)}</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {!host && `${siteLabel(a.site)} · `}
                      {a.path && <span className="font-mono">{a.path}</span>}
                      {a.path && " · "}
                      {timesSeen(a.count, a.last_at)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sites && (nothingAnywhere || detected.length === 0) && (
        <NothingSpotted>
          {nothingAnywhere
            ? t(
                "Pingsell n'a encore rien repéré sur vos sites. Collez la ligne Pingsell sur votre site, puis faites un essai (créez un compte de test) : l'action apparaîtra ici.",
                "Pingsell hasn't spotted anything on your sites yet. Paste the Pingsell line on your site, then try it (create a test account): the action will show up here.",
              )
            : t("Rien encore repéré sur ce site. Faites un essai (créez un compte de test) : l'action apparaîtra ici.", "Nothing spotted on this site yet. Try it (create a test account): the action will show up here.")}
        </NothingSpotted>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {action === "signup" || action === "newsletter"
          ? t("La personne est ajoutée à vos contacts si elle n'y est pas encore.", "The person is added to your contacts if they aren't already.")
          : action === "contact" || action === "form"
          ? t("La personne est ajoutée à vos contacts sans être abonnée : elle reçoit ce message (la réponse à sa demande), jamais vos campagnes.", "The person is added to your contacts without being subscribed: they get this message (the answer to their request), never your campaigns.")
          : t(
              "Ne démarre que pour une personne déjà dans vos contacts (un email inconnu est seulement compté).",
              "Only starts for someone already in your contacts (an unknown email is only counted).",
            )}
      </p>

      <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        {t(
          "Dans vos messages : {{event.site}} (le nom du site), {{event.form}} (le formulaire), {{event.page}} (la page). Une création de compte ne lance le parcours qu'une fois par client ; les autres actions, une fois par jour au plus.",
          "In your messages: {{event.site}} (the site's name), {{event.form}} (the form), {{event.page}} (the page). An account creation starts the journey only once per customer; other actions, at most once a day.",
        )}
      </p>
    </div>
  );
}

/** Most viewed pages of the chosen site (or every site): one click fills « contenant ». */
function TopPages({ sites, host, value, onPick }: { sites: WebSite[] | undefined; host: string; value: string; onPick: (path: string) => void }) {
  if (!sites) return null;
  const counts = new Map<string, number>();
  for (const s of sites) if (!host || s.host === host) for (const p of s.pages ?? []) counts.set(p.path, (counts.get(p.path) ?? 0) + p.count);
  const pages = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (pages.length === 0)
    return (
      <NothingSpotted>
        {t("Aucune page vue pour l'instant sur ce site. Dès les premières visites, les pages les plus vues apparaîtront ici.", "No page viewed on this site yet. As soon as visits come in, the most viewed pages will show up here.")}
      </NothingSpotted>
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span>{t("Les plus vues :", "Most viewed:")}</span>
      {pages.map(([path, n]) => (
        <button
          key={path}
          type="button"
          onClick={() => onPick(path)}
          className={cx(
            "max-w-full truncate rounded-full px-2.5 py-1 font-medium",
            value === path ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200",
          )}
        >
          <span className="font-mono">{path}</span> · {n.toLocaleString(LOCALE)}
        </button>
      ))}
    </div>
  );
}

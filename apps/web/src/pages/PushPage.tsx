import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Apple,
  BellRing,
  Check,
  Clock,
  Copy,
  MessageSquareQuote,
  Package,
  Repeat,
  FlaskConical,
  Image as ImageIcon,
  Inbox,
  Lock,
  ShieldCheck,
  Link2,
  RefreshCw,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { API_URL, api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cx, formatDateTime, formatNumber, formatRelative } from "../lib/format";
import type { PushAudience, PushCampaign, PushChannel, PushConfig, PushDevice, PushPrompt, PushSendMode } from "../lib/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  StatCard,
  Textarea,
} from "../components/ui/primitives";
import { ConfirmModal } from "../components/ui/Overlay";
import { useToast } from "../components/ui/Toast";

type Tab = "send" | "devices" | "setup";

const MERGE_HINT = "Variables : {{first_name}}, {{last_name}}, {{email}} — ex. {{first_name|Bonjour}}";

/** Push notifications sent to the merchant's own iOS / Android app. */
export function PushPage() {
  const config = useAsync(() => api.push.config(), []);
  const [tab, setTab] = useState<Tab>("send");
  const devices = config.data?.devices;
  const ready = !!config.data && (config.data.fcm.configured || config.data.apns.configured || config.data.expo.configured);

  return (
    <>
      <PageHeader
        title="Notifications push"
        description="Envoyez des notifications sur votre propre application iOS et Android : campagnes, étapes d'automatisation et messages de test."
        actions={
          config.data && (
            <Badge tone={config.data.mode === "live" ? "green" : "amber"} dot>
              {config.data.mode === "live" ? "Envoi réel" : "Mode test (journal)"}
            </Badge>
          )
        }
      />

      {config.error && (
        <div className="mb-6">
          <ErrorState message={config.error} onRetry={config.reload} />
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Appareils actifs" value={formatNumber(devices?.total)} icon={Smartphone} loading={config.loading} />
        <StatCard label="iOS" value={formatNumber(devices?.ios)} icon={Apple} loading={config.loading} />
        <StatCard label="Android" value={formatNumber(devices?.android)} icon={Smartphone} loading={config.loading} />
        <StatCard
          label="Liés à un contact"
          value={formatNumber(devices?.linked)}
          hint="Nécessaire pour les segments, tags et automatisations"
          icon={Link2}
          loading={config.loading}
        />
      </div>

      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: "send", label: "Envoyer", icon: Send },
          { value: "devices", label: "Appareils", icon: Smartphone },
          { value: "setup", label: "Configuration", icon: Settings2 },
        ]}
      />

      {tab === "send" && <SendTab ready={ready} onSetup={() => setTab("setup")} />}
      {tab === "devices" && <DevicesTab onChange={config.reload} />}
      {tab === "setup" &&
        (config.data ? (
          <SetupTab config={config.data} onSaved={(c) => config.setData(c)} />
        ) : (
          <Skeleton className="h-96 w-full rounded-[20px]" />
        ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Send                                                                       */
/* -------------------------------------------------------------------------- */

interface Draft {
  name: string;
  title: string;
  body: string;
  image_url: string;
  url: string;
  audience: PushAudience;
  channels: PushChannel[];
  send_mode: PushSendMode;
  resend: boolean;
  resend_after_hours: number;
  resend_title: string;
  resend_body: string;
}

const EMPTY: Draft = {
  name: "",
  title: "",
  body: "",
  image_url: "",
  url: "",
  audience: { type: "all" },
  channels: ["push", "in_app"],
  send_mode: "now",
  resend: false,
  resend_after_hours: 24,
  resend_title: "",
  resend_body: "",
};

const CHANNEL_OPTIONS: Array<{ value: PushChannel; label: string; description: string; icon: typeof Lock }> = [
  { value: "push", label: "Écran verrouillé", description: "Notification système : écran verrouillé, bannière et son, même app fermée.", icon: Lock },
  { value: "in_app", label: "Dans l'app", description: "Centre de notifications de votre app, avec badge des non-lues sur l'icône.", icon: Inbox },
];

function SendTab({ ready, onSetup }: { ready: boolean; onSetup: () => void }) {
  const toast = useToast();
  const campaigns = useAsync(() => api.push.campaigns(), []);
  const segments = useAsync(() => api.segments.list(), []);
  const tags = useAsync(() => api.tags(), []);
  const deviceList = useAsync(() => api.push.devices(1, 100).then((r) => r.data), []);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [count, setCount] = useState<number | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "in_app">("ios");
  const [sending, setSending] = useState(false);
  const [testDevice, setTestDevice] = useState("");
  const [testing, setTesting] = useState(false);
  const [toDelete, setToDelete] = useState<PushCampaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const audienceKey = JSON.stringify(draft.audience);

  useEffect(() => {
    const a = draft.audience;
    if ((a.type === "segment" && !a.segment_id) || (a.type === "tag" && !a.tag)) {
      setCount(null);
      return;
    }
    let cancelled = false;
    api.push
      .audienceCount(a)
      .then((r) => !cancelled && setCount(r.devices))
      .catch(() => !cancelled && setCount(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  useEffect(() => {
    if (!testDevice && deviceList.data?.length) setTestDevice(deviceList.data[0].id);
  }, [deviceList.data, testDevice]);

  const content = () => ({
    title: draft.title.trim(),
    body: draft.body.trim(),
    image_url: draft.image_url.trim() || null,
    url: draft.url.trim() || null,
  });

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const created = await api.push.createCampaign({ name: draft.name.trim() || draft.title.replace(/\{\{[^}]*\}\}[\s,]*/g, "").trim() || "Notification push", audience: draft.audience, channels: draft.channels, send_mode: draft.send_mode, resend_after_hours: draft.resend && draft.channels.includes("push") ? draft.resend_after_hours : null, resend_title: draft.resend_title.trim() || null, resend_body: draft.resend_body.trim() || null, ...content() });
      await api.push.sendCampaign(created.id);
      toast.success("Notification en cours d'envoi", `${formatNumber(count ?? 0)} appareil(s) ciblé(s).`);
      setDraft(EMPTY);
      await campaigns.reload();
    } catch (err) {
      toast.error(err);
      await campaigns.reload();
    } finally {
      setSending(false);
    }
  }

  async function test() {
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error("Renseignez un titre et un texte avant le test");
      return;
    }
    setTesting(true);
    try {
      await api.push.test(testDevice, content(), draft.channels);
      toast.success("Test envoyé", "La notification arrive sur l'appareil choisi dans quelques secondes.");
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.push.removeCampaign(toDelete.id);
      setToDelete(null);
      await campaigns.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  }

  // Refresh history while something is being delivered.
  const inFlight = campaigns.data?.some((c) => c.status === "sending");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void campaigns.reload(), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);

  return (
    <div className="space-y-6">
      {!ready && (
        <div className="flex flex-col gap-3 rounded-[20px] bg-amber-50 p-5 text-sm text-amber-800 ring-1 ring-amber-600/20 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-900/20 dark:text-amber-200">
          <p>Branchez d'abord votre application : clé Firebase (Android / iOS), clé APNs (iOS) ou Expo.</p>
          <Button size="sm" variant="secondary" icon={Settings2} onClick={onSetup}>
            Configurer
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Nouvelle notification" description={MERGE_HINT} />
          <form onSubmit={send} className="space-y-4 p-6">
            <Field label="Titre" htmlFor="push-title" hint={`${draft.title.length} / 120`}>
              <Input id="push-title" required maxLength={120} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="{{first_name|Bonjour}}, -30 % ce soir" />
            </Field>
            <Field label="Texte" htmlFor="push-body" hint={`${draft.body.length} / 500`}>
              <Textarea id="push-body" required maxLength={500} rows={3} value={draft.body} onChange={(e) => set("body", e.target.value)} placeholder="Votre panier vous attend. Livraison offerte jusqu'à minuit." />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Lien à l'ouverture" htmlFor="push-url" hint="URL ou deep link (monapp://panier)">
                <Input id="push-url" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://… ou monapp://…" />
              </Field>
              <Field label="Image (optionnelle)" htmlFor="push-image" hint="URL https d'une image">
                <Input id="push-image" type="url" value={draft.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…/visuel.jpg" />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Où l'afficher ?</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CHANNEL_OPTIONS.map((o) => {
                  const on = draft.channels.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className={cx(
                        "flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition",
                        on ? "bg-brand-50/70 ring-brand-500 dark:bg-brand-900/20" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-brand-500"
                        checked={on}
                        onChange={(e) => {
                          const next = e.target.checked ? [...draft.channels, o.value] : draft.channels.filter((c) => c !== o.value);
                          if (next.length) set("channels", next);
                        }}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                          <o.icon className="size-4" /> {o.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{o.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {draft.channels.includes("push") && (
              <fieldset className="space-y-3">
                <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Options d'envoi</legend>
                <label className="flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 ring-slate-900/10 dark:ring-white/10">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-brand-500"
                    checked={draft.send_mode === "smart"}
                    onChange={(e) => set("send_mode", e.target.checked ? "smart" : "now")}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                      <Wand2 className="size-4" /> Envoi intelligent
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Chaque client la reçoit dans les 24 h, à l'heure où il ouvre d'habitude ses notifications et emails. Sans historique : la meilleure heure de
                      votre audience.
                    </span>
                  </span>
                </label>
                <div className="rounded-2xl p-4 ring-1 ring-slate-900/10 dark:ring-white/10">
                  <label className="flex cursor-pointer gap-3">
                    <input type="checkbox" className="mt-1 size-4 accent-brand-500" checked={draft.resend} onChange={(e) => set("resend", e.target.checked)} />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
                        <Repeat className="size-4" /> Relancer ceux qui ne l'ont pas ouverte
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        Une seule relance, uniquement aux clients qui ne l'ont ni ouverte ni lue dans l'app.
                      </span>
                    </span>
                  </label>
                  {draft.resend && (
                    <div className="mt-4 space-y-3 pl-7">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <span>Après</span>
                        <Select
                          className="h-9 w-auto"
                          value={draft.resend_after_hours}
                          onChange={(e) => set("resend_after_hours", Number(e.target.value))}
                          aria-label="Délai de relance"
                        >
                          {[2, 6, 12, 24, 48, 72].map((h) => (
                            <option key={h} value={h}>
                              {h < 24 ? `${h} heures` : h === 24 ? "1 jour" : `${h / 24} jours`}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <Input value={draft.resend_title} onChange={(e) => set("resend_title", e.target.value)} placeholder={`Titre de la relance (par défaut : ${draft.title || "le même"})`} aria-label="Titre de la relance" maxLength={120} />
                      <Input value={draft.resend_body} onChange={(e) => set("resend_body", e.target.value)} placeholder="Texte de la relance (par défaut : le même)" aria-label="Texte de la relance" maxLength={500} />
                    </div>
                  )}
                </div>
              </fieldset>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Audience" htmlFor="push-audience">
                <Select
                  id="push-audience"
                  value={draft.audience.type}
                  onChange={(e) => {
                    const t = e.target.value as PushAudience["type"];
                    set("audience", t === "all" ? { type: "all" } : t === "segment" ? { type: "segment", segment_id: "" } : { type: "tag", tag: "" });
                  }}
                >
                  <option value="all">Tous les appareils</option>
                  <option value="segment">Un segment</option>
                  <option value="tag">Un tag</option>
                </Select>
              </Field>
              {draft.audience.type === "segment" && (
                <Field label="Segment" htmlFor="push-segment">
                  <Select id="push-segment" required value={draft.audience.segment_id} onChange={(e) => set("audience", { type: "segment", segment_id: e.target.value })}>
                    <option value="">Choisir…</option>
                    {segments.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {draft.audience.type === "tag" && (
                <Field label="Tag" htmlFor="push-tag">
                  <Select id="push-tag" required value={draft.audience.tag} onChange={(e) => set("audience", { type: "tag", tag: e.target.value })}>
                    <option value="">Choisir…</option>
                    {tags.data?.map((t) => (
                      <option key={t.tag} value={t.tag}>
                        {t.tag} ({t.count})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <Field label="Nom interne (optionnel)" htmlFor="push-name" hint="Pour retrouver l'envoi dans l'historique">
              <Input id="push-name" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Vente flash — novembre" />
            </Field>

            <div className="flex flex-col gap-4 border-t border-slate-900/10 pt-5 lg:flex-row lg:items-end lg:justify-between dark:border-white/10">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                <Field label="Appareil de test" htmlFor="push-test" className="min-w-0 sm:max-w-xs sm:flex-1">
                  <Select id="push-test" value={testDevice} onChange={(e) => setTestDevice(e.target.value)} disabled={!deviceList.data?.length}>
                    {!deviceList.data?.length && <option value="">Aucun appareil</option>}
                    {deviceList.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.platform === "ios" ? "iOS" : "Android"} · {d.contact_email ?? d.token_preview}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="secondary" icon={FlaskConical} onClick={() => void test()} loading={testing} disabled={!testDevice}>
                  Tester
                </Button>
              </div>
              <Button type="submit" variant="accent" icon={Send} loading={sending} disabled={!count}>
                Envoyer à {count === null ? "…" : formatNumber(count)} appareil{count === 1 ? "" : "s"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Aperçu"
            action={
              <Segmented
                value={platform}
                onChange={setPlatform}
                options={[
                  { value: "ios", label: "iOS" },
                  { value: "android", label: "Android" },
                  { value: "in_app", label: "App" },
                ]}
              />
            }
          />
          <div className="flex flex-1 items-center justify-center p-6">
            {platform === "in_app" ? (
              <InAppPreview title={draft.title} body={draft.body} image={draft.image_url} />
            ) : (
              <PhonePreview platform={platform} title={draft.title} body={draft.body} image={draft.image_url} />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Historique" description="Campagnes push envoyées depuis Missive" />
        {campaigns.error ? (
          <div className="p-6">
            <ErrorState message={campaigns.error} onRetry={campaigns.reload} />
          </div>
        ) : campaigns.loading && !campaigns.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !campaigns.data?.length ? (
          <EmptyState icon={BellRing} title="Aucune notification envoyée" description="Vos campagnes push et leurs statistiques apparaîtront ici." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-900/10 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
                  <th className="px-6 py-3 font-medium">Notification</th>
                  <th className="px-3 py-3 font-medium">Statut</th>
                  <th className="px-3 py-3 text-right font-medium">Envoyées</th>
                  <th className="px-3 py-3 text-right font-medium">Échecs</th>
                  <th className="px-3 py-3 text-right font-medium">Ouvertures</th>
                  <th className="px-3 py-3 text-right font-medium">Lues dans l'app</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {campaigns.data.map((c) => (
                  <tr key={c.id} className="border-b border-slate-900/5 last:border-0 dark:border-white/5">
                    <td className="max-w-0 px-6 py-3">
                      <p className="truncate font-medium text-slate-900 dark:text-white">{c.name}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {c.channels.includes("push") && c.channels.includes("in_app")
                          ? "Écran verrouillé + app"
                          : c.channels.includes("push")
                            ? "Écran verrouillé"
                            : "Dans l'app"}{" "}
                        · {formatDateTime(c.sent_at ?? c.created_at)}
                        {c.send_mode === "smart" && " · envoi intelligent"}
                        {c.resend.after_hours != null && ` · relance après ${c.resend.after_hours} h`}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {c.status === "sent" ? (
                        <Badge tone="green">Envoyée</Badge>
                      ) : c.status === "sending" ? (
                        <Badge tone="blue" dot>
                          {c.stats.scheduled > 0 ? `${formatNumber(c.stats.scheduled)} programmée(s)` : "En cours"}
                        </Badge>
                      ) : (
                        <Badge>Brouillon</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(c.stats.sent)}</td>
                    <td className={cx("px-3 py-3 text-right tabular-nums", c.stats.failed > 0 && "text-red-600 dark:text-red-400")}>{formatNumber(c.stats.failed)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.channels.includes("push") ? (
                        <>
                          {formatNumber(c.stats.opened)} <span className="text-xs text-slate-500">({c.stats.open_rate.toLocaleString("fr-FR")} %)</span>
                          {c.stats.resend.sent > 0 && (
                            <span className="block text-xs text-slate-500">
                              Relance : {formatNumber(c.stats.resend.opened)} / {formatNumber(c.stats.resend.sent)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.channels.includes("in_app") ? (
                        <>
                          {formatNumber(c.stats.in_app.read)} / {formatNumber(c.stats.in_app.total)}{" "}
                          <span className="text-xs text-slate-500">({c.stats.in_app.read_rate.toLocaleString("fr-FR")} %)</span>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {c.status !== "sending" && (
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Supprimer ${c.name}`} onClick={() => setToDelete(c)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        danger
        title="Supprimer cette notification ?"
        description="L'historique et les statistiques de cet envoi seront supprimés."
        confirmLabel="Supprimer"
      />
    </div>
  );
}

const SAMPLE = { first_name: "Camille", last_name: "Martin", email: "camille@exemple.fr" };
function previewTags(text: string): string {
  return text.replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (_, key: string, fallback?: string) => SAMPLE[key as keyof typeof SAMPLE] ?? fallback ?? "");
}

function PhonePreview({ platform, title, body, image }: { platform: "ios" | "android"; title: string; body: string; image: string }) {
  const t = previewTags(title) || "Titre de la notification";
  const b = previewTags(body) || "Le texte de votre notification s'affiche ici.";
  const ios = platform === "ios";
  return (
    <div
      className={cx(
        "relative w-[260px] overflow-hidden border-[7px] border-slate-900 bg-gradient-to-b p-3 pt-10 shadow-xl",
        ios ? "h-[480px] rounded-[44px] from-indigo-400 via-sky-300 to-rose-200" : "h-[480px] rounded-[30px] from-emerald-700 via-teal-600 to-slate-800",
      )}
      aria-label="Aperçu de la notification"
    >
      {ios ? (
        <div className="absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-slate-900" />
      ) : (
        <div className="absolute top-2.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-slate-900" />
      )}
      <p className={cx("text-center font-display text-white drop-shadow", ios ? "text-5xl font-semibold" : "text-left text-4xl font-light")}>9:41</p>
      <div
        className={cx(
          "mt-6 p-3 text-[12px] shadow-lg",
          ios ? "rounded-[18px] bg-white/75 backdrop-blur-xl" : "rounded-[16px] bg-slate-50",
        )}
      >
        <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
          <span className={cx("flex size-5 items-center justify-center bg-brand-500 text-white", ios ? "rounded-[6px]" : "rounded-full")}>
            <BellRing className="size-3" />
          </span>
          <span className="font-medium tracking-wide uppercase">Votre app</span>
          <span className="ml-auto">{ios ? "maintenant" : "· maint."}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 font-semibold text-slate-900">{t}</p>
        <p className="line-clamp-4 text-slate-700">{b}</p>
        {image.trim() && (
          <div className="mt-2 flex h-24 items-center justify-center overflow-hidden rounded-[10px] bg-slate-200">
            <img src={image} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
            <ImageIcon className="absolute size-5 text-slate-400" />
          </div>
        )}
      </div>
    </div>
  );
}

function InAppPreview({ title, body, image }: { title: string; body: string; image: string }) {
  const t = previewTags(title) || "Titre de la notification";
  const b = previewTags(body) || "Le texte de votre notification s'affiche ici.";
  return (
    <div className="relative h-[480px] w-[260px] overflow-hidden rounded-[44px] border-[7px] border-slate-900 bg-white shadow-xl" aria-label="Aperçu dans l'app">
      <div className="absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-slate-900" />
      <div className="flex items-center justify-between px-4 pt-10 pb-3">
        <p className="font-display text-lg font-bold text-slate-900">Notifications</p>
        <span className="relative flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
          <BellRing className="size-4" />
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">1</span>
        </span>
      </div>
      <div className="space-y-2 px-3">
        <div className="relative rounded-2xl bg-brand-50 p-3 text-[12px] ring-1 ring-brand-200">
          <span className="absolute top-3.5 right-3 size-2 rounded-full bg-brand-500" />
          <p className="pr-4 font-semibold text-slate-900">{t}</p>
          <p className="mt-0.5 line-clamp-3 text-slate-600">{b}</p>
          {image.trim() && <img src={image} alt="" className="mt-2 h-20 w-full rounded-lg object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
          <p className="mt-1.5 text-[10px] text-slate-400">À l'instant</p>
        </div>
        {[
          ["Votre commande est expédiée", "Suivez votre colis en un clic."],
          ["Bienvenue !", "Activez les notifications pour ne rien manquer."],
        ].map(([a, c]) => (
          <div key={a} className="rounded-2xl bg-slate-50 p-3 text-[12px] opacity-70">
            <p className="font-semibold text-slate-700">{a}</p>
            <p className="mt-0.5 text-slate-500">{c}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

const PROVIDER_LABEL = { fcm: "Firebase", apns: "APNs", expo: "Expo" } as const;

function DevicesTab({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.push.devices(page, 50), [page]);
  const [toRemove, setToRemove] = useState<PushDevice | null>(null);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await api.push.removeDevice(toRemove.id);
      setToRemove(null);
      await list.reload();
      onChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
    }
  }

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;

  return (
    <Card>
      <CardHeader title="Appareils enregistrés" description="Les jetons invalides signalés par Apple ou Google sont désactivés automatiquement." />
      {list.error ? (
        <div className="p-6">
          <ErrorState message={list.error} onRetry={list.reload} />
        </div>
      ) : list.loading && !list.data ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !list.data?.data.length ? (
        <EmptyState icon={Smartphone} title="Aucun appareil" description="Les appareils apparaissent dès que votre application enregistre leur jeton (onglet Configuration)." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-900/10 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
                  <th className="px-6 py-3 font-medium">Appareil</th>
                  <th className="px-3 py-3 font-medium">Contact</th>
                  <th className="px-3 py-3 font-medium">Version</th>
                  <th className="px-3 py-3 font-medium">Vu</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((d) => (
                  <tr key={d.id} className="border-b border-slate-900/5 last:border-0 dark:border-white/5">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={d.platform === "ios" ? "slate" : "green"}>{d.platform === "ios" ? "iOS" : "Android"}</Badge>
                        <Badge tone="brand">{PROVIDER_LABEL[d.provider]}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-slate-500">{d.token_preview}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{d.contact_email ?? <span className="text-slate-400">Anonyme</span>}</td>
                    <td className="px-3 py-3 text-slate-500">{d.app_version ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-500">{formatRelative(d.last_seen_at)}</td>
                    <td className="px-6 py-3 text-right">
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Désactiver l'appareil" onClick={() => setToRemove(d)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-900/10 px-6 py-3 dark:border-white/10">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Précédent
              </Button>
              <span className="text-xs text-slate-500">
                {page} / {pages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Suivant
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={remove}
        loading={removing}
        danger
        title="Désactiver cet appareil ?"
        description="Il ne recevra plus de notifications jusqu'à ce que l'application enregistre à nouveau son jeton."
        confirmLabel="Désactiver"
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={done ? Check : Copy}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copié" : label}
    </Button>
  );
}

function readFile(e: ChangeEvent<HTMLInputElement>, onText: (text: string) => void) {
  const file = e.target.files?.[0];
  if (!file) return;
  void file.text().then(onText);
  e.target.value = "";
}

function SetupTab({ config, onSaved }: { config: PushConfig; onSaved: (c: PushConfig) => void }) {
  const toast = useToast();
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  const [fcm, setFcm] = useState("");
  const [savingFcm, setSavingFcm] = useState(false);

  const [apns, setApns] = useState({
    key_p8: "",
    key_id: config.apns.key_id ?? "",
    team_id: config.apns.team_id ?? "",
    bundle_id: config.apns.bundle_id ?? "",
    production: config.apns.production ?? true,
  });
  const [savingApns, setSavingApns] = useState(false);

  const [expoToken, setExpoToken] = useState("");
  const [savingExpo, setSavingExpo] = useState(false);

  async function save(kind: "fcm" | "apns" | "expo", input: Parameters<typeof api.push.saveConfig>[0], setBusy: (b: boolean) => void, done?: () => void) {
    setBusy(true);
    try {
      onSaved(await api.push.saveConfig(input));
      toast.success(kind === "fcm" ? "Firebase enregistré" : kind === "apns" ? "Clé APNs enregistrée" : "Expo enregistré");
      done?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      onSaved(await api.push.rotateAppKey());
      toast.success("Nouvelle clé générée", "Mettez à jour votre application : l'ancienne clé ne fonctionne plus.");
      setRotateOpen(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setRotating(false);
    }
  }

  const [lang, setLang] = useState<"sdk" | "http">("sdk");
  const snippet = useMemo(
    () =>
      lang === "sdk"
        ? `// React Native / Expo — SDK Missive (dossier sdk/expo du dépôt)
import { Missive, MissiveInbox, useMissiveInbox } from "@missive/expo-push";

Missive.init({ appKey: "${config.app_key}", apiUrl: "${API_URL}" });

// Après la connexion du client : permission, jeton, écran verrouillé
await Missive.register({ email: user.email, userHash: user.missiveHash });

// À la déconnexion
await Missive.logout();

// Écran « Notifications » de votre app (centre de notifications)
<MissiveInbox onOpen={(item) => item.url && Linking.openURL(item.url)} />

// Pastille sur l'icône cloche
const { unread } = useMissiveInbox();`
        : `// Swift, Kotlin, Flutter… : 4 appels HTTP
POST ${API_URL}/api/v1/push/app/devices          // enregistrer le jeton
  Authorization: Bearer ${config.app_key}
  { "token": "<jeton APNs / FCM / Expo>", "platform": "ios", "email": "…", "user_hash": "…" }

GET  ${API_URL}/api/v1/push/app/inbox            // centre de notifications
  Authorization: Bearer ${config.app_key}
  X-Missive-Device: <jeton>
  → { "data": [{ "id", "title", "body", "url", "read" }], "unread": 2 }

POST ${API_URL}/api/v1/push/app/inbox/read       // { "ids": [...] } ou {} = tout lire
POST ${API_URL}/api/v1/push/app/opened           // { "message_id": data.missive_message_id }

// Android : créez le canal « missive » (importance haute, visibilité publique)`,
    [config.app_key, lang],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Clé de votre application"
          description="Clé publique à intégrer dans l'app iOS / Android : enregistrement des appareils, centre de notifications et ouvertures."
        />
        <div className="space-y-5 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-4 py-2.5 font-mono text-sm text-slate-900 dark:bg-white/5 dark:text-white">{config.app_key}</code>
            <div className="flex gap-2">
              <CopyButton text={config.app_key} />
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setRotateOpen(true)}>
                Régénérer
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute top-3 right-3">
              <CopyButton text={snippet} label="Copier le code" />
            </div>
            <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 pt-14 text-[12.5px] leading-relaxed text-slate-200">{snippet}</pre>
            <div className="absolute top-3 left-3">
              <Segmented
                value={lang}
                onChange={setLang}
                className="bg-white/10"
                options={[
                  { value: "sdk", label: "React Native / Expo" },
                  { value: "http", label: "API HTTP" },
                ]}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fonctionne avec Swift, Kotlin, React Native, Flutter ou Expo. Depuis votre back-office, utilisez plutôt <code>POST /api/v1/push/devices</code> avec une clé API secrète.
            La donnée <code>missive_message_id</code> est incluse dans chaque notification.
          </p>
        </div>
      </Card>

      <PromptCard config={config} onSaved={onSaved} />

      <IdentityCard config={config} onSaved={onSaved} />

      <TransactionalCard />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="2. Firebase Cloud Messaging"
            description="Android, et iOS si votre app utilise Firebase"
            action={config.fcm.configured ? <Badge tone="green" dot>Connecté</Badge> : <Badge>Non configuré</Badge>}
          />
          <div className="space-y-4 p-6">
            {config.fcm.configured && (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-300">
                Projet <strong>{config.fcm.project_id}</strong> · {config.fcm.client_email}
              </p>
            )}
            <Field
              label="Compte de service (JSON)"
              htmlFor="fcm-json"
              hint="Console Firebase › Paramètres du projet › Comptes de service › Générer une nouvelle clé privée"
            >
              <Textarea id="fcm-json" rows={5} value={fcm} onChange={(e) => setFcm(e.target.value)} placeholder='{ "type": "service_account", "project_id": "…", … }' className="font-mono text-xs" spellCheck={false} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white px-5 font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15 ring-inset hover:ring-slate-900/40 dark:bg-white/5 dark:text-slate-100 dark:ring-white/15">
                <Upload className="size-4" /> Importer le fichier
                <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => readFile(e, setFcm)} />
              </label>
              <Button loading={savingFcm} disabled={!fcm.trim()} onClick={() => void save("fcm", { fcm }, setSavingFcm, () => setFcm(""))}>
                Enregistrer
              </Button>
              {config.fcm.configured && (
                <Button variant="ghost" onClick={() => void save("fcm", { fcm: null }, setSavingFcm)}>
                  Retirer
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="3. Apple Push (APNs)"
            description="iOS natif, avec une clé d'authentification .p8"
            action={config.apns.configured ? <Badge tone="green" dot>Connecté</Badge> : <Badge>Non configuré</Badge>}
          />
          <form
            className="space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save("apns", { apns }, setSavingApns, () => setApns((a) => ({ ...a, key_p8: "" })));
            }}
          >
            <Field label="Clé .p8" htmlFor="apns-p8" hint={config.apns.configured ? "Collez à nouveau la clé pour modifier cette configuration." : "Apple Developer › Certificates, IDs & Profiles › Keys"}>
              <Textarea id="apns-p8" required rows={3} value={apns.key_p8} onChange={(e) => setApns({ ...apns, key_p8: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----" className="font-mono text-xs" spellCheck={false} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Key ID" htmlFor="apns-key">
                <Input id="apns-key" required value={apns.key_id} onChange={(e) => setApns({ ...apns, key_id: e.target.value.toUpperCase() })} placeholder="ABC123DEFG" maxLength={10} />
              </Field>
              <Field label="Team ID" htmlFor="apns-team">
                <Input id="apns-team" required value={apns.team_id} onChange={(e) => setApns({ ...apns, team_id: e.target.value.toUpperCase() })} placeholder="TEAM123456" maxLength={10} />
              </Field>
              <Field label="Bundle ID" htmlFor="apns-bundle">
                <Input id="apns-bundle" required value={apns.bundle_id} onChange={(e) => setApns({ ...apns, bundle_id: e.target.value })} placeholder="fr.maboutique.app" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={apns.production} onChange={(e) => setApns({ ...apns, production: e.target.checked })} className="size-4 accent-brand-500" />
              Production (décochez pour les builds de développement / TestFlight interne)
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white px-5 font-display text-sm font-semibold text-slate-900 ring-1 ring-slate-900/15 ring-inset hover:ring-slate-900/40 dark:bg-white/5 dark:text-slate-100 dark:ring-white/15">
                <Upload className="size-4" /> Importer le .p8
                <input type="file" accept=".p8" className="sr-only" onChange={(e) => readFile(e, (t) => setApns((a) => ({ ...a, key_p8: t })))} />
              </label>
              <Button type="submit" loading={savingApns}>
                Enregistrer
              </Button>
              {config.apns.configured && (
                <Button variant="ghost" onClick={() => void save("apns", { apns: null }, setSavingApns)}>
                  Retirer
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Expo (React Native)"
          description="Les jetons ExponentPushToken[…] fonctionnent sans configuration. Le jeton d'accès n'est requis que si vous avez activé la sécurité renforcée des push Expo."
          action={<Badge tone="green" dot>{config.expo.has_access_token ? "Jeton d'accès enregistré" : "Prêt"}</Badge>}
        />
        <div className="flex flex-col gap-2 p-6 sm:flex-row sm:items-end">
          <Field label="Jeton d'accès Expo (optionnel)" htmlFor="expo-token" className="min-w-0 flex-1">
            <Input id="expo-token" type="password" autoComplete="off" value={expoToken} onChange={(e) => setExpoToken(e.target.value)} placeholder={config.expo.has_access_token ? "••••••••" : ""} />
          </Field>
          <Button
            loading={savingExpo}
            disabled={!expoToken.trim() && !config.expo.has_access_token}
            onClick={() => void save("expo", { expo: expoToken.trim() ? { access_token: expoToken.trim() } : null }, setSavingExpo, () => setExpoToken(""))}
          >
            {expoToken.trim() || !config.expo.has_access_token ? "Enregistrer" : "Retirer le jeton"}
          </Button>
        </div>
      </Card>

      {config.mode === "log" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Le serveur est en mode test : les notifications sont journalisées sans être transmises à Apple ou Google. Passez <code>PUSH_MODE=live</code> pour l'envoi réel.
        </p>
      )}

      <ConfirmModal
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={rotate}
        loading={rotating}
        danger
        title="Régénérer la clé d'application ?"
        description="Les versions de votre app qui utilisent l'ancienne clé ne pourront plus enregistrer d'appareils. Les appareils déjà enregistrés continuent de recevoir les notifications."
        confirmLabel="Régénérer"
      />
    </div>
  );
}

function IdentityCard({ config, onSaved }: { config: PushConfig; onSaved: (c: PushConfig) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      onSaved(await api.push.setIdentityRequired(!config.identity.required));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      onSaved(await api.push.rotateIdentitySecret());
      setRotateOpen(false);
      toast.success("Nouvelle clé d'identité générée", "Mettez à jour votre serveur.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const backend = `// Sur VOTRE serveur (jamais dans l'app) — Node.js
import { createHmac } from "node:crypto";
const userHash = createHmac("sha256", process.env.MISSIVE_IDENTITY_SECRET)
  .update(user.email.toLowerCase())
  .digest("hex");
// Renvoyez userHash à l'app avec la session du client.`;

  return (
    <Card>
      <CardHeader
        title="Vérification d'identité"
        description="Empêche quiconque possède la clé publique de lire les notifications d'un autre client."
        action={
          config.identity.required ? (
            <Badge tone="green" dot>
              Activée
            </Badge>
          ) : (
            <Badge tone="amber" dot>
              Recommandée
            </Badge>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>
            Votre serveur signe l'email du client avec la clé secrète ci-dessous, et l'app envoie cette signature (<code>user_hash</code>) en enregistrant
            l'appareil. Sans signature valide, l'appareil n'est pas rattaché au client.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-4 py-2.5 font-mono text-xs text-slate-900 dark:bg-white/5 dark:text-white">
              {show ? config.identity.secret : "msvid_" + "•".repeat(24)}
            </code>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>
                {show ? "Masquer" : "Afficher"}
              </Button>
              <CopyButton text={config.identity.secret} />
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setRotateOpen(true)} aria-label="Régénérer la clé d'identité" />
            </div>
          </div>
          <Button variant={config.identity.required ? "secondary" : "primary"} icon={ShieldCheck} loading={busy} onClick={() => void toggle()}>
            {config.identity.required ? "Désactiver la vérification" : "Exiger la vérification"}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-[12px] leading-relaxed text-slate-200">{backend}</pre>
      </div>
      <ConfirmModal
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={rotate}
        loading={busy}
        danger
        title="Régénérer la clé d'identité ?"
        description="Les signatures calculées avec l'ancienne clé seront refusées : mettez votre serveur à jour en même temps."
        confirmLabel="Régénérer"
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Pre-permission screen                                                      */
/* -------------------------------------------------------------------------- */

function PromptCard({ config, onSaved }: { config: PushConfig; onSaved: (c: PushConfig) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<PushPrompt>(config.prompt);
  const [busy, setBusy] = useState(false);
  const stats = config.prompt_stats;
  const set = <K extends keyof PushPrompt>(key: K, value: PushPrompt[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.prompt);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api.push.savePrompt({ ...draft, image_url: draft.image_url?.trim() || null });
      onSaved(next);
      setDraft(next.prompt);
      toast.success("Écran de pré-permission enregistré", "Les apps l'affichent dès leur prochain lancement.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const code = `import { Missive, MissivePermissionPrompt } from "@missive/expo-push";

// 1. Une fois, à la racine de l'app
<MissivePermissionPrompt />

// 2. Au bon moment (après un premier achat, un suivi de commande…)
await Missive.requestPermission();`;

  return (
    <Card>
      <CardHeader
        title="Écran de pré-permission"
        description="iOS ne laisse demander les notifications qu'une fois. Expliquez d'abord : la fenêtre système ne s'ouvre que pour ceux qui acceptent."
        action={
          draft.enabled ? (
            <Badge tone="green" dot>
              Actif
            </Badge>
          ) : (
            <Badge>Désactivé</Badge>
          )
        }
      />
      <div className="grid grid-cols-2 gap-4 border-b border-slate-900/10 p-6 xl:grid-cols-4 dark:border-white/10">
        <StatCard label={`Affichages (${stats.days} j)`} value={formatNumber(stats.shown)} icon={MessageSquareQuote} />
        <StatCard label="Ont touché « Activer »" value={`${stats.accept_rate.toLocaleString("fr-FR")} %`} hint={`${formatNumber(stats.accepted)} clients`} />
        <StatCard label="Taux d'opt-in" value={`${stats.opt_in_rate.toLocaleString("fr-FR")} %`} hint={`${formatNumber(stats.granted)} autorisations`} icon={BellRing} />
        <StatCard label="Clients dans l'app" value={formatNumber(config.app_users)} hint="connectés au moins une fois" icon={Smartphone} />
      </div>
      <form onSubmit={(e) => void save(e)} className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_300px] [&>*]:min-w-0">
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input type="checkbox" className="size-4 accent-brand-500" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            Afficher l'écran avant la demande système
          </label>
          <Field label="Titre" htmlFor="prompt-title">
            <Input id="prompt-title" value={draft.title} maxLength={80} onChange={(e) => set("title", e.target.value)} required />
          </Field>
          <Field label="Message" htmlFor="prompt-body" hint="Dites ce que le client y gagne : suivi de commande, offres en avant-première…">
            <Textarea id="prompt-body" rows={3} value={draft.body} maxLength={300} onChange={(e) => set("body", e.target.value)} required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bouton principal" htmlFor="prompt-accept">
              <Input id="prompt-accept" value={draft.accept_label} maxLength={30} onChange={(e) => set("accept_label", e.target.value)} required />
            </Field>
            <Field label="Bouton secondaire" htmlFor="prompt-decline">
              <Input id="prompt-decline" value={draft.decline_label} maxLength={30} onChange={(e) => set("decline_label", e.target.value)} required />
            </Field>
            <Field label="Afficher à partir du lancement n°" htmlFor="prompt-launches">
              <Input id="prompt-launches" type="number" min={1} max={20} value={draft.min_launches} onChange={(e) => set("min_launches", Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Après « Plus tard », reproposer dans (jours)" htmlFor="prompt-cooldown">
              <Input id="prompt-cooldown" type="number" min={1} max={90} value={draft.cooldown_days} onChange={(e) => set("cooldown_days", Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </div>
          <Field label="Image (optionnelle)" htmlFor="prompt-image">
            <Input id="prompt-image" type="url" value={draft.image_url ?? ""} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…/visuel.jpg" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy} disabled={!dirty}>
              Enregistrer
            </Button>
            <span className="text-xs text-slate-500 dark:text-slate-400">Modifiable à tout moment, sans republier l'app.</span>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-[12px] leading-relaxed text-slate-200">{code}</pre>
        </div>
        <div className="mx-auto w-full max-w-[300px]">
          <div className="overflow-hidden rounded-[2.2rem] bg-slate-900 p-2 shadow-xl">
            <div className="relative flex h-[520px] flex-col justify-end overflow-hidden rounded-[1.8rem] bg-gradient-to-b from-slate-200 to-slate-300">
              <div className="absolute inset-0" style={{ backgroundColor: "rgba(11,33,74,0.45)" }} />
              <div className="relative rounded-t-3xl bg-white px-5 pt-5 pb-7 text-center">
                {draft.image_url ? (
                  <img src={draft.image_url} alt="" className="mb-3 h-24 w-full rounded-2xl object-cover" />
                ) : (
                  <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">🔔</div>
                )}
                <p className="text-lg leading-tight font-extrabold text-[#0b214a]">{draft.title || "Titre"}</p>
                <p className="mt-2 text-[13px] leading-snug text-slate-500">{draft.body || "Message"}</p>
                <div className="mt-4 rounded-full bg-brand-500 py-3 text-sm font-bold text-white">{draft.accept_label || "Activer"}</div>
                <div className="pt-3 text-sm font-semibold text-slate-500">{draft.decline_label || "Plus tard"}</div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">Aperçu dans l'app</p>
        </div>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Transactional push                                                         */
/* -------------------------------------------------------------------------- */

function TransactionalCard() {
  const code = `curl -X POST ${API_URL}/api/v1/push/send \\
  -H "Authorization: Bearer VOTRE_CLE_API_SECRETE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "camille@exemple.fr",
    "title": "Votre commande est en route 🚚",
    "body": "Colissimo la livre demain. Suivez-la en direct.",
    "url": "monapp://commandes/1042"
  }'`;
  return (
    <Card>
      <CardHeader
        title="Notifications transactionnelles"
        description="Un message à un client précis, envoyé tout de suite : commande expédiée, rendez-vous, mot de passe…"
        action={<Badge tone="blue">API</Badge>}
      />
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-brand-500" /> Envoi immédiat sur tous les appareils du client, et dans le centre de notifications de l'app.
          </p>
          <p className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" /> Transactionnel : atteint aussi les clients désabonnés des offres marketing.
          </p>
          <p className="flex gap-2">
            <Package className="mt-0.5 size-4 shrink-0 text-brand-500" /> Sans code avec Shopify : créez une automatisation « Commande expédiée » avec une étape push.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Créez la clé secrète dans Réglages › Clés API. Ne l'utilisez jamais dans l'app mobile. Réponse <code>404</code> si le contact n'existe pas.
          </p>
        </div>
        <div className="relative min-w-0">
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 pt-11 text-[12px] leading-relaxed text-slate-200">{code}</pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={code} />
          </div>
        </div>
      </div>
    </Card>
  );
}

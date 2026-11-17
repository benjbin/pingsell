import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Save, Users } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useAsync, useDebounced } from "../../lib/useAsync";
import { CONTACT_STATUS } from "../../lib/constants";
import { formatCurrency, formatNumber, fullName, initials } from "../../lib/format";
import type { SegmentPreview, SegmentRules } from "../../lib/types";
import { Avatar, Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Skeleton, Spinner } from "../../components/ui/primitives";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";
import { RuleBuilder, defaultCondition, isConditionComplete } from "./RuleBuilder";

const INITIAL_RULES: SegmentRules = { match: "all", conditions: [defaultCondition("tags")] };

export function SegmentEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [rules, setRules] = useState<SegmentRules>(INITIAL_RULES);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const tags = useAsync(() => api.tags(), []);
  const existing = useAsync(() => (id ? api.segments.get(id) : Promise.resolve(null)), [id]);

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setRules(existing.data.rules?.conditions?.length ? existing.data.rules : INITIAL_RULES);
    }
  }, [existing.data]);

  const completeRules: SegmentRules = { match: rules.match, conditions: rules.conditions.filter(isConditionComplete) };
  const debouncedRules = useDebounced(JSON.stringify(completeRules), 400);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    api.segments
      .preview(JSON.parse(debouncedRules) as SegmentRules)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setPreviewError(errorMessage(err)))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedRules]);

  async function save() {
    if (!name.trim()) {
      toast.error(t("Donnez un nom à votre segment", "Give your segment a name"));
      return;
    }
    setSaving(true);
    try {
      if (isNew) await api.segments.create({ name: name.trim(), rules: completeRules });
      else await api.segments.update(id, { name: name.trim(), rules: completeRules });
      toast.success(isNew ? t("Segment créé", "Segment created") : t("Segment enregistré", "Segment saved"));
      navigate("/segments");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (existing.error) return <ErrorState message={existing.error} onRetry={existing.reload} />;

  return (
    <>
      <PageHeader
        back={
          <Link to="/segments" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="size-4" /> {t("Segments", "Segments")}
          </Link>
        }
        title={isNew ? t("Nouveau segment", "New segment") : name || t("Segment", "Segment")}
        description={t("Définissez des règles : le segment se met à jour automatiquement.", "Set rules: the segment updates automatically.")}
        actions={
          <Button icon={Save} onClick={save} loading={saving} disabled={!isNew && existing.loading}>
            {t("Enregistrer", "Save")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Card className="p-5">
            <Field label={t("Nom du segment", "Segment name")} htmlFor="seg-name">
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ex : Clients VIP", "e.g. VIP customers")} />
            </Field>
          </Card>
          <Card>
            <CardHeader title={t("Règles", "Rules")} description={t("Combinez autant de conditions que nécessaire.", "Combine as many conditions as you need.")} />
            <div className="p-5">
              {!isNew && existing.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <RuleBuilder rules={rules} onChange={setRules} tags={(tags.data ?? []).map((tg) => tg.tag)} />
              )}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-2">
          <Card className="xl:sticky xl:top-24">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Contacts correspondants", "Matching contacts")}</p>
                <p className="mt-1 flex items-center gap-2 text-3xl font-semibold text-slate-900 tabular-nums dark:text-white">
                  {preview ? formatNumber(preview.count) : "—"}
                  {previewLoading && <Spinner className="size-4" />}
                </p>
              </div>
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Users className="size-5" />
              </span>
            </div>
            <div className="p-2">
              {previewError ? (
                <p className="p-3 text-sm text-red-600 dark:text-red-400">{previewError}</p>
              ) : !preview ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : preview.sample.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t("Aucun contact ne correspond à ces règles.", "No contacts match these rules.")}</p>
              ) : (
                <>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{t("Échantillon", "Sample")}</p>
                  <ul className={previewLoading ? "opacity-60" : ""}>
                    {preview.sample.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
                        <Avatar text={initials(c)} className="size-7 text-[10px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{fullName(c)}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-600 tabular-nums dark:text-slate-300">{formatCurrency(c.total_spent)}</p>
                          <Badge tone={CONTACT_STATUS[c.status]?.tone} className="mt-0.5">
                            {CONTACT_STATUS[c.status]?.label}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

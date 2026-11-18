import { Plus, Trash2 } from "lucide-react";
import { OPS_BY_KIND, SEGMENT_FIELDS } from "../../lib/constants";
import type { SegmentCondition, SegmentField, SegmentOp, SegmentRules } from "../../lib/types";
import { Button, Input, Select } from "../../components/ui/primitives";
import { t } from "../../lib/i18n";

export function defaultCondition(field: SegmentField = "tags"): SegmentCondition {
  const kind = SEGMENT_FIELDS[field].kind;
  const op = OPS_BY_KIND[kind][0].op;
  const value = kind === "number" ? 0 : kind === "date" ? 30 : kind === "enum" ? (SEGMENT_FIELDS[field].options?.[0]?.value ?? "") : "";
  return { field, op, value };
}

/** Is a condition complete enough to be sent to the API? */
export function isConditionComplete(c: SegmentCondition): boolean {
  if (typeof c.value === "number") return !Number.isNaN(c.value);
  return String(c.value).trim() !== "";
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  canRemove,
}: {
  condition: SegmentCondition;
  onChange: (c: SegmentCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const fieldDef = SEGMENT_FIELDS[condition.field];
  const ops = OPS_BY_KIND[fieldDef.kind];

  function changeField(field: SegmentField) {
    onChange(defaultCondition(field));
  }

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center dark:bg-slate-800/50">
      <Select value={condition.field} onChange={(e) => changeField(e.target.value as SegmentField)} aria-label={t("Champ", "Field")}>
        {(Object.keys(SEGMENT_FIELDS) as SegmentField[]).map((f) => (
          <option key={f} value={f}>
            {SEGMENT_FIELDS[f].label}
          </option>
        ))}
      </Select>
      <Select value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as SegmentOp })} aria-label={t("Opérateur", "Operator")}>
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </Select>
      {fieldDef.kind === "enum" ? (
        <Select value={String(condition.value)} onChange={(e) => onChange({ ...condition, value: e.target.value })} aria-label={t("Valeur", "Value")}>
          {fieldDef.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : fieldDef.kind === "number" || fieldDef.kind === "date" ? (
        <div className="relative">
          <Input
            type="number"
            min={0}
            step={fieldDef.kind === "date" ? 1 : "any"}
            value={Number.isNaN(condition.value as number) ? "" : condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
            aria-label={t("Valeur", "Value")}
            className={fieldDef.kind === "date" ? "pr-12" : undefined}
          />
          {fieldDef.kind === "date" && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{t("jours", "days")}</span>}
        </div>
      ) : fieldDef.kind === "tags" ? (
        <Input
            list={TAG_LIST_ID}
            value={String(condition.value)}
            onChange={(e) => onChange({ ...condition, value: e.target.value.trim().toLowerCase() })}
            placeholder={t("ex : vip", "e.g. vip")}
            aria-label={t("Tag", "Tag")}
          />
      ) : fieldDef.kind === "page" ? (
        <Input value={String(condition.value)} onChange={(e) => onChange({ ...condition, value: e.target.value })} placeholder={t("ex : /tarifs ou Veste", "e.g. /pricing or Jacket")} aria-label={t("Adresse ou titre de page", "Page address or title")} />
      ) : (
        <Input value={String(condition.value)} onChange={(e) => onChange({ ...condition, value: e.target.value })} placeholder={t("Valeur", "Value")} aria-label={t("Valeur", "Value")} />
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={Trash2}
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={t("Supprimer la condition", "Remove condition")}
        className="justify-self-end"
      />
    </div>
  );
}

const TAG_LIST_ID = "segment-rule-tags";

export function RuleBuilder({ rules, onChange, tags }: { rules: SegmentRules; onChange: (r: SegmentRules) => void; tags: string[] }) {
  return (
    <div className="space-y-4">
      <datalist id={TAG_LIST_ID}>
        {tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <span>{t("Les contacts qui remplissent", "Contacts that match")}</span>
        <Select
          value={rules.match}
          onChange={(e) => onChange({ ...rules, match: e.target.value as "all" | "any" })}
          className="h-9 w-auto font-medium"
          aria-label={t("Correspondance", "Match")}
        >
          <option value="all">{t("toutes les conditions", "all conditions")}</option>
          <option value="any">{t("au moins une condition", "at least one condition")}</option>
        </Select>
      </div>

      <div className="space-y-2">
        {rules.conditions.map((c, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="py-1 pl-3 text-[11px] font-semibold tracking-wider text-brand-600 uppercase dark:text-brand-400">
                {rules.match === "all" ? t("et", "and") : t("ou", "or")}
              </div>
            )}
            <ConditionRow
              condition={c}
              canRemove={rules.conditions.length > 1}
              onChange={(next) => onChange({ ...rules, conditions: rules.conditions.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => onChange({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" icon={Plus} onClick={() => onChange({ ...rules, conditions: [...rules.conditions, defaultCondition("total_spent")] })}>
        {t("Ajouter une condition", "Add a condition")}
      </Button>
    </div>
  );
}

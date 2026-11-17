import { OPS_BY_KIND, SEGMENT_FIELDS } from "../../lib/constants";
import { t } from "../../lib/i18n";
import type { SegmentCondition, SegmentRules } from "../../lib/types";

/** Human-readable description of a condition, e.g. "Tags possède le tag vip". */
export function describeCondition(c: SegmentCondition): string {
  const field = SEGMENT_FIELDS[c.field];
  if (!field) return `${c.field} ${c.op} ${c.value}`;
  const op = OPS_BY_KIND[field.kind].find((o) => o.op === c.op)?.label ?? c.op;
  const value = field.kind === "enum" ? (field.options?.find((o) => o.value === c.value)?.label ?? c.value) : c.value;
  if (field.kind === "date") {
    const days = Number(c.value) === 1 ? "day" : "days";
    return t(
      `${field.label} ${op.replace(" (jours)", "")} ${value} jours`,
      c.op === "older_than_days"
        ? `${field.label} more than ${value} ${days} ago`
        : c.op === "within_days"
          ? `${field.label} in the last ${value} ${days}`
          : `${field.label} ${op.replace(" (days)", "")} ${value} ${days}`,
    );
  }
  return `${field.label} ${op} ${value}`;
}

export function describeRules(rules: SegmentRules): string {
  const sep = rules.match === "all" ? t(" et ", " and ") : t(" ou ", " or ");
  return rules.conditions.map(describeCondition).join(sep) || t("Tous les contacts", "All contacts");
}

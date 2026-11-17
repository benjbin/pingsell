import { OPS_BY_KIND, SEGMENT_FIELDS } from "../../lib/constants";
import type { SegmentCondition, SegmentRules } from "../../lib/types";

/** Human-readable French description of a condition, e.g. "Tags possède le tag vip". */
export function describeCondition(c: SegmentCondition): string {
  const field = SEGMENT_FIELDS[c.field];
  if (!field) return `${c.field} ${c.op} ${c.value}`;
  const op = OPS_BY_KIND[field.kind].find((o) => o.op === c.op)?.label ?? c.op;
  const value = field.kind === "enum" ? (field.options?.find((o) => o.value === c.value)?.label ?? c.value) : c.value;
  if (field.kind === "date") return `${field.label} ${op.replace(" (jours)", "")} ${value} jours`;
  return `${field.label} ${op} ${value}`;
}

export function describeRules(rules: SegmentRules): string {
  const sep = rules.match === "all" ? " et " : " ou ";
  return rules.conditions.map(describeCondition).join(sep) || "Tous les contacts";
}

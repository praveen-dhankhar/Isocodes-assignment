import { z } from "zod";
import type { DocType } from "../fields";
import type { ShipmentSnapshot } from "../snapshot";

// ARCHITECTURE §6.2; statuses and resolutions as in PRD §9 and the DB enums (ARCHITECTURE §4.2).
export const RuleId = z.enum(["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08"]);
export type RuleId = z.infer<typeof RuleId>;

/** PRD §9 rule names, as people read them. */
export const RULE_NAME: Record<RuleId, string> = {
  "CC-01": "Line totals",
  "CC-02": "Invoice total",
  "CC-03": "Gross weight",
  "CC-04": "Net weight",
  "CC-05": "Package count",
  "CC-06": "Line items",
  "CC-07": "Container numbers",
  "CC-08": "Invoice reference",
};

export const CheckResolution = z.enum(["DISCREPANCY_ACCEPTED", "QUERY_RAISED", "ACKNOWLEDGED_MISSING"]);
export type CheckResolution = z.infer<typeof CheckResolution>;

export type CheckStatus = "PASS" | "FAIL" | "INCOMPLETE" | "NOT_APPLICABLE";
export type CheckSeverity = "CRITICAL" | "WARNING" | "INFO";

export const PriorResolution = z.object({
  type: CheckResolution,
  fingerprint: z.string(),
  declaredValue: z.string().nullable(),
});
export type PriorResolution = z.infer<typeof PriorResolution>;

export interface ObservedValue {
  docType: DocType;
  fieldId: string | null;
  value: string | null;
  display: string;
}

export interface CheckOutcome {
  ruleId: RuleId;
  scope: string; // "shipment" | "line:2" | "pl-line:4"
  status: CheckStatus;
  severity: CheckSeverity;
  observed: ObservedValue[];
  delta: string | null;
  message: string;
  notes: string[];
  fingerprint: string; // set by runCrossChecks
  resolution: PriorResolution | null; // carried over only while the fingerprint is unchanged
}

/** A-04 and A-12. Money and weights as canonical decimal strings; similarity scores are ratios. */
export interface CheckConfig {
  moneyTolerance: string;
  weightToleranceKg: string;
  descriptionMatchMin: number;
  hsMatchBonus: number;
}

export interface CheckRule {
  id: RuleId;
  name: string;
  run(snapshot: ShipmentSnapshot, config: CheckConfig): CheckOutcome[];
}

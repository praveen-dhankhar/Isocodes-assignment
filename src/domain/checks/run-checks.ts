import type { ShipmentSnapshot } from "../snapshot";
import { invoiceTotal, lineTotals } from "./rules/amounts";
import { lineItemMatch } from "./rules/items";
import { grossWeight, netWeight, packageCount } from "./rules/quantities";
import { containerNumbers, invoiceReference } from "./rules/references";
import type { CheckConfig, CheckOutcome, CheckRule, CheckSeverity } from "./types";

/** Stored with every result; bump when any rule's behaviour changes. */
export const ENGINE_VERSION = "ce-1.0.0";

// Fixed order CC-01 → CC-08.
const RULES: readonly CheckRule[] = [
  lineTotals, invoiceTotal, grossWeight, netWeight, packageCount, lineItemMatch, containerNumbers, invoiceReference,
];

const SEVERITY_RANK: Record<CheckSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const naturalScope = (scope: string) => scope.replace(/\d+/g, (n) => n.padStart(6, "0")); // line:2 before line:10
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * ARCHITECTURE §6.3: run every rule, carry a prior resolution over only while its fingerprint is unchanged
 * (otherwise the check re-opens), and sort by severity, rule, scope for stable output.
 */
export function runCrossChecks(snapshot: ShipmentSnapshot, config: CheckConfig): CheckOutcome[] {
  return RULES.flatMap((rule) => rule.run(snapshot, config))
    .map((o) => {
      const prior = snapshot.priorResolutions[o.ruleId]?.[o.scope];
      return { ...o, resolution: prior?.fingerprint === o.fingerprint ? prior : null };
    })
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        compare(a.ruleId, b.ruleId) ||
        compare(naturalScope(a.scope), naturalScope(b.scope)),
    );
}

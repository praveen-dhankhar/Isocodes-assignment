import type { RuleId } from "../checks/types";
import type { DocType, FieldKey, FieldKind } from "../fields";

/** The value each check is about, and so what an accepted discrepancy declares (API_SPECS §5.2 acceptDiscrepancy). */
export const RULE_FIELD: Record<RuleId, { fieldKey: FieldKey; kind: FieldKind }> = {
  "CC-01": { fieldKey: "lineTotal", kind: "MONEY" },
  "CC-02": { fieldKey: "invoiceTotal", kind: "MONEY" },
  "CC-03": { fieldKey: "grossWeight", kind: "WEIGHT" },
  "CC-04": { fieldKey: "netWeight", kind: "WEIGHT" },
  "CC-05": { fieldKey: "totalPackages", kind: "INTEGER" },
  "CC-06": { fieldKey: "quantity", kind: "DECIMAL" },
  "CC-07": { fieldKey: "containerNumbers", kind: "CONTAINER_LIST" },
  "CC-08": { fieldKey: "invoiceNumber", kind: "IDENTIFIER" },
};

/** A-05: which document's value is filed when they differ. Anything not listed is invoice-level. */
export const PRECEDENCE: Partial<Record<FieldKey, readonly DocType[]>> = {
  grossWeight: ["BILL_OF_LADING", "PACKING_LIST", "INVOICE"],
  totalPackages: ["BILL_OF_LADING", "PACKING_LIST", "INVOICE"],
  netWeight: ["PACKING_LIST", "INVOICE", "BILL_OF_LADING"],
  containerNumbers: ["BILL_OF_LADING", "PACKING_LIST", "INVOICE"],
};
const INVOICE_FIRST: readonly DocType[] = ["INVOICE"];

/** The value an accepted discrepancy starts from: the observed value export precedence would file (A-05). */
export function declaredDefault(
  ruleId: RuleId,
  observed: ReadonlyArray<{ docType: DocType; fieldKey: string; value: string | null }>,
): { value: string; docType: DocType } | null {
  const { fieldKey } = RULE_FIELD[ruleId];
  for (const docType of PRECEDENCE[fieldKey] ?? INVOICE_FIRST) {
    const hit = observed.find((o) => o.docType === docType && o.fieldKey === fieldKey && o.value !== null);
    if (hit?.value) return { value: hit.value, docType };
  }
  return null;
}

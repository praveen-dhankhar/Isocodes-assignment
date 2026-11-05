import { DocType, HEADER_FIELDS, type FieldDef } from "../../fields";
import { D } from "../../money";
import { readyDocument, type ShipmentSnapshot } from "../../snapshot";
import { observe, outcome } from "../fingerprint";
import type { CheckOutcome, CheckRule, RuleId } from "../types";

const DOC_LABEL: Record<DocType, string> = {
  INVOICE: "Invoice",
  PACKING_LIST: "Packing list",
  BILL_OF_LADING: "Bill of lading",
};

/**
 * One header value across the extracted documents that carry it (ARCHITECTURE §6.3): a required value missing →
 * INCOMPLETE; fewer than two values → NOT_APPLICABLE; max − min above tolerance → FAIL with that delta.
 */
export function compareAcrossDocs(
  snapshot: ShipmentSnapshot,
  ruleId: RuleId,
  key: "grossWeight" | "netWeight" | "totalPackages",
  label: string,
  tolerance: string,
): CheckOutcome {
  const def: FieldDef = HEADER_FIELDS[key];
  const isWeight = def.kind === "WEIGHT";
  const unit = isWeight ? " kg" : "";
  const docs = DocType.options.flatMap((docType) => {
    const requirement = def.on[docType];
    const doc = requirement ? readyDocument(snapshot, docType) : undefined;
    return doc ? [{ docType, ref: doc.header[key], required: requirement === "R" }] : [];
  });

  const observed = docs.map((d) => observe(d.docType, d.ref, unit));
  const notes = docs.filter((d) => !d.required && d.ref?.value == null).map((d) => `${DOC_LABEL[d.docType]}: not stated`);
  const base = { ruleId, scope: "shipment", observed, notes };

  const missing = docs.filter((d) => d.required && d.ref?.value == null);
  if (missing.length > 0) {
    return outcome({ ...base, status: "INCOMPLETE", delta: null, message: `${label} missing on ${missing.map((d) => DOC_LABEL[d.docType]).join(", ")}` });
  }
  const present = observed.flatMap((o) => (o.value === null ? [] : [{ ...o, value: o.value }]));
  if (present.length < 2) {
    return outcome({ ...base, status: "NOT_APPLICABLE", delta: null, message: `Fewer than two documents state ${label.toLowerCase()}` });
  }

  const values = present.map((o) => new D(o.value));
  const delta = D.max(...values).minus(D.min(...values)).toFixed(isWeight ? 3 : 0);
  const [first, ...rest] = present.map((o) => `${DOC_LABEL[o.docType]} ${o.display}`);
  return new D(delta).lte(tolerance)
    ? outcome({ ...base, status: "PASS", delta, message: `${label} agrees: ${[first, ...rest].join(", ")}` })
    : outcome({ ...base, status: "FAIL", delta, message: `${label} differs: ${first} vs ${rest.join(", ")}` });
}

export const grossWeight: CheckRule = {
  id: "CC-03",
  name: "GROSS_WEIGHT",
  run: (snapshot, config) => [compareAcrossDocs(snapshot, "CC-03", "grossWeight", "Gross weight", config.weightToleranceKg)],
};

export const netWeight: CheckRule = {
  id: "CC-04",
  name: "NET_WEIGHT",
  run: (snapshot, config) => [compareAcrossDocs(snapshot, "CC-04", "netWeight", "Net weight", config.weightToleranceKg)],
};

/** A-04: package counts must match exactly. */
export const packageCount: CheckRule = {
  id: "CC-05",
  name: "PACKAGE_COUNT",
  run: (snapshot) => [compareAcrossDocs(snapshot, "CC-05", "totalPackages", "Total packages", "0")],
};

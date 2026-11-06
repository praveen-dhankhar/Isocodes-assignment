import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "./checks/config";
import { runCrossChecks } from "./checks/run-checks";
import { SCENARIOS, shp24811, shp24815, withValue } from "./checks/__fixtures__/snapshots";
import { computeBlockingIssues } from "./issues";
import type { ShipmentSnapshot } from "./snapshot";

const issuesOf = (snap: ShipmentSnapshot) => computeBlockingIssues(snap, runCrossChecks(snap, CHECK_CONFIG));
const types = (snap: ShipmentSnapshot) => issuesOf(snap).map((i) => i.type);

const edit = (change: (s: ShipmentSnapshot) => void, base = shp24811()) => {
  const snap = structuredClone(base);
  change(snap);
  return snap;
};
const accepted = () => {
  const cc03 = runCrossChecks(shp24811(), CHECK_CONFIG).find((r) => r.ruleId === "CC-03");
  return edit((s) => {
    s.priorResolutions = { "CC-03": { shipment: { type: "DISCREPANCY_ACCEPTED", fingerprint: cc03?.fingerprint ?? "", declaredValue: "3165.000" } } };
  });
};

describe("computeBlockingIssues (PRD §10.1)", () => {
  it.each<[string, ShipmentSnapshot, string[]]>([
    ["SHP-24811: the failed gross weight check", shp24811(), ["CHECK_FAILED"]],
    ["SHP-24812: nothing", SCENARIOS["SHP-24812"](), []],
    ["SHP-24815: bad container check and its low-confidence field", shp24815(), ["CHECK_FAILED", "FIELD_NEEDS_REVIEW"]],
    ["SHP-24816: a confirmed low-confidence date does not block", SCENARIOS["SHP-24816"](), []],
    ["accepted discrepancy", accepted(), []],
    ["query raised is not acceptance", edit((s) => {
      const fp = runCrossChecks(s, CHECK_CONFIG).find((r) => r.ruleId === "CC-03")?.fingerprint ?? "";
      s.priorResolutions = { "CC-03": { shipment: { type: "QUERY_RAISED", fingerprint: fp, declaredValue: null } } };
    }), ["CHECK_FAILED"]],
    ["slot empty", edit((s) => delete s.documents.BILL_OF_LADING), ["DOCUMENT_MISSING", "CHECK_FAILED"]],
    ["extraction failed", edit((s) => { if (s.documents.BILL_OF_LADING) s.documents.BILL_OF_LADING.status = "FAILED"; }), ["DOCUMENT_NOT_READY", "CHECK_FAILED"]],
    ["still extracting", edit((s) => { if (s.documents.INVOICE) s.documents.INVOICE.status = "EXTRACTING"; }), ["DOCUMENT_NOT_READY"]],
    ["wrong document in the slot", edit((s) => { if (s.documents.INVOICE) s.documents.INVOICE.detectedDocType = "PACKING_LIST"; }), ["WRONG_DOCUMENT_TYPE", "CHECK_FAILED"]],
    ["wrong type dismissed", edit((s) => { if (s.documents.INVOICE) Object.assign(s.documents.INVOICE, { detectedDocType: "OTHER", wrongTypeDismissed: true }); }), ["CHECK_FAILED"]],
    ["required value missing (confidence 0)", edit((s) => { const f = s.documents.INVOICE?.header.invoiceDate; if (f) Object.assign(f, { value: null, confidence: 0 }); }), ["CHECK_FAILED", "FIELD_NEEDS_REVIEW"]],
    ["optional field not printed (confidence 0) does not block", edit((s) => { const f = s.documents.BILL_OF_LADING?.header.netWeight; if (f) Object.assign(f, { value: null, confidence: 0 }); }), ["CHECK_FAILED"]],
    ["optional line cell not printed does not block", edit((s) => { const f = s.documents.INVOICE?.lines[0]?.cells.hsCode; if (f) Object.assign(f, { value: null, confidence: 0 }); }), ["CHECK_FAILED"]],
    ["low-confidence line cell", edit((s) => { const f = s.documents.INVOICE?.lines[0]?.cells.unitPrice; if (f) f.confidence = 0.6; }), ["CHECK_FAILED", "FIELD_NEEDS_REVIEW"]],
    ["incomplete check", withValue(shp24811(), "BILL_OF_LADING", "containerNumbers", null), ["CHECK_FAILED", "CHECK_INCOMPLETE"]],
    ["on hold", edit((s) => { s.status = "ON_HOLD"; }), ["CHECK_FAILED", "IMPORTER_QUERY_OPEN"]],
  ])("%s", (_, snap, expected) => {
    expect(types(snap)).toEqual(expected);
  });

  it("acknowledging a missing value clears the incomplete check", () => {
    const snap = withValue(shp24811(), "BILL_OF_LADING", "containerNumbers", null);
    const cc07 = runCrossChecks(snap, CHECK_CONFIG).find((r) => r.ruleId === "CC-07");
    snap.priorResolutions = { "CC-07": { shipment: { type: "ACKNOWLEDGED_MISSING", fingerprint: cc07?.fingerprint ?? "", declaredValue: null } } };
    expect(types(snap)).not.toContain("CHECK_INCOMPLETE");
  });

  it("points at what to fix", () => {
    const issues = issuesOf(shp24815());
    expect(issues).toEqual([
      {
        type: "CHECK_FAILED",
        ref: { ruleId: "CC-07", checkScope: "shipment" },
        label: "CC-07: XZQU4821254 on Bill of lading fails the ISO 6346 check digit; container numbers differ: Packing list XZQU4821253 vs Bill of lading XZQU4821254",
      },
      {
        type: "FIELD_NEEDS_REVIEW",
        ref: { documentId: "SHP-24815/BILL_OF_LADING", fieldId: "SHP-24815/BILL_OF_LADING/containerNumbers" },
        label: "Bill of lading: Container no(s). needs review",
      },
    ]);
  });

  it("labels document and line issues", () => {
    const snap = edit((s) => {
      delete s.documents.PACKING_LIST;
      const f = s.documents.INVOICE?.lines[0]?.cells.quantity;
      if (f) f.confidence = 0.5;
    });
    expect(issuesOf(snap).map((i) => i.label)).toEqual([
      "Packing list: not uploaded",
      "CC-03: Gross weight differs: Invoice 3,120.000 kg vs Bill of lading 3,165.000 kg",
      "Invoice line 1: Quantity needs review",
    ]);
  });
});

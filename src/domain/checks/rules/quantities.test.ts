import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "../config";
import { shp24811, shp24816, withValue } from "../__fixtures__/snapshots";
import type { CheckRule } from "../types";
import type { ShipmentSnapshot } from "../../snapshot";
import { grossWeight, netWeight, packageCount } from "./quantities";

const run = (rule: CheckRule, snap: ShipmentSnapshot) => {
  const outcomes = rule.run(snap, CHECK_CONFIG);
  expect(outcomes).toHaveLength(1);
  return outcomes[0]!;
};

const pl = (key: "grossWeight" | "totalPackages", value: string | null, snap = shp24811()) => withValue(snap, "PACKING_LIST", key, value);
const bl = (key: "grossWeight", value: string | null, snap: ShipmentSnapshot) => withValue(snap, "BILL_OF_LADING", key, value);
const withoutBl = () => {
  const snap = shp24811();
  delete snap.documents.BILL_OF_LADING;
  return snap;
};

describe("CC-03/04/05 compare across documents (PRD §9)", () => {
  it.each<[string, CheckRule, ShipmentSnapshot, string, string | null, string[]]>([
    // case, rule, snapshot, status, delta, notes
    ["SHP-24811 gross (brief)", grossWeight, shp24811(), "FAIL", "45.000", []],
    ["SHP-24811 net, BL silent", netWeight, shp24811(), "PASS", "0.000", ["Bill of lading: not stated"]],
    ["SHP-24811 packages", packageCount, shp24811(), "PASS", "0", []],
    ["SHP-24816 gross, LBS converted", grossWeight, shp24816(), "PASS", "0.001", ["Invoice: not stated"]],
    ["SHP-24816 net, only the PL", netWeight, shp24816(), "NOT_APPLICABLE", null, ["Invoice: not stated", "Bill of lading: not stated"]],
    ["0.5 kg apart is within tolerance", grossWeight, bl("grossWeight", "3120.000", pl("grossWeight", "3120.500")), "PASS", "0.500", []],
    ["0.501 kg apart fails", grossWeight, bl("grossWeight", "3120.000", pl("grossWeight", "3120.501")), "FAIL", "0.501", []],
    ["required PL gross missing", grossWeight, pl("grossWeight", null), "INCOMPLETE", null, []],
    ["one package apart fails", packageCount, pl("totalPackages", "241"), "FAIL", "1", []],
    ["optional invoice packages missing", packageCount, withValue(shp24811(), "INVOICE", "totalPackages", null), "PASS", "0", ["Invoice: not stated"]],
    ["BL not uploaded yet", grossWeight, withoutBl(), "FAIL", "45.000", []],
  ])("%s", (_, rule, snap, status, delta, notes) => {
    const o = run(rule, snap);
    expect([o.status, o.delta, o.notes]).toEqual([status, delta, notes]);
  });

  it("reads like the PRD worked example", () => {
    expect(run(grossWeight, shp24811()).message).toBe(
      "Gross weight differs: Invoice 3,120.000 kg vs Packing list 3,165.000 kg, Bill of lading 3,165.000 kg",
    );
  });

  it("observes every extracted document, null where not stated", () => {
    expect(run(netWeight, shp24811()).observed.map((o) => [o.docType, o.value, o.display])).toEqual([
      ["INVOICE", "2880.000", "2,880.000 kg"],
      ["PACKING_LIST", "2880.000", "2,880.000 kg"],
      ["BILL_OF_LADING", null, "not stated"],
    ]);
  });

  it("names the document missing a required value", () => {
    expect(run(grossWeight, pl("grossWeight", null)).message).toBe("Gross weight missing on Packing list");
  });

  it("ignores a document that is not extracted yet", () => {
    const snap = shp24811();
    if (snap.documents.BILL_OF_LADING) snap.documents.BILL_OF_LADING.status = "EXTRACTING";
    expect(run(grossWeight, snap).observed.map((o) => o.docType)).toEqual(["INVOICE", "PACKING_LIST"]);
  });
});

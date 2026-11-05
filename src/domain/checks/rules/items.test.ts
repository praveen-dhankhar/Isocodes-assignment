import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "../config";
import { shp24811, shp24812, shp24813, shp24814, withLines, withLineValue } from "../__fixtures__/snapshots";
import type { ShipmentSnapshot } from "../../snapshot";
import { lineItemMatch } from "./items";

const summary = (snap: ShipmentSnapshot) =>
  lineItemMatch.run(snap, CHECK_CONFIG).map((o) => [o.scope, o.status, o.delta, o.notes]);

const pl = (snap: ShipmentSnapshot, lines: Array<Record<string, string>>) => withLines(snap, "PACKING_LIST", lines);
const inv = (snap: ShipmentSnapshot, lines: Array<Record<string, string>>) => withLines(snap, "INVOICE", lines);
const invLine = (description: string, quantity: string) => ({ description, quantity, unitPrice: "1.00", lineTotal: quantity });

describe("CC-06 LINE_ITEM_MATCH (PRD §9, A-12)", () => {
  it.each<[string, ShipmentSnapshot, unknown[]]>([
    ["SHP-24811", shp24811(), [["line:1", "PASS", "0", []]]],
    ["SHP-24813, two lines", shp24813(), [["line:1", "PASS", "0", []], ["line:2", "PASS", "0", []]]],
    ["SHP-24814: 12,000 invoiced, 10,000 packed", shp24814(), [["line:1", "PASS", "0", []], ["line:2", "FAIL", "2000", []]]],
    [
      "packing list in another order",
      pl(shp24813(), [{ description: "Pump seal kit", quantity: "40", unit: "SET" }, { description: "Hydraulic gear pump 16cc", quantity: "40", unit: "PCS" }]),
      [["line:1", "PASS", "0", []], ["line:2", "PASS", "0", []]],
    ],
    [
      "best pair wins over first fit",
      pl(inv(shp24812(), [invLine("Steel ball valve DN50", "180"), invLine("Steel ball valve DN80", "60")]),
        [{ description: "Steel ball valve DN80", quantity: "60" }, { description: "Steel ball valve DN50", quantity: "180" }]),
      [["line:1", "PASS", "0", []], ["line:2", "PASS", "0", []]],
    ],
    ["punctuation and case ignored", pl(shp24811(), [{ description: "led panel-light, 40W", quantity: "2400" }]), [["line:1", "PASS", "0", []]]],
    ["unit differs", withLineValue(shp24811(), "PACKING_LIST", 1, "unit", "SET"), [["line:1", "FAIL", "0", []]]],
    ["unit only on one side", withLineValue(shp24811(), "PACKING_LIST", 1, "unit", null), [["line:1", "PASS", "0", []]]],
    [
      "extra packing-list line",
      pl(shp24811(), [{ description: "LED panel light 40W", quantity: "2400" }, { description: "Mounting bracket kit", quantity: "50" }]),
      [["line:1", "PASS", "0", []], ["pl-line:2", "FAIL", null, []]],
    ],
    [
      "invoice line not packed",
      pl(shp24813(), [{ description: "Hydraulic gear pump 16cc", quantity: "40", unit: "PCS" }]),
      [["line:1", "PASS", "0", []], ["line:2", "FAIL", null, []]],
    ],
    ["nothing similar, same count → by position", pl(shp24811(), [{ description: "Item A", quantity: "2400" }]), [["line:1", "PASS", "0", ["Matched by position"]]]],
    [
      "nothing similar, different counts → unmatched",
      pl(shp24811(), [{ description: "Item A", quantity: "1200" }, { description: "Item B", quantity: "1200" }]),
      [["line:1", "FAIL", null, []], ["pl-line:1", "FAIL", null, []], ["pl-line:2", "FAIL", null, []]],
    ],
    ["missing description pairs by position", withLineValue(shp24811(), "PACKING_LIST", 1, "description", null), [["line:1", "PASS", "0", ["Matched by position"]]]],
    ["invoice quantity missing", withLineValue(shp24811(), "INVOICE", 1, "quantity", null), [["line:1", "INCOMPLETE", null, []]]],
  ])("%s", (_, snap, expected) => {
    expect(summary(snap)).toEqual(expected);
  });

  it.each<[ShipmentSnapshot, string]>([
    [shp24814(), "Line 2 (USB-C receptacle 16P): quantity 12,000 on the invoice vs 10,000 on the packing list"],
    [withLineValue(shp24811(), "PACKING_LIST", 1, "unit", "SET"), "Line 1 (LED panel light 40W): unit PCS on the invoice vs SET on the packing list"],
    [pl(shp24813(), [{ description: "Hydraulic gear pump 16cc", quantity: "40" }]), "Line 2 (Pump seal kit): no matching packing-list line"],
    [withLineValue(shp24811(), "PACKING_LIST", 1, "quantity", null), "Line 1 (LED panel light 40W): quantity missing on the packing list"],
  ])("explains: %#", (snap, message) => {
    expect(lineItemMatch.run(snap, CHECK_CONFIG).map((o) => o.message)).toContain(message);
  });

  it("names an unmatched packing-list line", () => {
    const snap = pl(shp24811(), [{ description: "LED panel light 40W", quantity: "2400" }, { description: "Mounting bracket kit", quantity: "50" }]);
    expect(lineItemMatch.run(snap, CHECK_CONFIG)[1]?.message).toBe("Packing-list line 2 (Mounting bracket kit): no matching invoice line");
  });

  it("waits for both documents", () => {
    const snap = shp24811();
    delete snap.documents.PACKING_LIST;
    expect(lineItemMatch.run(snap, CHECK_CONFIG)).toEqual([]);
  });
});

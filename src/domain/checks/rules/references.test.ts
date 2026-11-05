import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "../config";
import { shp24811, shp24812, shp24815, withValue } from "../__fixtures__/snapshots";
import type { ShipmentSnapshot } from "../../snapshot";
import { containerNumbers, invoiceReference } from "./references";

const only = (snap: ShipmentSnapshot, rule = containerNumbers) => {
  const outcomes = rule.run(snap, CHECK_CONFIG);
  expect(outcomes).toHaveLength(1);
  return outcomes[0]!;
};
const set = (snap: ShipmentSnapshot, values: Partial<Record<"INVOICE" | "PACKING_LIST" | "BILL_OF_LADING", string | null>>) =>
  Object.entries(values).reduce((s, [docType, v]) => withValue(s, docType as "INVOICE", "containerNumbers", v ?? null), snap);

describe("CC-07 CONTAINER_NUMBERS (same set on every document, each passes ISO 6346)", () => {
  it.each<[string, ShipmentSnapshot, string, string[]]>([
    ["SHP-24811, all three agree", shp24811(), "PASS", []],
    ["SHP-24812", shp24812(), "PASS", []],
    ["SHP-24815: BL check digit wrong, PL differs", shp24815(), "FAIL", ["Invoice: not stated"]],
    ["BL missing its required number", set(shp24811(), { BILL_OF_LADING: null }), "INCOMPLETE", []],
    ["only the BL states one", set(shp24811(), { INVOICE: null, PACKING_LIST: null }), "NOT_APPLICABLE", ["Invoice: not stated", "Packing list: not stated"]],
    ["only the BL states one, and it is invalid", set(shp24811(), { INVOICE: null, PACKING_LIST: null, BILL_OF_LADING: "XZQU4821254" }), "FAIL", ["Invoice: not stated", "Packing list: not stated"]],
    ["same two containers everywhere", set(shp24811(), { INVOICE: "KQZU2073199|XZQU4821171", PACKING_LIST: "KQZU2073199|XZQU4821171", BILL_OF_LADING: "KQZU2073199|XZQU4821171" }), "PASS", []],
    ["packing list lists one of two", set(shp24811(), { INVOICE: null, BILL_OF_LADING: "KQZU2073199|XZQU4821171" }), "FAIL", ["Invoice: not stated"]],
  ])("%s", (_, snap, status, notes) => {
    const o = only(snap);
    expect([o.status, o.notes]).toEqual([status, notes]);
  });

  it("explains both problems on SHP-24815", () => {
    expect(only(shp24815()).message).toBe(
      "XZQU4821254 on Bill of lading fails the ISO 6346 check digit; container numbers differ: Packing list XZQU4821253 vs Bill of lading XZQU4821254",
    );
  });

  it("shows a container list readably", () => {
    const o = only(set(shp24811(), { INVOICE: null, PACKING_LIST: null, BILL_OF_LADING: "KQZU2073199|XZQU4821171" }));
    expect(o.observed.find((v) => v.docType === "BILL_OF_LADING")?.display).toBe("KQZU2073199, XZQU4821171");
  });
});

describe("CC-08 INVOICE_REFERENCE (packing list's invoice no. vs the invoice)", () => {
  const plRef = (value: string | null) => withValue(shp24811(), "PACKING_LIST", "invoiceNumber", value);

  it.each<[string, ShipmentSnapshot, string, string[]]>([
    ["SHP-24811", shp24811(), "PASS", []],
    ["case differs only", plRef("cb-2026-1187"), "PASS", []],
    ["different number", plRef("CB-2026-1188"), "FAIL", []],
    ["packing list silent", plRef(null), "NOT_APPLICABLE", ["Packing list: not stated"]],
    ["invoice number missing", withValue(shp24811(), "INVOICE", "invoiceNumber", null), "INCOMPLETE", []],
  ])("%s", (_, snap, status, notes) => {
    const o = only(snap, invoiceReference);
    expect([o.status, o.notes]).toEqual([status, notes]);
  });

  it("explains a mismatch", () => {
    expect(only(plRef("CB-2026-1188"), invoiceReference).message).toBe(
      "Packing list refers to invoice CB-2026-1188; the invoice is CB-2026-1187",
    );
  });
});

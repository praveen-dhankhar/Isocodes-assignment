import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "../config";
import { shp24811, shp24813, shp24814, withLines, withLineValue, withValue } from "../__fixtures__/snapshots";
import type { ShipmentSnapshot } from "../../snapshot";
import { invoiceTotal, lineTotals } from "./amounts";

const summary = (snap: ShipmentSnapshot, rule = lineTotals) =>
  rule.run(snap, CHECK_CONFIG).map((o) => [o.scope, o.status, o.delta]);

const line = (quantity: string, unitPrice: string, lineTotal: string) => ({ description: "Part", quantity, unitPrice, lineTotal });

describe("CC-01 LINE_TOTALS (quantity × unit price vs line total, |Δ| ≤ 0.01)", () => {
  it.each<[string, ShipmentSnapshot, unknown[]]>([
    ["SHP-24811 as printed", shp24811(), [["line:1", "PASS", "0.00"]]],
    ["SHP-24814: 12,000 × 0.085", shp24814(), [["line:1", "PASS", "0.00"], ["line:2", "PASS", "0.00"]]],
    ["0.01 off", withLineValue(shp24811(), "INVOICE", 1, "lineTotal", "16320.01"), [["line:1", "PASS", "0.01"]]],
    ["0.02 off", withLineValue(shp24811(), "INVOICE", 1, "lineTotal", "16320.02"), [["line:1", "FAIL", "0.02"]]],
    ["20.00 short", withLineValue(shp24811(), "INVOICE", 1, "lineTotal", "16300.00"), [["line:1", "FAIL", "20.00"]]],
    ["unit price missing", withLineValue(shp24811(), "INVOICE", 1, "unitPrice", null), [["line:1", "INCOMPLETE", null]]],
    ["no lines", withLines(shp24811(), "INVOICE", []), []],
  ])("%s", (_, snap, expected) => {
    expect(summary(snap)).toEqual(expected);
  });

  it("explains a failure with the arithmetic", () => {
    const [o] = lineTotals.run(withLineValue(shp24811(), "INVOICE", 1, "lineTotal", "16300.00"), CHECK_CONFIG);
    expect(o?.message).toBe("Line 1: 2,400 × 6.80 = 16,320.00, but the line total is 16,300.00");
  });

  it("names what is missing", () => {
    const [o] = lineTotals.run(withLineValue(shp24811(), "INVOICE", 1, "unitPrice", null), CHECK_CONFIG);
    expect(o?.message).toBe("Line 1: unit price missing");
  });
});

describe("CC-02 INVOICE_TOTAL (Σ round₂(quantity × unit price) vs invoice total, |Δ| ≤ 0.01)", () => {
  // Three lines of 1.005 each: rounded per line they sum to 3.03; unrounded to 3.015 (would fail).
  const roundingCase = withLines(withValue(shp24811(), "INVOICE", "invoiceTotal", "3.03"), "INVOICE", [
    line("1", "1.005", "1.01"), line("1", "1.005", "1.01"), line("1", "1.005", "1.01"),
  ]);

  it.each<[string, ShipmentSnapshot, unknown[]]>([
    ["SHP-24811", shp24811(), [["shipment", "PASS", "0.00"]]],
    ["SHP-24813, two lines", shp24813(), [["shipment", "PASS", "0.00"]]],
    ["SHP-24814, sub-cent unit price", shp24814(), [["shipment", "PASS", "0.00"]]],
    ["rounds each line to 2 dp before summing", roundingCase, [["shipment", "PASS", "0.00"]]],
    ["total 320.00 off", withValue(shp24811(), "INVOICE", "invoiceTotal", "16000.00"), [["shipment", "FAIL", "320.00"]]],
    ["total missing", withValue(shp24811(), "INVOICE", "invoiceTotal", null), [["shipment", "INCOMPLETE", null]]],
    ["a quantity missing", withLineValue(shp24811(), "INVOICE", 1, "quantity", null), [["shipment", "INCOMPLETE", null]]],
    ["no lines", withLines(shp24811(), "INVOICE", []), [["shipment", "INCOMPLETE", null]]],
  ])("%s", (_, snap, expected) => {
    expect(summary(snap, invoiceTotal)).toEqual(expected);
  });

  it.each<[ShipmentSnapshot, string]>([
    [withValue(shp24811(), "INVOICE", "invoiceTotal", "16000.00"), "Invoice total 16,000.00 differs from the sum of line amounts 16,320.00"],
    [withLines(shp24811(), "INVOICE", []), "No line items"],
    [withValue(shp24811(), "INVOICE", "invoiceTotal", null), "Invoice total missing"],
  ])("message: %#", (snap, message) => {
    expect(invoiceTotal.run(snap, CHECK_CONFIG)[0]?.message).toBe(message);
  });
});

it("CC-01 and CC-02 wait for the invoice to be extracted", () => {
  const snap = shp24811();
  if (snap.documents.INVOICE) snap.documents.INVOICE.status = "FAILED";
  expect([...lineTotals.run(snap, CHECK_CONFIG), ...invoiceTotal.run(snap, CHECK_CONFIG)]).toEqual([]);
});

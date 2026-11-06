import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shp24811, shp24814, withLineValue, withValue } from "../checks/__fixtures__/snapshots";
import { CHECK_CONFIG } from "../checks/config";
import { runCrossChecks } from "../checks/run-checks";
import type { ShipmentSnapshot } from "../snapshot";
import { buildExportRows, exportFileName, HEADER, toCsv, type ExportMasters } from "./csv";

const MASTERS: ExportMasters = { importer: { name: "Company P", iec: "TESTIEC001" }, supplier: { name: "Company B", countryCode: "CN" } };
const golden = readFileSync(path.join(__dirname, "__fixtures__/SHP-24811.cf1.csv"), "utf8");

/** SHP-24811 after review: the CC-03 discrepancy accepted, declaring 3,165.000 kg (API_SPECS §6.3). */
function reviewed24811(): ShipmentSnapshot {
  const snap = shp24811();
  const cc03 = runCrossChecks(snap, CHECK_CONFIG).find((o) => o.ruleId === "CC-03");
  return { ...snap, priorResolutions: { "CC-03": { shipment: { type: "DISCREPANCY_ACCEPTED", fingerprint: cc03?.fingerprint ?? "", declaredValue: "3165.000" } } } };
}
const csvOf = (snap: ShipmentSnapshot, masters = MASTERS) => toCsv(buildExportRows(snap, masters, runCrossChecks(snap, CHECK_CONFIG)));

describe("CF-1 export (API_SPECS §6)", () => {
  it("SHP-24811 matches the golden file byte for byte (BOM, CRLF)", () => {
    expect(csvOf(reviewed24811())).toBe(golden);
    expect(golden.startsWith("﻿SHIPMENT_REF,")).toBe(true);
    expect(golden.split("\r\n")).toHaveLength(3); // header, one line, trailing CRLF
  });

  it("uses export precedence without a declared value: gross weight from the B/L", () => {
    const rows = buildExportRows(shp24811(), MASTERS, runCrossChecks(shp24811(), CHECK_CONFIG));
    expect(rows[1]?.[HEADER.indexOf("GROSS_WT_KG")]).toBe("3165.000");
  });

  it("guards formula injection in text cells and quotes per RFC 4180", () => {
    const snap = withLineValue(reviewed24811(), "INVOICE", 1, "description", '=HYPERLINK("x")');
    const line = csvOf(snap).split("\r\n")[1] ?? "";
    expect(line).toContain(`,"'=HYPERLINK(""x"")",`);
    expect(toCsv([["a,b", "line\nbreak", "+1", "-2", "@x", "\tx", "plain"]])).toBe('﻿"a,b","line\nbreak",+1,-2,@x,\tx,plain\r\n'); // numbers are not text columns here
  });

  it("guards every text column, not numbers", () => {
    const snap = withValue(reviewed24811(), "INVOICE", "invoiceNumber", "-1+1");
    const cells = buildExportRows(snap, { ...MASTERS, importer: { name: "@Company", iec: "TESTIEC001" } }, runCrossChecks(snap, CHECK_CONFIG))[1] ?? [];
    expect(cells[HEADER.indexOf("INVOICE_NO")]).toBe("'-1+1");
    expect(cells[HEADER.indexOf("IMPORTER_NAME")]).toBe("'@Company");
    expect(cells[HEADER.indexOf("QUANTITY")]).toBe("2400");
  });

  it("formats money in the currency's minor units: JPY has none", () => {
    let snap = withValue(reviewed24811(), "INVOICE", "currency", "JPY");
    snap = withValue(snap, "INVOICE", "invoiceTotal", "1050000");
    snap = withLineValue(snap, "INVOICE", 1, "lineTotal", "1050000");
    const cells = buildExportRows(snap, MASTERS, runCrossChecks(snap, CHECK_CONFIG))[1] ?? [];
    expect(cells[HEADER.indexOf("INVOICE_VALUE")]).toBe("1050000");
    expect(cells[HEADER.indexOf("ITEM_VALUE")]).toBe("1050000");
    expect(cells[HEADER.indexOf("UNIT_PRICE")]).toBe("6.80"); // as printed
  });

  it("one row per invoice line; a declared line quantity overrides that line only", () => {
    const snap = shp24814();
    const cc06 = runCrossChecks(snap, CHECK_CONFIG).find((o) => o.ruleId === "CC-06" && o.scope === "line:2");
    const resolved = { ...snap, priorResolutions: { "CC-06": { "line:2": { type: "DISCREPANCY_ACCEPTED" as const, fingerprint: cc06?.fingerprint ?? "", declaredValue: "10000" } } } };
    const rows = buildExportRows(resolved, MASTERS, runCrossChecks(resolved, CHECK_CONFIG));
    expect(rows.map((r) => r[HEADER.indexOf("ITEM_SR_NO")])).toEqual(["ITEM_SR_NO", "1", "2"]);
    expect(rows.map((r) => r[HEADER.indexOf("QUANTITY")])).toEqual(["QUANTITY", "5000", "10000"]);
  });

  it("names the file ref_invoice_CF1_<IST time>, with unsafe characters replaced", () => {
    expect(exportFileName("SHP-24811", "CB-2026-1187", new Date("2026-11-08T09:02:00Z"))).toBe("SHP-24811_CB-2026-1187_CF1_20261108-1432.csv");
    expect(exportFileName("SHP-24811", "INV/26 #4", new Date("2026-11-08T09:02:00Z"))).toBe("SHP-24811_INV_26__4_CF1_20261108-1432.csv");
  });
});

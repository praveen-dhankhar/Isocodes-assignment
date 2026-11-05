import { describe, expect, it } from "vitest";
import { findEvidence, type TextItem } from "./evidence";
import type { FieldKind } from "./fields";

const box = (n: number) => ({ x: n / 10, y: 0.1, w: 0.1, h: 0.02 });
const page: TextItem[] = [
  { str: "Total: USD 16,320.00", box: box(0) },
  { str: "Gross weight 3,120.00 KGS", box: box(1) },
  { str: "Company B Lighting Co.", box: box(2) },
  { str: "XZQU 482117 1", box: box(3) },
  { str: "14/10/2026", box: box(4) },
  { str: "US$", box: box(5) },
  { str: "2,204.62 LBS", box: box(6) },
  { str: "Pune", box: box(7) },
  { str: "Maharashtra", box: box(8) },
];

describe("findEvidence (ARCHITECTURE §7.3)", () => {
  it.each<[string, FieldKind, string, ReturnType<typeof findEvidence>]>([
    // case, kind, raw text as printed, result
    ["money as printed", "MONEY", "16,320.00", { evidence: "FOUND", box: box(0) }],
    ["money, numerically equal", "MONEY", "16320", { evidence: "FOUND", box: box(0) }],
    ["money not on the page", "MONEY", "16,230.00", { evidence: "NOT_FOUND" }],
    ["weight number, unit aside", "WEIGHT", "3,120 KGS", { evidence: "FOUND", box: box(1) }],
    ["weight printed in pounds", "WEIGHT", "2,204.62 LBS", { evidence: "FOUND", box: box(6) }],
    ["integer not on the page", "INTEGER", "240 CTNS", { evidence: "NOT_FOUND" }],
    ["text, case and spacing ignored", "TEXT", "company  b lighting", { evidence: "FOUND", box: box(2) }],
    ["text across two items, no single box", "TEXT", "Pune Maharashtra", { evidence: "FOUND", box: null }],
    ["date as printed", "DATE", "14/10/2026", { evidence: "FOUND", box: box(4) }],
    ["currency symbol as printed", "CURRENCY", "US$", { evidence: "FOUND", box: box(5) }],
    ["container printed with spaces", "CONTAINER_LIST", "XZQU4821171", { evidence: "FOUND", box: box(3) }],
    ["every container must appear", "CONTAINER_LIST", "XZQU4821171 / KQZU2073199", { evidence: "NOT_FOUND" }],
    ["text not on the page", "IDENTIFIER", "CB-2026-1187", { evidence: "NOT_FOUND" }],
  ])("%s", (_, kind, rawText, expected) => {
    expect(findEvidence(kind, rawText, page, ".")).toEqual(expected);
  });

  it("reads numbers with the document's separator", () => {
    const european: TextItem[] = [{ str: "Summe 7.650,00 EUR", box: box(0) }];
    expect(findEvidence("MONEY", "7.650,00", european, ",")).toEqual({ evidence: "FOUND", box: box(0) });
  });

  it("has nothing to check on a scan", () => {
    expect(findEvidence("MONEY", "16,320.00", null, ".")).toEqual({ evidence: "NO_TEXT_LAYER" });
  });
});

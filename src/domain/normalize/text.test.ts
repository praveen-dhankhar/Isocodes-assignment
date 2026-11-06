import { describe, expect, it } from "vitest";
import { identifierKey, normalizeText, normalizeUnit } from "./text";

describe("normalizeText (TEXT, IDENTIFIER)", () => {
  it.each<[string, string | null]>([
    ["  Company   B\n Ltd ", "Company B Ltd"],
    ["CB-2026-1187", "CB-2026-1187"],
    ["   ", null],
    ["", null],
    // Spaces between CJK characters carry no meaning (bilingual invoices; a model may insert them).
    ["Solar charge controller 40A / 太阳能 控制器", "Solar charge controller 40A / 太阳能控制器"],
    ["太阳 能  控制器", "太阳能控制器"],
    ["40A 太阳能", "40A 太阳能"], // Latin and CJK stay separated
    ["ベアリング 6205", "ベアリング 6205"],
    ["태양광 컨트롤러", "태양광 컨트롤러"], // Korean spaces its words
  ])("%j → %j", (text, value) => {
    expect(normalizeText(text)).toBe(value);
  });

  it("compares identifiers in uppercase", () => {
    expect(identifierKey("cb-2026-1187")).toBe(identifierKey("CB-2026-1187"));
  });
});

describe("normalizeUnit (PRD §7, A-21)", () => {
  it.each<[string, string | null]>([
    ["pcs", "PCS"],
    ["Pieces", "PCS"],
    ["PC", "PCS"],
    ["Nos.", "NOS"],
    ["SETS", "SET"],
    ["kg", "KGS"],
    ["KGM", "KGS"],
    ["MTR", "MTR"],
    ["meters", "MTR"],
    ["Pairs", "PRS"],
    ["KITS", "KITS"],
    [" ctns ", "CTNS"],
    ["", null],
  ])("%j → %j", (text, value) => {
    expect(normalizeUnit(text)).toBe(value);
  });
});

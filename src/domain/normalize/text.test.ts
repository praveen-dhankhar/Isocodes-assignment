import { describe, expect, it } from "vitest";
import { identifierKey, normalizeText, normalizeUnit } from "./text";

describe("normalizeText (TEXT, IDENTIFIER)", () => {
  it.each<[string, string | null]>([
    ["  Company   B\n Ltd ", "Company B Ltd"],
    ["CB-2026-1187", "CB-2026-1187"],
    ["   ", null],
    ["", null],
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

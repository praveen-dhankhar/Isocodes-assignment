import { describe, expect, it } from "vitest";
import { formatDecimal, formatFieldValue } from "./format";

describe("formatFieldValue", () => {
  it.each([
    ["WEIGHT", "3120.000", "3,120.000"],
    ["MONEY", "1050000", "10,50,000"],
    ["MONEY", "16320.00", "16,320.00"],
    ["DATE", "2026-10-14", "14 Oct 2026"],
    ["HS_CODE", "94054290", "9405.42.90"],
    ["HS_CODE", "940542", "940542"],
    ["CONTAINER_LIST", "XZQU4821171|XZQU4821189", "XZQU4821171, XZQU4821189"],
    ["TEXT", "Company B", "Company B"],
  ] as const)("%s %s → %s", (kind, value, expected) => {
    expect(formatFieldValue(kind, value)).toBe(expected);
  });

  it("leaves null empty and non-canonical numbers as they are", () => {
    expect(formatFieldValue("WEIGHT", null)).toBe("");
    expect(formatDecimal("3.120,0O")).toBe("3.120,0O");
  });
});

import { describe, expect, it } from "vitest";
import { D } from "../money";
import type { DecimalSeparator } from "./number";
import { parseWeightKg } from "./weight";

describe("parseWeightKg (PRD §7: kg, 3 dp)", () => {
  it.each<[string, DecimalSeparator | null, string, boolean, boolean]>([
    // text, document separator, kg, unitAssumed, ambiguous
    ["3,120.00 KGS", ".", "3120.000", false, false],
    ["1.460,00 kg", ",", "1460.000", false, false],
    ["1,000 KGS", ".", "1000.000", false, false],
    ["3165", null, "3165.000", true, false],
    ["K.G. 450", ".", "450.000", false, false],
    ["2,880 KGM", ".", "2880.000", false, false],
    ["3.2 MT", ".", "3200.000", false, false],
    ["12.5 TONNES", ".", "12500.000", false, false],
    ["1 TON", null, "1000.000", false, false],
    ["100 LB", ".", "45.359", false, false],
    ["1.0005 KGS", ".", "1.001", false, false],
    ["3,120KGS (6,878.43 LBS)", ".", "3120.000", false, false],
    ["3,165 KGS", null, "3165.000", false, true],
  ])("%j on a %j document → %s kg", (text, sep, kg, unitAssumed, ambiguous) => {
    expect(parseWeightKg(text, sep)).toEqual({ kg, unitAssumed, ambiguous });
  });

  it("converts 2,204.62 LBS to 1000.000 kg (±0.001)", () => {
    const kg = parseWeightKg("2,204.62 LBS", ".")?.kg ?? "";
    expect(kg).toBe("999.999");
    expect(new D(kg).minus(1000).abs().lte("0.001")).toBe(true);
  });

  it("does not read units inside other words", () => {
    expect(parseWeightKg("240 CARTONS 3120", ".")).toEqual({ kg: "240.000", unitAssumed: true, ambiguous: false });
  });

  it.each(["N/A", "", "KGS"])("returns null for %j", (text) => {
    expect(parseWeightKg(text, ".")).toBeNull();
  });
});

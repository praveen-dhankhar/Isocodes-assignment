import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectDecimalSeparator, parseDecimal, type DecimalSeparator } from "./number";

describe("detectDecimalSeparator (A-09)", () => {
  it.each<[string, string[], DecimalSeparator | null]>([
    ["SHP-24811 invoice", ["3,120.00 KGS", "16,320.00", "US$ 6.80", "2,400 PCS"], "."],
    ["SHP-24812 invoice", ["42,50", "7.650,00", "1.460,00 kg"], ","],
    ["LBS packing list", ["2,204.62 LBS"], "."],
    ["space grouping", ["1 460,00"], ","],
    ["repeated commas are grouping", ["1,234,567"], "."],
    ["repeated dots are grouping", ["1.234.567"], ","],
    ["leading zero can't be a group", ["0,850"], ","],
    ["four leading digits can't be a group", ["3165.000"], "."],
    ["integers only", ["240", "6"], null],
    ["only a lone 3-digit group", ["1,460", "240 CTNS"], null],
    ["evidence tied", ["6.80", "42,50"], null],
    ["no text", [], null],
    ["no numbers", ["USD", "Ningbo"], null],
    ["majority wins", ["6.80", "16,320.00", "42,50"], "."],
  ])("%s", (_, texts, expected) => {
    expect(detectDecimalSeparator(texts)).toBe(expected);
  });
});

describe("parseDecimal (PRD §7)", () => {
  it.each<[string, DecimalSeparator | null, string | null, boolean]>([
    // text, document separator, canonical value, ambiguous
    ["16,320.00", ".", "16320.00", false],
    ["US$ 6.80", ".", "6.80", false],
    ["16320.00 USD", ".", "16320.00", false],
    ["7.650,00", ",", "7650.00", false],
    ["€ 42,50", ",", "42.50", false],
    ["1.460,00", ",", "1460.00", false],
    ["1 460,00", ",", "1460.00", false],
    ["1,234,567.891", ".", "1234567.891", false],
    ["1.234.567", ",", "1234567", false],
    ["12,34,567.50", ".", "1234567.50", false],
    ["-45.000", ".", "-45.000", false],
    ["0007", ".", "7", false],
    ["2400", null, "2400", false],
    // A lone separator followed by three digits.
    ["1,460", ",", "1.460", true],
    ["1,460", ".", "1460", false],
    ["1.460", ",", "1460", false],
    ["1.460", ".", "1.460", false],
    ["1,460", null, "1460", true],
    ["1.460", null, "1.460", true],
    // A value that contradicts its document's format.
    ["6.80", ",", "6.80", true],
    ["0.850", ",", "0.850", true],
    // Nothing usable.
    ["USD", ".", null, false],
    ["", ".", null, false],
    ["1.460,00,5", ",", null, false],
  ])("%j on a %j document → %j", (text, sep, value, ambiguous) => {
    const parsed = parseDecimal(text, sep);
    if (value === null) expect(parsed).toBeNull();
    else expect(parsed).toEqual({ value, ambiguous });
  });

  // Canonical → printed (en or eu style) → parsed gives the canonical back.
  const canonical = fc
    .tuple(fc.bigInt({ min: 0n, max: 10n ** 18n }), fc.integer({ min: 0, max: 4 }), fc.boolean())
    .map(([n, scale, neg]) => {
      const digits = n.toString().padStart(scale + 1, "0");
      const int = digits.slice(0, digits.length - scale);
      const frac = digits.slice(digits.length - scale);
      return { neg: neg && n > 0n, int, frac };
    });
  const print = (c: { neg: boolean; int: string; frac: string }, group: string, dec: string) =>
    (c.neg ? "-" : "") + c.int.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (c.frac ? dec + c.frac : "");

  it("round-trips dot-decimal documents", () => {
    fc.assert(
      fc.property(canonical, (c) => {
        expect(parseDecimal(print(c, ",", "."), ".")?.value).toBe(print(c, "", "."));
      }),
    );
  });

  it("round-trips comma-decimal documents", () => {
    fc.assert(
      fc.property(canonical, (c) => {
        expect(parseDecimal(print(c, ".", ","), ",")?.value).toBe(print(c, "", "."));
      }),
    );
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { iso6346Valid, parseContainerList, parseHsCode } from "./codes";

describe("parseHsCode (PRD §7, A-11)", () => {
  it.each<[string, string, boolean]>([
    ["9405.42.90", "94054290", true],
    ["9405 42 90", "94054290", true],
    ["HS: 940542", "940542", true],
    ["8471.30.0100", "8471300100", true],
    ["94054", "94054", false],
    ["94054290123", "94054290123", false],
  ])("%j → %s (valid %s)", (text, value, valid) => {
    expect(parseHsCode(text)).toEqual({ value, valid });
  });

  it.each(["N/A", ""])("returns null for %j", (text) => {
    expect(parseHsCode(text)).toBeNull();
  });
});

describe("iso6346Valid", () => {
  // Every container in API_SPECS §7.2; XZQU4821254 is the deliberate bad check digit (SHP-24815).
  it.each([
    "XZQU4821171", "KQZU2073199", "ZXKU7310049", "QZXU5609317", "XZQU4821253",
    "KQZU2074003", "ZXKU7311220", "QZXU5610072", "XZQU9002130",
  ])("accepts %s", (code) => {
    expect(iso6346Valid(code)).toBe(true);
  });

  it.each([
    ["XZQU4821254", "wrong check digit"],
    ["XZQA4821171", "category must be U, J or Z"],
    ["xzqu4821171", "lowercase"],
    ["XZQU482117", "too short"],
    ["XZQU48211710", "too long"],
  ])("rejects %s (%s)", (code) => {
    expect(iso6346Valid(code)).toBe(false);
  });

  // Reference: letter values read off the ISO 6346 table, multiples of 11 skipped.
  const TABLE = "0123456789A_BCDEFGHIJK_LMNOPQRSTU_VWXYZ";
  const referenceCheckDigit = (first10: string) =>
    ([...first10].reduce((sum, ch, i) => sum + TABLE.indexOf(ch) * 2 ** i, 0) % 11) % 10;
  const first10 = fc
    .tuple(
      fc.string({ unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"), minLength: 3, maxLength: 3 }),
      fc.constantFrom("U", "J", "Z"),
      fc.string({ unit: fc.constantFrom(..."0123456789"), minLength: 6, maxLength: 6 }),
    )
    .map((parts) => parts.join(""));

  it("agrees with the reference on every check digit", () => {
    fc.assert(
      fc.property(first10, fc.integer({ min: 0, max: 9 }), (prefix, digit) => {
        expect(iso6346Valid(`${prefix}${digit}`)).toBe(digit === referenceCheckDigit(prefix));
      }),
    );
  });
});

describe("parseContainerList (PRD §7)", () => {
  it.each<[string, string, string[]]>([
    ["KQZU2073199 / xzqu 482117-1", "KQZU2073199|XZQU4821171", []],
    ["XZQU4821171, XZQU4821171", "XZQU4821171", []],
    ["XZQU4821254", "XZQU4821254", ["XZQU4821254"]],
    ["ABCD1234567 KQZU2073199", "ABCD1234567|KQZU2073199", ["ABCD1234567"]],
  ])("%j → %s", (text, value, invalid) => {
    expect(parseContainerList(text)).toEqual({ value, invalid });
  });

  it.each(["N/A", "", "SEAL 123456"])("returns null for %j", (text) => {
    expect(parseContainerList(text)).toBeNull();
  });
});

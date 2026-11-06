import { describe, expect, it } from "vitest";
import type { FieldKind } from "../fields";
import { normalizeField, normalizeTyped, type NormalizeContext } from "./field";

const dot: NormalizeContext = { separator: ".", supplierCountry: "CN" };
const comma: NormalizeContext = { separator: ",", supplierCountry: "SE" };
const us: NormalizeContext = { separator: ".", supplierCountry: "US" };

describe("normalizeField (PRD §7, by kind)", () => {
  it.each<[FieldKind, string, NormalizeContext, string | null, Partial<{ formatValid: boolean; ambiguous: boolean; unitAssumed: boolean }>]>([
    // kind, printed text, context, canonical value, flags (others false / valid)
    ["TEXT", "  Company   B ", dot, "Company B", {}],
    ["IDENTIFIER", "CB-2026-1187", dot, "CB-2026-1187", {}],
    ["DATE", "14/10/2026", dot, "2026-10-14", {}],
    ["DATE", "03/04/2026", us, "2026-03-04", { ambiguous: true }],
    ["DATE", "31/02/2026", dot, null, { formatValid: false }],
    ["CURRENCY", "US$", dot, "USD", {}],
    ["CURRENCY", "Dollars", dot, null, { formatValid: false }],
    ["INCOTERM", "C&F Nhava Sheva", dot, "CFR", {}],
    ["INCOTERM", "DAT", dot, null, { formatValid: false }],
    ["MONEY", "16,320.00", dot, "16320.00", {}],
    ["MONEY", "7.650,00", comma, "7650.00", {}],
    ["MONEY", "1,460", comma, "1.460", { ambiguous: true }],
    ["MONEY", "n/a", dot, null, { formatValid: false }],
    ["DECIMAL", "2,400", dot, "2400", {}],
    ["INTEGER", "240 CTNS", dot, "240", {}],
    ["INTEGER", "12.5", dot, null, { formatValid: false }],
    ["WEIGHT", "3,120.00 KGS", dot, "3120.000", {}],
    ["WEIGHT", "3165", dot, "3165.000", { unitAssumed: true }],
    ["WEIGHT", "2,204.62 LBS", dot, "999.999", {}],
    ["CONTAINER_LIST", "KQZU2073199, XZQU4821171", dot, "KQZU2073199|XZQU4821171", {}],
    ["CONTAINER_LIST", "XZQU4821254", dot, "XZQU4821254", { formatValid: false }],
    ["HS_CODE", "9405.42.90", dot, "94054290", {}],
    ["HS_CODE", "94054", dot, "94054", { formatValid: false }],
    ["UNIT", "Pieces", dot, "PCS", {}],
    ["UNIT", "KITS", dot, "KITS", {}],
  ])("%s %j → %j", (kind, text, ctx, value, flags) => {
    expect(normalizeField(kind, text, ctx)).toEqual({ value, formatValid: true, ambiguous: false, unitAssumed: false, ...flags });
  });

  it("treats blank text as no value", () => {
    expect(normalizeField("TEXT", "   ", dot)).toEqual({ value: null, formatValid: false, ambiguous: false, unitAssumed: false });
  });
});

describe("normalizeTyped (a value a person types: every character must belong to it)", () => {
  const ctx: NormalizeContext = { separator: ".", supplierCountry: "CN" };
  it.each<[FieldKind, string, string | null]>([
    ["WEIGHT", "3,165.00 KGS", "3165.000"],
    ["WEIGHT", "3165", "3165.000"],
    ["WEIGHT", "2,204.62 lbs", "999.999"],
    ["WEIGHT", "3.120,0O", null], // letter O for zero
    ["WEIGHT", "12O", null],
    ["WEIGHT", "3120 kg 45", null], // two numbers
    ["WEIGHT", "about 3120", null],
    ["MONEY", "USD 16,320.00", "16320.00"],
    ["MONEY", "$16,320.00", "16320.00"],
    ["MONEY", "16,32O.00", null],
    ["DECIMAL", "2,400 PCS", "2400"],
    ["DECIMAL", "2,4OO", null],
    ["INTEGER", "240 CTNS", "240"],
    ["INTEGER", "24O", null],
    ["TEXT", "Company B", "Company B"],
    ["CONTAINER_LIST", "XZQU4821171", "XZQU4821171"],
  ])("%s %s → %s", (kind, text, expected) => {
    expect(normalizeTyped(kind, text, ctx).value).toBe(expected);
  });

  it("a rejected value is marked invalid", () => {
    expect(normalizeTyped("WEIGHT", "3.120,0O", ctx)).toMatchObject({ value: null, formatValid: false });
  });
});

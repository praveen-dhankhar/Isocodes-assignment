import { describe, expect, it } from "vitest";
import { parseCurrency } from "./currency";

describe("parseCurrency (PRD §7, ISO 4217)", () => {
  it.each<[string, string | null, string | null]>([
    // text, supplier country, ISO code
    ["US$", null, "USD"],
    ["$", null, "USD"],
    ["US Dollars", null, "USD"],
    ["€", "SE", "EUR"],
    ["Euro", null, "EUR"],
    ["RMB", "CN", "CNY"],
    ["RMB", null, "CNY"],
    ["¥", "CN", "CNY"],
    ["￥", "CN", "CNY"],
    ["¥", "JP", "JPY"],
    ["¥", "US", null],
    ["USD", null, "USD"],
    ["usd", null, "USD"],
    ["EUR 7.650,00", "SE", "EUR"],
    ["JPY", "JP", "JPY"],
    ["HK$", null, "HKD"],
    ["S$", null, "SGD"],
    ["ZZ$", null, null],
    ["£", null, "GBP"],
    ["₹", null, "INR"],
    ["XYZ", null, null],
    ["XXX", null, null],
    ["Dollars", null, null],
    ["", null, null],
  ])("%j (%s supplier) → %s", (text, country, code) => {
    expect(parseCurrency(text, country)).toBe(code);
  });
});

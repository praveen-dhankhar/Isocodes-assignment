import { describe, expect, it } from "vitest";
import { formatDecimal } from "./num";

describe("formatDecimal (en-IN, A-15)", () => {
  it.each([
    ["3120.000", "3,120.000"],
    ["16320.00", "16,320.00"],
    ["2400", "2,400"],
    ["0.85", "0.85"],
    ["-45.000", "-45.000"],
    ["1234567.50", "12,34,567.50"],
    // Beyond float precision: proves the value never becomes a JS number.
    ["123456789012345678.99", "1,23,45,67,89,01,23,45,678.99"],
    // Not a canonical decimal: shown as stored, never as "NaN".
    ["n/a", "n/a"],
  ])("%s → %s", (input, expected) => {
    expect(formatDecimal(input)).toBe(expected);
  });
});

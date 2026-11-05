import { describe, expect, it } from "vitest";
import { formatEnIn } from "./money";

describe("formatEnIn (A-15, no runtime locale)", () => {
  it.each([
    ["3120.000", "3,120.000"],
    ["16320.00", "16,320.00"],
    ["999.999", "999.999"],
    ["0.085", "0.085"],
    ["240", "240"],
    ["1234567.50", "12,34,567.50"],
    ["-45.000", "-45.000"],
    ["123456789012345678.99", "1,23,45,67,89,01,23,45,678.99"],
    ["n/a", "n/a"],
  ])("%s → %s", (value, expected) => {
    expect(formatEnIn(value)).toBe(expected);
  });
});

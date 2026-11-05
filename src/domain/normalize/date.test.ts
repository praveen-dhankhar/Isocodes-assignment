import { describe, expect, it } from "vitest";
import { parseDate } from "./date";

describe("parseDate (PRD §7, A-10)", () => {
  it.each<[string, string | null, string, boolean]>([
    // text, supplier country, ISO date, ambiguousDate
    ["14/10/2026", "CN", "2026-10-14", false],
    ["03/04/2026", "US", "2026-03-04", true],
    ["03/04/2026", "CN", "2026-04-03", true],
    ["03/04/2026", null, "2026-04-03", true],
    ["05/05/2026", "US", "2026-05-05", false],
    ["10/14/2026", "US", "2026-10-14", false],
    ["10/14/2026", "CN", "2026-10-14", false],
    ["14-10-2026", "CN", "2026-10-14", false],
    ["14.10.2026", "SE", "2026-10-14", false],
    ["2026-10-14", "US", "2026-10-14", false],
    ["2026/4/3", "US", "2026-04-03", false],
    ["Date: 14/10/2026", "CN", "2026-10-14", false],
    ["14 Oct 2026", "CN", "2026-10-14", false],
    ["14-Oct-2026", "CN", "2026-10-14", false],
    ["14th October 2026", "CN", "2026-10-14", false],
    ["Oct 14, 2026", "US", "2026-10-14", false],
    ["October 14 2026", "US", "2026-10-14", false],
    ["Sept 3, 2026", "US", "2026-09-03", false],
    ["29/02/2028", "CN", "2028-02-29", false],
  ])("%j (%s supplier) → %s", (text, country, value, ambiguous) => {
    expect(parseDate(text, country)).toEqual({ value, ambiguous });
  });

  it.each([
    ["31/02/2026", "no 31 February"],
    ["29/02/2026", "not a leap year"],
    ["29/02/2100", "century, not a leap year"],
    ["31/04/2026", "April has 30 days"],
    ["13/13/2026", "no month 13"],
    ["02/31/2026", "only reading is 31 February"],
    ["14 Foo 2026", "unknown month"],
    ["2026", "year only"],
    ["", "empty"],
  ])("rejects %j (%s)", (text) => {
    expect(parseDate(text, "CN")).toBeNull();
  });
});

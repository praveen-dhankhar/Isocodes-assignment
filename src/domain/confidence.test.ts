import { describe, expect, it } from "vitest";
import { applyConfidencePolicy, needsReview, type FieldFacts } from "./confidence";

const facts = (overrides: Partial<FieldFacts> = {}): FieldFacts => ({
  hasValue: true,
  required: true,
  formatValid: true,
  ambiguous: false,
  unitAssumed: false,
  evidence: "FOUND",
  page: { readable: true, issues: [] },
  ...overrides,
});

describe("applyConfidencePolicy (PRD §8.1)", () => {
  it.each<[string, number, Partial<FieldFacts>, number, string[]]>([
    // case, model, facts, final, cap reasons
    ["clean digital value", 0.97, {}, 0.97, []],
    ["format invalid", 0.97, { formatValid: false }, 0.4, ["FORMAT_INVALID"]],
    ["required and missing", 0.97, { hasValue: false }, 0, ["REQUIRED_MISSING"]],
    ["optional and missing", 0.97, { hasValue: false, required: false }, 0.97, []],
    ["page unreadable", 0.97, { page: { readable: false, issues: [] } }, 0, ["PAGE_UNREADABLE"]],
    ["ambiguous parse", 0.97, { ambiguous: true }, 0.6, ["AMBIGUOUS_PARSE"]],
    ["not in the PDF text", 0.97, { evidence: "NOT_FOUND" }, 0.7, ["EVIDENCE_NOT_FOUND"]],
    ["unit assumed", 0.97, { unitAssumed: true }, 0.8, ["UNIT_ASSUMED"]],
    ["blurry page", 0.97, { page: { readable: true, issues: ["BLURRY"] } }, 0.8, ["PAGE_QUALITY"]],
    ["skewed page is no cap", 0.97, { page: { readable: true, issues: ["SKEWED"] } }, 0.97, []],
    ["scan", 0.99, { evidence: "NO_TEXT_LAYER" }, 0.95, ["NO_TEXT_LAYER"]],
    ["model already lower than the cap", 0.5, { evidence: "NO_TEXT_LAYER" }, 0.5, ["NO_TEXT_LAYER"]],
    ["several caps: lowest wins", 0.97, { ambiguous: true, evidence: "NOT_FOUND", unitAssumed: true }, 0.6, ["AMBIGUOUS_PARSE", "EVIDENCE_NOT_FOUND", "UNIT_ASSUMED"]],
    ["evidence ignored without a value", 0.97, { hasValue: false, required: false, evidence: "NOT_FOUND" }, 0.97, []],
    ["rounds half-up to 3 dp", 0.9745, {}, 0.975, []],
    ["rounds down below the half", 0.97449, {}, 0.974, []],
  ])("%s", (_, model, overrides, final, reasons) => {
    const result = applyConfidencePolicy(model, facts(overrides));
    expect(result.final).toBe(final);
    expect(result.signals.caps.map((c) => c.reason)).toEqual(reasons);
    expect(result.signals.model).toBe(model);
  });

  it("records each cap's value so the UI can explain it", () => {
    expect(applyConfidencePolicy(0.97, facts({ evidence: "NOT_FOUND" })).signals).toEqual({
      model: 0.97,
      caps: [{ reason: "EVIDENCE_NOT_FOUND", cap: 0.7 }],
      evidence: "NOT_FOUND",
    });
  });
});

describe("needsReview (A-03: final < 0.85)", () => {
  it.each([
    [0.849, true],
    [0.85, false],
    [0.97, false],
    [null, true],
  ])("%s → %s", (confidence, expected) => {
    expect(needsReview(confidence)).toBe(expected);
  });
});

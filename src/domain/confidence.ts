import { D } from "./money";

/** A-03: final confidence below this blocks until a person confirms, corrects or enters the value. */
export const REVIEW_THRESHOLD = 0.85;

// PRD §8.1, in table order; exported for the UI legend.
export const CONFIDENCE_CAPS = {
  FORMAT_INVALID: 0.4,
  REQUIRED_MISSING: 0,
  PAGE_UNREADABLE: 0,
  AMBIGUOUS_PARSE: 0.6,
  EVIDENCE_NOT_FOUND: 0.7,
  UNIT_ASSUMED: 0.8,
  PAGE_QUALITY: 0.8,
  NO_TEXT_LAYER: 0.95,
} as const;
export type CapReason = keyof typeof CONFIDENCE_CAPS;

export type Evidence = "FOUND" | "NOT_FOUND" | "NO_TEXT_LAYER";

/** API_SPECS §2.5: stored per field so the UI can say why ("Model 0.97 · not found in PDF text → 0.70"). */
export interface ConfidenceSignals {
  model: number;
  caps: Array<{ reason: CapReason; cap: number }>;
  evidence: Evidence;
}

/** What extraction and normalisation found out about one field value. */
export interface FieldFacts {
  hasValue: boolean; // the model returned text
  required: boolean; // on this document (PRD §6)
  formatValid: boolean; // the kind's normaliser accepted it
  ambiguous: boolean; // decimal separator or day/month order
  unitAssumed: boolean;
  evidence: Evidence;
  page: { readable: boolean; issues: readonly string[] };
}

const QUALITY_ISSUES = new Set(["BLURRY", "CUT_OFF", "LOW_CONTRAST"]);

/** PRD §8.1: final = min(model confidence, every cap that applies), rounded half-up to 3 dp. */
export function applyConfidencePolicy(model: number, facts: FieldFacts): { final: number; signals: ConfidenceSignals } {
  const applies: Record<CapReason, boolean> = {
    FORMAT_INVALID: facts.hasValue && !facts.formatValid,
    REQUIRED_MISSING: !facts.hasValue && facts.required,
    PAGE_UNREADABLE: !facts.page.readable,
    AMBIGUOUS_PARSE: facts.ambiguous,
    EVIDENCE_NOT_FOUND: facts.hasValue && facts.evidence === "NOT_FOUND",
    UNIT_ASSUMED: facts.unitAssumed,
    PAGE_QUALITY: facts.page.issues.some((issue) => QUALITY_ISSUES.has(issue)),
    NO_TEXT_LAYER: facts.hasValue && facts.evidence === "NO_TEXT_LAYER",
  };
  const caps = (Object.keys(CONFIDENCE_CAPS) as CapReason[])
    .filter((reason) => applies[reason])
    .map((reason) => ({ reason, cap: CONFIDENCE_CAPS[reason] }));
  const lowest = caps.reduce((min, { cap }) => (cap < min ? cap : min), model);
  return {
    final: new D(lowest).toDecimalPlaces(3).toNumber(),
    signals: { model, caps, evidence: facts.evidence },
  };
}

/** A field with no final confidence yet is treated as unverified. */
export const needsReview = (confidence: number | null) => confidence === null || confidence < REVIEW_THRESHOLD;

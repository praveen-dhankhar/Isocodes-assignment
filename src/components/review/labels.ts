import type { CapReason, ConfidenceSignals } from "@/domain/confidence";
import type { DocType } from "@/domain/fields";
import type { DocumentDTO } from "@/server/queries/shipments";

export const SHORT: Record<DocType, string> = { INVOICE: "INV", PACKING_LIST: "PL", BILL_OF_LADING: "B/L" };

/** Rule 8: recorded or hand-authored output is always labelled. */
export const MODE_LABEL: Record<NonNullable<DocumentDTO["mode"]>, string> = { LIVE: "Live", SAMPLE: "Recorded sample", MANUAL: "Manual" };

const CAP_LABEL: Record<CapReason, string> = {
  FORMAT_INVALID: "format is invalid",
  REQUIRED_MISSING: "required but not found",
  PAGE_UNREADABLE: "page is unreadable",
  AMBIGUOUS_PARSE: "number or date could be read two ways",
  EVIDENCE_NOT_FOUND: "not found in the PDF text",
  UNIT_ASSUMED: "unit was assumed",
  PAGE_QUALITY: "page quality is poor",
  NO_TEXT_LAYER: "scan, no text layer to check against",
};

const two = (n: number) => n.toFixed(2);

/** The "why" behind a confidence (API_SPECS §2.5): "Model 0.97 · not found in the PDF text → 0.70". */
export function confidenceWhy(signals: ConfidenceSignals | null, final: number | null): string {
  if (!signals) return final === null ? "Not read by the model" : `Confidence ${two(final)}`;
  const caps = signals.caps.map((c) => CAP_LABEL[c.reason]).join(" · ");
  return `Model ${two(signals.model)}${caps ? ` · ${caps}` : ""}${final === null ? "" : ` → ${two(final)}`}`;
}

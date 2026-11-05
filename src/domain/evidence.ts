import type { FieldKind } from "./fields";
import { D } from "./money";
import { parseContainerList } from "./normalize/codes";
import { numbersIn, parseDecimal, type DecimalSeparator } from "./normalize/number";

/** Fractions of page width/height, origin top-left (same shape as the model's BBox). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One PDF text-layer string with its box (`document_pages.text_items`). */
export interface TextItem {
  str: string;
  box: Box;
}

export type EvidenceResult = { evidence: "FOUND"; box: Box | null } | { evidence: "NOT_FOUND" } | { evidence: "NO_TEXT_LAYER" };

const NUMERIC: ReadonlySet<FieldKind> = new Set(["MONEY", "DECIMAL", "INTEGER", "WEIGHT"]);
const squash = (s: string) => s.toUpperCase().replace(/\s+/g, "");
const squashCode = (s: string) => s.toUpperCase().replace(/[\s-]+/g, "");

/**
 * Is what the model read really in the page's PDF text layer (ARCHITECTURE §7.3)? Matches the text as printed —
 * not the canonical value — so "14/10/2026", "US$" or "2,204.62 LBS" are found as they appear. Numbers compare by
 * value with the document's separator; everything else case- and whitespace-insensitively; every container must
 * appear. A FOUND box replaces the model's box; it is null when the match spans several text items.
 */
export function findEvidence(
  kind: FieldKind,
  rawText: string,
  items: readonly TextItem[] | null,
  sep: DecimalSeparator | null,
): EvidenceResult {
  if (items === null) return { evidence: "NO_TEXT_LAYER" };

  if (NUMERIC.has(kind)) {
    const target = parseDecimal(rawText, sep)?.value;
    const hit = target === undefined ? undefined : items.find((item) => numbersIn(item.str, sep).some((n) => new D(n).eq(target)));
    return hit ? { evidence: "FOUND", box: hit.box } : { evidence: "NOT_FOUND" };
  }

  const isContainers = kind === "CONTAINER_LIST";
  const norm = isContainers ? squashCode : squash;
  const needles = isContainers ? (parseContainerList(rawText)?.value.split("|") ?? []) : [norm(rawText)];
  if (needles.length === 0 || needles.some((n) => n === "")) return { evidence: "NOT_FOUND" };

  const page = norm(items.map((i) => i.str).join(" "));
  let box: Box | null = null;
  for (const [i, needle] of needles.entries()) {
    const item = items.find((it) => norm(it.str).includes(needle));
    if (!item && !page.includes(needle)) return { evidence: "NOT_FOUND" };
    if (i === 0) box = item?.box ?? null;
  }
  return { evidence: "FOUND", box };
}

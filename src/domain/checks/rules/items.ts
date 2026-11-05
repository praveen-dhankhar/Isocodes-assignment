import { D, formatEnIn } from "../../money";
import { readyDocument, type SnapshotLine } from "../../snapshot";
import { asPrinted, observe, outcome } from "../fingerprint";
import type { CheckConfig, CheckOutcome, CheckRule } from "../types";

/** PRD §9: uppercase, punctuation to spaces (so "panel-light" reads as two words), collapsed → token set. */
const tokens = (text: string | null | undefined) =>
  new Set((text ?? "").toUpperCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean));

/** Token Jaccard similarity as an exact decimal (no floating point in the engine). */
function similarity(a: Set<string>, b: Set<string>): D {
  const shared = [...a].filter((t) => b.has(t)).length;
  const union = a.size + b.size - shared;
  return union === 0 ? new D(0) : new D(shared).div(union);
}

// ponytail: no HS-code bonus (A-12's +0.2). It needs an HS code on both sides and packing-list lines carry none
// (PRD §6.2), so it could never apply. Add config.hsMatchBonus to the score if the packing list ever extracts one.

/**
 * Greedy pairing by highest similarity ≥ descriptionMatchMin (ties: invoice line, then packing-list line, in order).
 * If nothing reaches the threshold and both sides have the same number of lines, pair them by position (A-12).
 */
function pairLines(inv: SnapshotLine[], pl: SnapshotLine[], config: CheckConfig) {
  const plTokens = pl.map((l) => ({ line: l, tokens: tokens(l.cells.description?.value) }));
  const candidates = inv
    .flatMap((i) => {
      const t = tokens(i.cells.description?.value);
      return plTokens.map((p) => ({ inv: i, pl: p.line, score: similarity(t, p.tokens) }));
    })
    .filter((c) => c.score.gte(config.descriptionMatchMin))
    .sort((a, b) => b.score.cmp(a.score) || a.inv.lineNo - b.inv.lineNo || a.pl.lineNo - b.pl.lineNo);

  const pairs = new Map<number, SnapshotLine>(); // invoice lineNo → packing-list line
  const usedPl = new Set<number>();
  for (const c of candidates) {
    if (pairs.has(c.inv.lineNo) || usedPl.has(c.pl.lineNo)) continue;
    pairs.set(c.inv.lineNo, c.pl);
    usedPl.add(c.pl.lineNo);
  }
  if (pairs.size > 0 || inv.length !== pl.length) return { pairs, byPosition: false };
  return { pairs: new Map(inv.flatMap((l, i) => (pl[i] ? [[l.lineNo, pl[i]] as const] : []))), byPosition: true };
}

const lineName = (line: SnapshotLine) => line.cells.description?.value ?? "no description";

const observeLine = (docType: "INVOICE" | "PACKING_LIST", line: SnapshotLine) => [
  observe(docType, line.cells.description, asPrinted),
  observe(docType, line.cells.quantity),
  observe(docType, line.cells.unit, asPrinted),
];

/** CC-06: every invoice line matched to a packing-list line, same quantity, same unit when both state one. */
export const lineItemMatch: CheckRule = {
  id: "CC-06",
  name: "LINE_ITEM_MATCH",
  run(snapshot, config) {
    const invoice = readyDocument(snapshot, "INVOICE");
    const packing = readyDocument(snapshot, "PACKING_LIST");
    if (!invoice || !packing) return [];
    const { pairs, byPosition } = pairLines(invoice.lines, packing.lines, config);

    const perInvoiceLine = invoice.lines.map((inv): CheckOutcome => {
      const pl = pairs.get(inv.lineNo);
      const label = `Line ${inv.lineNo} (${lineName(inv)})`;
      const base = {
        ruleId: "CC-06" as const,
        scope: `line:${inv.lineNo}`,
        observed: [...observeLine("INVOICE", inv), ...(pl ? observeLine("PACKING_LIST", pl) : [])],
        notes: pl && byPosition ? ["Matched by position"] : [],
      };
      if (!pl) return outcome({ ...base, status: "FAIL", delta: null, message: `${label}: no matching packing-list line` });

      const invQty = inv.cells.quantity?.value;
      const plQty = pl.cells.quantity?.value;
      if (invQty == null || plQty == null) {
        return outcome({ ...base, status: "INCOMPLETE", delta: null, message: `${label}: quantity missing on the ${invQty == null ? "invoice" : "packing list"}` });
      }
      const delta = new D(invQty).minus(plQty).abs().toFixed();
      if (delta !== "0") {
        return outcome({ ...base, status: "FAIL", delta, message: `${label}: quantity ${formatEnIn(invQty)} on the invoice vs ${formatEnIn(plQty)} on the packing list` });
      }
      const invUnit = inv.cells.unit?.value;
      const plUnit = pl.cells.unit?.value;
      if (invUnit != null && plUnit != null && invUnit !== plUnit) {
        return outcome({ ...base, status: "FAIL", delta, message: `${label}: unit ${invUnit} on the invoice vs ${plUnit} on the packing list` });
      }
      return outcome({ ...base, status: "PASS", delta, message: `${label} matches packing-list line ${pl.lineNo}` });
    });

    const pairedPl = new Set([...pairs.values()].map((l) => l.lineNo));
    const unmatchedPl = packing.lines
      .filter((pl) => !pairedPl.has(pl.lineNo))
      .map((pl) =>
        outcome({
          ruleId: "CC-06",
          scope: `pl-line:${pl.lineNo}`,
          observed: observeLine("PACKING_LIST", pl),
          notes: [],
          status: "FAIL",
          delta: null,
          message: `Packing-list line ${pl.lineNo} (${lineName(pl)}): no matching invoice line`,
        }),
      );
    return [...perInvoiceLine, ...unmatchedPl];
  },
};

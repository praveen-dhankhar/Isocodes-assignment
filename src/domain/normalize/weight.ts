import { D } from "../money";
import { parseDecimal, type DecimalSeparator } from "./number";

export interface ParsedWeight {
  /** Canonical kilograms, 3 dp ("3120.000"). */
  kg: string;
  /** No unit printed; kg assumed (PRD §7, confidence cap 0.80). */
  unitAssumed: boolean;
  ambiguous: boolean;
}

// PRD §7 units plus their plurals and long forms. Whole words only, so "CARTONS" is not "TONS".
const UNIT = /(?<![A-Z])(K\.?G\.?S?|KGM|KILOS?|KILOGRAMS?|LBS?|POUNDS?|MTS?|TONNES?|TONS?)(?![A-Z])/i;

const kgPer = (unit: string) => (/^[LP]/i.test(unit) ? "0.45359237" : /^[MT]/i.test(unit) ? "1000" : "1");

export function parseWeightKg(text: string, sep: DecimalSeparator | null): ParsedWeight | null {
  const n = parseDecimal(text, sep);
  if (!n) return null;
  const unit = UNIT.exec(text)?.[1];
  return {
    kg: new D(n.value).times(unit ? kgPer(unit) : "1").toFixed(3),
    unitAssumed: unit === undefined,
    ambiguous: n.ambiguous,
  };
}

import type { FieldKind } from "../fields";
import { parseContainerList, parseHsCode } from "./codes";
import { parseCurrency } from "./currency";
import { parseDate } from "./date";
import { parseIncoterm } from "./incoterm";
import { parseDecimal, parseInteger, type DecimalSeparator } from "./number";
import { normalizeText, normalizeUnit } from "./text";
import { parseWeightKg, WEIGHT_UNIT } from "./weight";

export interface NormalizeContext {
  /** The document's decimal separator (detectDecimalSeparator over all its printed numbers). */
  separator: DecimalSeparator | null;
  /** ISO 3166-1 alpha-2 of the supplier: decides date order and what "¥" means. */
  supplierCountry: string | null;
}

/** A printed value read by code (PRD §7) plus the facts the confidence policy needs (PRD §8). */
export interface NormalizedValue {
  value: string | null;
  formatValid: boolean;
  ambiguous: boolean;
  unitAssumed: boolean;
}

const read = (value: string | null, flags: Partial<Omit<NormalizedValue, "value">> = {}): NormalizedValue => ({
  value,
  formatValid: value !== null,
  ambiguous: false,
  unitAssumed: false,
  ...flags,
});

/** "The model reads, code interprets": one printed text → canonical value, by field kind. */
export function normalizeField(kind: FieldKind, text: string, ctx: NormalizeContext): NormalizedValue {
  switch (kind) {
    case "TEXT":
    case "IDENTIFIER":
      return read(normalizeText(text));
    case "DATE": {
      const d = parseDate(text, ctx.supplierCountry);
      return read(d?.value ?? null, { ambiguous: d?.ambiguous ?? false });
    }
    case "CURRENCY":
      return read(parseCurrency(text, ctx.supplierCountry));
    case "INCOTERM":
      return read(parseIncoterm(text));
    case "MONEY":
    case "DECIMAL": {
      const n = parseDecimal(text, ctx.separator);
      return read(n?.value ?? null, { ambiguous: n?.ambiguous ?? false });
    }
    case "INTEGER":
      return read(parseInteger(text));
    case "WEIGHT": {
      const w = parseWeightKg(text, ctx.separator);
      return read(w?.kg ?? null, { ambiguous: w?.ambiguous ?? false, unitAssumed: w?.unitAssumed ?? false });
    }
    case "CONTAINER_LIST": {
      const c = parseContainerList(text);
      // A wrong check digit keeps the value (CC-07 shows it) but fails the format check (confidence cap).
      return read(c?.value ?? null, { formatValid: c !== null && c.invalid.length === 0 });
    }
    case "HS_CODE": {
      const h = parseHsCode(text);
      return read(h?.value ?? null, { formatValid: h?.valid ?? false });
    }
    case "UNIT":
      return read(normalizeUnit(text));
  }
}

// A typed value is checked token by token: one number, plus only the words its kind allows. Printed text is read
// leniently (a stray mark next to a number is still the number); a person's input is not, so "3.120,0O" is refused.
const TOKENS = /[A-Za-z]+|\d[\d.,'’]*|[$€£¥₹]|[^\s]/g;
const NUMERIC: Partial<Record<FieldKind, (word: string) => boolean>> = {
  WEIGHT: (w) => WEIGHT_UNIT.exec(w)?.[1]?.length === w.length,
  MONEY: (w) => /^[A-Z]{3}$/i.test(w),
  DECIMAL: (w) => /^[A-Z]{1,6}$/i.test(w),
  INTEGER: (w) => /^[A-Z]{1,6}$/i.test(w),
};

/** A value a person typed into a field (Correct / Enter): stricter than `normalizeField`, then read the same way. */
export function normalizeTyped(kind: FieldKind, text: string, ctx: NormalizeContext): NormalizedValue {
  const wordAllowed = NUMERIC[kind];
  if (wordAllowed) {
    const tokens = text.match(TOKENS) ?? [];
    const numbers = tokens.filter((t) => /^\d/.test(t));
    const words = tokens.filter((t) => /^[A-Za-z]/.test(t));
    const symbols = tokens.filter((t) => !/^[\dA-Za-z]/.test(t));
    const symbolsOk = symbols.every((t) => kind === "MONEY" && /^[$€£¥₹]$/.test(t));
    // Letters glued to digits ("24O", "2,4OO") are a typo for zero unless they spell a weight unit ("3120kg").
    const glued = /\d[A-Za-z]|[A-Za-z]\d/.test(text) && kind !== "WEIGHT";
    if (numbers.length !== 1 || words.length > 1 || !words.every(wordAllowed) || !symbolsOk || glued) return read(null);
  }
  return normalizeField(kind, text, ctx);
}

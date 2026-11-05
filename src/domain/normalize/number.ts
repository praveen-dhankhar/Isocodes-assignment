import { D } from "../money";

export type DecimalSeparator = "." | ",";

export interface ParsedDecimal {
  /** Canonical: dot decimal, no grouping, printed precision kept ("16320.00"). */
  value: string;
  /** The punctuation allows two readings; the field goes to review (A-09). */
  ambiguous: boolean;
}

// Digits, then more digits after "." / ",", or after a space or apostrophe that groups exactly three
// digits ("1 460,00", "1'460.00"). Anything else ends the number, so "2 x 6.80" reads as 2.
const NUMBER = /-?\d+(?:[.,]\d+|[\s'’]\d{3}(?!\d))*/;
const NUMBERS = new RegExp(NUMBER.source, "g");

type Shape =
  | { kind: "integer" }
  | { kind: "decided"; decimal: DecimalSeparator }
  // One separator followed by exactly three digits ("1,460"): thousands or decimal?
  | { kind: "lone3"; sep: DecimalSeparator };

const other = (sep: DecimalSeparator): DecimalSeparator => (sep === "." ? "," : ".");
const unsigned = (token: string) => token.replace(/^-/, "").replace(/[\s'’]/g, "");

/** What a number's own punctuation says about its decimal separator. */
function shape(digits: string): Shape {
  const dot = digits.lastIndexOf(".");
  const comma = digits.lastIndexOf(",");
  if (dot < 0 && comma < 0) return { kind: "integer" };
  if (dot >= 0 && comma >= 0) return { kind: "decided", decimal: dot > comma ? "." : "," };
  const sep: DecimalSeparator = dot >= 0 ? "." : ",";
  const [int = "", frac = "", ...more] = digits.split(sep);
  if (more.length > 0) return { kind: "decided", decimal: other(sep) }; // repeated, so it groups thousands
  // A thousands group needs 1–3 leading digits (not a lone 0) and exactly three after.
  if (frac.length !== 3 || int.length > 3 || int === "0") return { kind: "decided", decimal: sep };
  return { kind: "lone3", sep };
}

/**
 * Per-document decimal separator from every number printed on it (A-09). Majority of the numbers that
 * decide it; null when none decide or the vote ties — then every "1,460"-shaped value is ambiguous.
 */
export function detectDecimalSeparator(texts: readonly string[]): DecimalSeparator | null {
  let votes = 0; // > 0 dot, < 0 comma
  for (const text of texts) {
    for (const token of text.match(NUMBERS) ?? []) {
      const s = shape(unsigned(token));
      if (s.kind === "decided") votes += s.decimal === "." ? 1 : -1;
    }
  }
  return votes > 0 ? "." : votes < 0 ? "," : null;
}

/** INTEGER (PRD §7): first number in `text` ("240 CTNS" → "240"). Counts have no fraction, so any lone
 * "1,200" / "1.200" groups thousands; a real fraction ("12.5") or a negative is invalid → null. */
export function parseInteger(text: string): string | null {
  const token = NUMBER.exec(text)?.[0];
  if (token === undefined || token.startsWith("-")) return null;
  const digits = unsigned(token);
  const s = shape(digits);
  const [int = "", frac = "", ...more] =
    s.kind === "decided" ? digits.replaceAll(other(s.decimal), "").split(s.decimal) : [digits.replace(/[.,]/g, "")];
  if (more.length > 0 || /[1-9]/.test(frac)) return null;
  return new D(int).toFixed(0);
}

/** Canonical value of every number in `text`, read with the document's separator (evidence matching). */
export function numbersIn(text: string, sep: DecimalSeparator | null): string[] {
  return (text.match(NUMBERS) ?? []).flatMap((token) => parseDecimal(token, sep)?.value ?? []);
}

/** First number in `text` (currency symbols and codes ignored), read with the document's separator. */
export function parseDecimal(text: string, sep: DecimalSeparator | null): ParsedDecimal | null {
  const token = NUMBER.exec(text)?.[0];
  if (token === undefined) return null;
  const digits = unsigned(token);
  const s = shape(digits);

  let decimal: DecimalSeparator | null = null;
  let ambiguous = false;
  if (s.kind === "decided") {
    decimal = s.decimal;
    ambiguous = sep !== null && sep !== s.decimal; // contradicts the rest of the document
  } else if (s.kind === "lone3") {
    decimal = sep ?? ".";
    // PRD §7: a lone "1,460" on a comma-decimal document stays ambiguous; so does any on an undecided one.
    ambiguous = sep === null || (sep === "," && s.sep === ",");
  }

  const [int = "", frac, ...more] = decimal ? digits.replaceAll(other(decimal), "").split(decimal) : [digits];
  if (more.length > 0) return null; // decimal separator printed twice
  const plain = frac === undefined ? int : `${int}.${frac}`;
  return { value: new D(token.startsWith("-") ? `-${plain}` : plain).toFixed(frac?.length ?? 0), ambiguous };
}

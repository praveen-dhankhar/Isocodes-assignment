export interface ParsedDate {
  /** ISO "2026-10-14". */
  value: string;
  /** Day and month could be swapped (A-10); the field goes to review. */
  ambiguous: boolean;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// PRD §7 formats; "." also separates numeric dates on European documents.
const YMD = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const NUMERIC = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/;
const DAY_MONTH_NAME = /\b(\d{1,2})(?:st|nd|rd|th)?[\s.-]*([a-z]{3,9})\.?[\s.,-]*(\d{4})\b/i;
const MONTH_NAME_DAY = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i;

/** 1–12 for a month name or its abbreviation ("Oct", "Sept"); 0 when unknown. */
const monthNumber = (name: string | undefined) =>
  MONTHS.findIndex((m) => name !== undefined && m.startsWith(name.toLowerCase())) + 1;

/** ISO date when y-m-d is a real calendar day, else null. */
function iso(y: number, m: number, d: number): string | null {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (days === undefined || d < 1 || d > days) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const certain = (value: string | null): ParsedDate | null => (value ? { value, ambiguous: false } : null);

/** `supplierCountry` is ISO 3166-1 alpha-2; only "US" reads 03/04 as March 4 (A-10). */
export function parseDate(text: string, supplierCountry: string | null): ParsedDate | null {
  let m = YMD.exec(text);
  if (m) return certain(iso(Number(m[1]), Number(m[2]), Number(m[3])));

  m = NUMERIC.exec(text);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dayFirst = iso(y, b, a);
    const monthFirst = iso(y, a, b);
    if (dayFirst && monthFirst && dayFirst !== monthFirst) {
      return { value: supplierCountry === "US" ? monthFirst : dayFirst, ambiguous: true };
    }
    return certain(dayFirst ?? monthFirst);
  }

  m = DAY_MONTH_NAME.exec(text);
  if (m) return certain(iso(Number(m[3]), monthNumber(m[2]), Number(m[1])));

  m = MONTH_NAME_DAY.exec(text);
  if (m) return certain(iso(Number(m[3]), monthNumber(m[1]), Number(m[2])));

  return null;
}

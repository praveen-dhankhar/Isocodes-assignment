export interface ParsedCode {
  value: string;
  /** False → format-invalid confidence cap (PRD §8). */
  valid: boolean;
}

/** HS code: digits only, valid when 6–10 digits (A-11). Format only; no classification. */
export function parseHsCode(text: string): ParsedCode | null {
  const run = /\d[\d.\s]*\d|\d/.exec(text)?.[0];
  if (run === undefined) return null;
  const value = run.replace(/\D/g, "");
  return { value, valid: value.length >= 6 && value.length <= 10 };
}

// ISO 6346 letter values: A = 10 upward, skipping multiples of 11.
const LETTER_VALUE = new Map<string, number>();
for (let i = 0, v = 10; i < 26; i++, v++) {
  if (v % 11 === 0) v++;
  LETTER_VALUE.set(String.fromCharCode(65 + i), v);
}

/** Owner code + U/J/Z category + 6-digit serial + check digit, and the check digit is right. */
export function iso6346Valid(code: string): boolean {
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code.charAt(i);
    sum += (LETTER_VALUE.get(ch) ?? Number(ch)) * 2 ** i;
  }
  return (sum % 11) % 10 === Number(code.charAt(10));
}

export interface ParsedContainers {
  /** Uppercase, de-duplicated, sorted, "|"-joined (PRD §7). Invalid codes stay in so CC-07 can show them. */
  value: string;
  invalid: string[];
}

const CONTAINER = /\b[A-Z]{4}[\s-]*\d{6}[\s-]*\d\b/g;

export function parseContainerList(text: string): ParsedContainers | null {
  const found = (text.toUpperCase().match(CONTAINER) ?? []).map((c) => c.replace(/[\s-]/g, ""));
  const codes = [...new Set(found)].sort();
  if (codes.length === 0) return null;
  return { value: codes.join("|"), invalid: codes.filter((c) => !iso6346Valid(c)) };
}

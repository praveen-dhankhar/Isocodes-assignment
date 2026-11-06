// Chinese and Japanese are written without spaces between words, so a space between two of their characters is noise
// (a model may insert one). Korean is not: it spaces words, so Hangul is left alone.
const CJ = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const CJK_GAP = new RegExp(`([${CJ}])\\s+(?=[${CJ}])`, "gu");

/** TEXT and IDENTIFIER (PRD §7): trimmed, whitespace collapsed; null when nothing is left. */
export function normalizeText(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim().replace(CJK_GAP, "$1"); // a space inside CJK text means nothing
  return value === "" ? null : value;
}

/** Identifiers keep their printed case but compare in uppercase (PRD §7). */
export const identifierKey = (value: string) => value.toUpperCase();

// A-21: common units only; anything else is kept as printed, uppercased.
const UQC = new Map(
  Object.entries({
    PCS: ["PC", "PCE", "PCS", "PIECE", "PIECES"],
    NOS: ["NO", "NOS", "NUMBER", "NUMBERS"],
    SET: ["SET", "SETS"],
    KGS: ["KG", "KGS", "KGM", "KILOGRAM", "KILOGRAMS"],
    MTR: ["M", "MTR", "MTRS", "METER", "METERS", "METRE", "METRES"],
    PRS: ["PR", "PRS", "PAIR", "PAIRS"],
  }).flatMap(([uqc, spellings]) => spellings.map((s): [string, string] => [s, uqc])),
);

export function normalizeUnit(text: string): string | null {
  const unit = normalizeText(text)?.toUpperCase().replace(/\.$/, "");
  return unit ? (UQC.get(unit) ?? unit) : null;
}

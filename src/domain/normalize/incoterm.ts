const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

const CODE = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`);
const C_AND_F = /\bC\s*(?:&|\+|AND|N)\s*F\b/; // C&F, C & F, C+F, CNF → CFR

/** Incoterms 2020 code; the named place stays in rawText (PRD §7). */
export function parseIncoterm(text: string): Incoterm | null {
  const match = CODE.exec(text.toUpperCase().replace(C_AND_F, "CFR"))?.[1];
  return INCOTERMS.find((code) => code === match) ?? null;
}

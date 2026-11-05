import { describe, expect, it } from "vitest";
import { parseIncoterm } from "./incoterm";

describe("parseIncoterm (PRD §7, Incoterms 2020)", () => {
  it.each<[string, string | null]>([
    ["FOB Ningbo", "FOB"],
    ["FCA Gothenburg", "FCA"],
    ["cif nhava sheva", "CIF"],
    ["Incoterms 2020: DAP Pune", "DAP"],
    ["C&F Nhava Sheva", "CFR"],
    ["C & F", "CFR"],
    ["CNF", "CFR"],
    ["C+F", "CFR"],
    ["CFR", "CFR"],
    ...["EXW", "CPT", "CIP", "DPU", "DDP", "FAS"].map((c): [string, string] => [c, c]),
    ["DAT", null],
    ["Free on board", null],
    ["", null],
  ])("%j → %s", (text, code) => {
    expect(parseIncoterm(text)).toBe(code);
  });
});

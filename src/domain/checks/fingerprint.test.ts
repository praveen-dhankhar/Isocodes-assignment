import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprint, outcome } from "./fingerprint";
import type { ObservedValue } from "./types";

const observed: ObservedValue[] = [
  { docType: "INVOICE", fieldId: "f1", value: "3120.000", display: "3,120.000 kg" },
  { docType: "PACKING_LIST", fieldId: "f2", value: "3165.000", display: "3,165.000 kg" },
  { docType: "BILL_OF_LADING", fieldId: null, value: null, display: "not stated" },
];
const draft = { ruleId: "CC-03", scope: "shipment", observed } as const;

describe("fingerprint (ARCHITECTURE §6.3)", () => {
  it("is the first 16 hex chars of sha256(rule | scope | sorted observed values)", () => {
    const input = "CC-03|shipment|BILL_OF_LADING=|INVOICE=3120.000|PACKING_LIST=3165.000";
    expect(fingerprint(draft)).toBe(createHash("sha256").update(input).digest("hex").slice(0, 16));
  });

  it("ignores observation order and display text", () => {
    const shuffled = [...observed].reverse().map((o) => ({ ...o, display: "x" }));
    expect(fingerprint({ ...draft, observed: shuffled })).toBe(fingerprint(draft));
  });

  it.each([
    ["a value", { ...draft, observed: observed.map((o, i) => (i === 1 ? { ...o, value: "3150.000" } : o)) }],
    ["the scope", { ...draft, scope: "line:1" }],
    ["the rule", { ...draft, ruleId: "CC-04" as const }],
  ])("changes when %s changes", (_, changed) => {
    expect(fingerprint(changed)).not.toBe(fingerprint(draft));
  });
});

describe("outcome", () => {
  it.each([
    ["PASS", "INFO"],
    ["FAIL", "CRITICAL"],
    ["INCOMPLETE", "WARNING"],
    ["NOT_APPLICABLE", "INFO"],
  ] as const)("%s → severity %s, fingerprinted, no resolution yet", (status, severity) => {
    const o = outcome({ ...draft, status, delta: null, message: "m", notes: [] });
    expect(o).toMatchObject({ status, severity, resolution: null, fingerprint: fingerprint(draft) });
  });
});

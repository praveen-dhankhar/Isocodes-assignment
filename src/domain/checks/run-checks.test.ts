import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "./config";
import { ENGINE_VERSION, runCrossChecks } from "./run-checks";
import { SCENARIOS, shp24811, shp24816, withLines, withValue } from "./__fixtures__/snapshots";
import type { CheckOutcome, PriorResolution } from "./types";

const find = (results: CheckOutcome[], ruleId: string, scope = "shipment") =>
  results.find((r) => r.ruleId === ruleId && r.scope === scope)!;

describe("SHP-24811 — gross weight mismatch (brief)", () => {
  const snap = shp24811(); // __fixtures__/snapshots.ts
  const results = runCrossChecks(snap, CHECK_CONFIG);
  const cc03 = results.find((r) => r.ruleId === "CC-03" && r.scope === "shipment")!;

  it("fails CC-03 with a 45 kg delta", () => {
    expect(cc03.status).toBe("FAIL");
    expect(cc03.severity).toBe("CRITICAL");
    expect(cc03.delta).toBe("45.000");
    expect(cc03.observed.map((o) => [o.docType, o.value])).toEqual([
      ["INVOICE", "3120.000"], ["PACKING_LIST", "3165.000"], ["BILL_OF_LADING", "3165.000"],
    ]);
  });

  it("passes the invoice maths (2400 × 6.80 = 16,320.00)", () => {
    expect(results.find((r) => r.ruleId === "CC-01")!.status).toBe("PASS");
    expect(results.find((r) => r.ruleId === "CC-02")!.status).toBe("PASS");
  });

  it("keeps an accepted discrepancy when re-run unchanged, re-opens it when PL weight changes", () => {
    const accepted: PriorResolution = { type: "DISCREPANCY_ACCEPTED", fingerprint: cc03.fingerprint, declaredValue: "3165.000" };
    const priorResolutions = { "CC-03": { shipment: accepted } };

    const rerun = runCrossChecks({ ...snap, priorResolutions }, CHECK_CONFIG);
    expect(find(rerun, "CC-03").resolution).toEqual(accepted);

    const changed = { ...withValue(snap, "PACKING_LIST", "grossWeight", "3150.000"), priorResolutions };
    expect(find(runCrossChecks(changed, CHECK_CONFIG), "CC-03").resolution).toBeNull();
  });
});

describe("runCrossChecks", () => {
  it.each(["SHP-24812", "SHP-24813", "SHP-24816"] as const)("%s: every check passes or does not apply", (ref) => {
    const statuses = runCrossChecks(SCENARIOS[ref](), CHECK_CONFIG).map((r) => `${r.ruleId} ${r.scope} ${r.status}`);
    expect(statuses.filter((s) => !/ (PASS|NOT_APPLICABLE)$/.test(s))).toEqual([]);
  });

  it("LBS scenario passes CC-03 (SHP-24816)", () => {
    expect(find(runCrossChecks(shp24816(), CHECK_CONFIG), "CC-03").status).toBe("PASS");
  });

  it("CC-06 fails on line:2 for SHP-24814", () => {
    const failed = runCrossChecks(SCENARIOS["SHP-24814"](), CHECK_CONFIG).filter((r) => r.status === "FAIL");
    expect(failed.map((r) => `${r.ruleId} ${r.scope}`)).toEqual(["CC-06 line:2"]);
  });

  it("CC-07 fails for SHP-24815", () => {
    const failed = runCrossChecks(SCENARIOS["SHP-24815"](), CHECK_CONFIG).filter((r) => r.status === "FAIL");
    expect(failed.map((r) => `${r.ruleId} ${r.scope}`)).toEqual(["CC-07 shipment"]);
  });

  it("runs all eight rules in order", () => {
    const rules = new Set(runCrossChecks(shp24811(), CHECK_CONFIG).map((r) => r.ruleId));
    expect([...rules].sort()).toEqual(["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08"]);
  });

  it("sorts by severity, then rule, then scope (line:2 before line:10)", () => {
    const tenLines = Array.from({ length: 10 }, () => ({ description: "Part", quantity: "1", unitPrice: "1.00", lineTotal: "1.00" }));
    const snap = withLines(withValue(shp24811(), "INVOICE", "invoiceTotal", "10.00"), "INVOICE", tenLines);
    const keys = runCrossChecks(snap, CHECK_CONFIG).map((r) => `${r.severity} ${r.ruleId} ${r.scope}`);
    expect(keys[0]).toBe("CRITICAL CC-03 shipment");
    expect(keys.filter((k) => k.includes("CC-01"))).toEqual(tenLines.map((_, i) => `INFO CC-01 line:${i + 1}`));
  });

  it("fingerprints every outcome", () => {
    for (const r of runCrossChecks(shp24811(), CHECK_CONFIG)) expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is versioned", () => {
    expect(ENGINE_VERSION).toBe("ce-1.0.0");
  });
});

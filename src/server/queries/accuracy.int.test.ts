import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "../db/seed";
import { seedScenarios } from "../db/seed-scenarios";
import { getAccuracyReport } from "./accuracy";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only

beforeAll(async () => {
  await seed();
  await seedScenarios();
}, 120_000);

describe("getAccuracyReport (PRD §8.3)", () => {
  it("counts only corrections of AI values on approved/exported shipments, recorded samples when asked", async () => {
    const live = await getAccuracyReport({ includeSamples: false });
    expect(live.overall.total).toBe(0); // the seed is read from recorded samples

    const r = await getAccuracyReport({ includeSamples: true });
    // SHP-24813 (approved): PL net weight + an HS code; SHP-24816 (exported): the invoice number. Confirmations don't count.
    expect(r.overall.corrected).toBeGreaterThanOrEqual(3);
    expect(r.byField.find((f) => f.key === "hsCode")?.corrected).toBeGreaterThanOrEqual(1);
    expect(r.bySupplier.map((s) => s.key)).toEqual(expect.arrayContaining(["Company D", "Company G"]));
    expect(r.calibration.reduce((n, b) => n + b.total, 0)).toBe(r.overall.total);
    expect(r.log.some((e) => e.action === "CORRECT" && e.where === "Packing list · Net weight (kg)" && e.to === "560.000" && e.ai === "580.000")).toBe(true);
  });
});

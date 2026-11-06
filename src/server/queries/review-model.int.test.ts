import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { shipments, user } from "../db/schema";
import { seed } from "../db/seed";
import { seedScenarios } from "../db/seed-scenarios";
import { getReviewModel } from "./review-model";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only

beforeAll(async () => {
  await seed();
  await seedScenarios();
}, 120_000);

const viewer = async (email: string) => {
  const [u] = await db().select().from(user).where(eq(user.email, email));
  return { id: u?.id ?? "", email, name: u?.name ?? "", role: (u?.role ?? "DOCUMENTATION_EXECUTIVE") as "DOCUMENTATION_EXECUTIVE" | "DOCUMENTATION_MANAGER" };
};
const shipmentId = async (ref: string) => (await db().select({ id: shipments.id }).from(shipments).where(eq(shipments.ref, ref)))[0]?.id ?? "";

describe("getReviewModel (API_SPECS §3)", () => {
  it("SHP-24811: the CC-03 mismatch as an issue linked to its check, pages per document, fields in registry order", async () => {
    const model = await getReviewModel(await shipmentId("SHP-24811"), await viewer("asha@demo.test"));
    const cc03 = model.checks.find((c) => c.ruleId === "CC-03");
    expect(cc03).toMatchObject({ ruleName: "Gross weight", status: "FAIL", delta: "45.000" });
    expect(cc03?.observed.map((o) => o.value)).toEqual(["3120.000", "3165.000", "3165.000"]);
    expect(model.issues.find((i) => i.type === "CHECK_FAILED")?.checkId).toBe(cc03?.id);
    expect(model.issues).toHaveLength(model.shipment.unresolvedIssuesCount);
    expect(model.pages.INVOICE).toEqual([expect.objectContaining({ pageNo: 1, url: expect.stringMatching(/^\/api\/documents\/[0-9a-f-]+\/pages\/1$/) })]);

    const gross = model.fields.find((f) => f.docType === "INVOICE" && f.fieldKey === "grossWeight");
    expect(gross).toMatchObject({ label: "Gross weight (kg)", display: "3,120.000", needsReview: false, lineNo: null });
    expect(model.fields.filter((f) => f.needsReview).map((f) => f.id).sort()).toEqual(model.issues.flatMap((i) => (i.type === "FIELD_NEEDS_REVIEW" && i.fieldId ? [i.fieldId] : [])).sort());
    expect(model.fields[0]?.docType).toBe("INVOICE");
    expect(model.shipment.importer.contactMasked).toMatch(/^im•+@example\.test$/);
    expect(model.viewer).toMatchObject({ role: "DOCUMENTATION_EXECUTIVE", canApprove: false, canExport: false });
  });

  it("SHP-24819: missing documents show up as issues and empty page lists", async () => {
    const model = await getReviewModel(await shipmentId("SHP-24819"), await viewer("meera@demo.test"));
    expect(model.issues.filter((i) => i.type === "DOCUMENT_MISSING")).toHaveLength(2);
    expect(model.pages.PACKING_LIST).toEqual([]);
  });
});

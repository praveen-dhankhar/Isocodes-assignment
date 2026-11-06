import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { SAMPLE_REFS } from "../../../scripts/sample-data";
import { auth } from "../auth";
import { requireRole } from "../session";
import { db } from "./client";
import { crossCheckResults, documents, fieldEdits, importers, shipments, suppliers, user } from "./schema";
import { isLocalDatabase, seed, supplierKey } from "./seed";
import { seedScenarios } from "./seed-scenarios";

// After the human steps of PLAN M8.4 (approval and export come with M9.4). SHP-24811/24814/24815 are left to review.
const SEEDED_STATUS: Record<string, string> = {
  "SHP-24811": "NEEDS_REVIEW", "SHP-24812": "EXTRACTED", "SHP-24813": "EXTRACTED", "SHP-24814": "NEEDS_REVIEW", "SHP-24815": "NEEDS_REVIEW",
  "SHP-24816": "EXTRACTED", "SHP-24817": "READY_FOR_APPROVAL", "SHP-24818": "ON_HOLD", "SHP-24819": "DRAFT",
};

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // read lazily by env(); test database only
const password = () => process.env.SEED_DEMO_PASSWORD ?? "";

async function signIn(email: string) {
  const response = await auth().api.signInEmail({ body: { email, password: password() }, asResponse: true });
  return new Headers({ cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}

describe("seed (API_SPECS §7.2)", () => {
  it("adds the demo users and masters once", async () => {
    await seed();
    expect(await seed()).toEqual({ users: 0, importers: 0, suppliers: 0 });

    const users = await db().select({ email: user.email, role: user.role }).from(user).where(inArray(user.email, ["asha@demo.test", "vikram@demo.test", "meera@demo.test"]));
    expect(users.sort((a, b) => a.email.localeCompare(b.email))).toEqual([
      { email: "asha@demo.test", role: "DOCUMENTATION_EXECUTIVE" },
      { email: "meera@demo.test", role: "DOCUMENTATION_MANAGER" },
      { email: "vikram@demo.test", role: "DOCUMENTATION_EXECUTIVE" },
    ]);
    expect(await db().select({ iec: importers.iec }).from(importers).where(inArray(importers.iec, ["TESTIEC001", "TESTIEC002", "TESTIEC003"]))).toHaveLength(3);
    const seeded = await db().select({ key: suppliers.normalizedName, country: suppliers.countryCode }).from(suppliers).where(inArray(suppliers.normalizedName, ["COMPANY B", "COMPANY G", "COMPANY H"]));
    expect(seeded.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "COMPANY B", country: "CN" },
      { key: "COMPANY G", country: "US" },
      { key: "COMPANY H", country: "JP" },
    ]);
  });

  it("seeded users sign in with their roles", async () => {
    await seed();
    expect((await requireRole("DOCUMENTATION_MANAGER", await signIn("meera@demo.test"))).name).toBe("Meera Iyer");
    const refused = await requireRole("DOCUMENTATION_MANAGER", await signIn("asha@demo.test")).catch((e: unknown) => e);
    expect(refused instanceof AppError && refused.code).toBe("FORBIDDEN");
  });

  it("matches suppliers by a normalised key", () => {
    expect(supplierKey("  company   b ")).toBe("COMPANY B");
  });

  it.each([
    ["postgres://postgres:postgres@localhost:5433/customs", true],
    ["postgres://u:p@127.0.0.1/customs", true],
    ["postgres://u:p@[::1]:5432/customs", true],
    ["postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", false],
    ["postgres://u:p@localhost.attacker.example/x", false],
  ])("isLocalDatabase(%s) → %s", (url, expected) => {
    expect(isLocalDatabase(url)).toBe(expected);
  });
});

describe("seedScenarios (PLAN M6.1)", () => {
  it("creates the nine sample shipments through the pipeline, once, in their derived states", async () => {
    await seed();
    await seedScenarios();
    expect(await seedScenarios()).toEqual({ shipments: 0 });

    const rows = await db().select().from(shipments).where(inArray(shipments.ref, SAMPLE_REFS));
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    expect(Object.fromEntries(rows.map((r) => [r.ref, r.status]))).toEqual(SEEDED_STATUS);
    const check = async (ref: string, ruleId: string) =>
      db().select({ status: crossCheckResults.status, scope: crossCheckResults.scope }).from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, byRef[ref]?.id ?? ""), eq(crossCheckResults.ruleId, ruleId)));
    expect(await check("SHP-24811", "CC-03")).toEqual([{ status: "FAIL", scope: "shipment" }]);
    expect((await check("SHP-24814", "CC-06")).filter((c) => c.status === "FAIL")).toEqual([{ status: "FAIL", scope: "line:2" }]);
    expect(await db().select().from(documents).where(eq(documents.shipmentId, byRef["SHP-24819"]?.id ?? ""))).toHaveLength(1);
    expect((await db().select().from(documents).where(inArray(documents.shipmentId, rows.map((r) => r.id)))).every((d) => d.mode === "SAMPLE")).toBe(true);

    // The seeded history holds real corrections, a manual entry and a submission by someone other than the creator.
    const edits = await db().select({ action: fieldEdits.action, key: fieldEdits.fieldKey }).from(fieldEdits).where(inArray(fieldEdits.shipmentId, rows.map((r) => r.id)));
    expect(edits.filter((e) => e.action === "CORRECT").map((e) => e.key).sort()).toEqual(["hsCode", "invoiceNumber", "netWeight", "unitPrice"]);
    expect(edits.filter((e) => e.action === "MANUAL_ENTRY")).toHaveLength(2);
    const [vikram] = await db().select({ id: user.id }).from(user).where(eq(user.email, "vikram@demo.test"));
    expect(byRef["SHP-24817"]?.submittedBy).toBe(vikram?.id);
  }, 120_000); // 26 page renders on the first run
});

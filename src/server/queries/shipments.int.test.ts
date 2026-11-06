import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "../db/seed";
import { seedScenarios } from "../db/seed-scenarios";
import { listShipments, listSuppliers } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only

beforeAll(async () => {
  await seed();
  await seedScenarios();
}, 120_000);

describe("listShipments (S2)", () => {
  it("finds a shipment by its invoice number or ref, case-insensitively", async () => {
    expect((await listShipments({ q: "cb-2026-1187" })).map((r) => r.ref)).toContain("SHP-24811");
    expect((await listShipments({ q: "shp-2481" })).map((r) => r.ref)).toEqual(expect.arrayContaining(["SHP-24811", "SHP-24819"]));
  });

  it("treats LIKE wildcards in the search as text", async () => {
    expect(await listShipments({ q: "%" })).toEqual([]);
    expect(await listShipments({ q: "SHP_24811" })).toEqual([]);
  });

  it("filters by status and supplier, with counts for the row", async () => {
    const drafts = await listShipments({ status: "DRAFT" });
    expect(drafts.every((r) => r.status === "DRAFT")).toBe(true);
    expect(drafts.find((r) => r.ref === "SHP-24819")).toMatchObject({ documentCount: 1, supplier: "Company C", importer: "Company R", invoiceNumber: "CC-2026-0455" });

    const companyH = (await listSuppliers()).find((s) => s.name === "Company H");
    const rows = await listShipments({ supplierId: companyH?.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.supplier === "Company H")).toBe(true);
  });
});

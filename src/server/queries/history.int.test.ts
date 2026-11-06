import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { auditLogs, importers, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { seedScenarios } from "../db/seed-scenarios";
import { revealImporterContact } from "../services/importers";
import { getShipmentHistory } from "./history";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only

beforeAll(async () => {
  await seed();
  await seedScenarios();
}, 120_000);

describe("S8 history and contact reveal", () => {
  it("merges audit events and field edits, newest first", async () => {
    const [s] = await db().select().from(shipments).where(eq(shipments.ref, "SHP-24816"));
    const events = await getShipmentHistory(s?.id ?? "");
    const texts = events.map((e) => `${e.actor} ${e.text}`);
    expect(texts).toEqual(expect.arrayContaining(["Meera Iyer exported CF-1", "Meera Iyer approved", "Vikram Shah submitted for approval", "Asha Rao confirmed Invoice · Invoice date"]));
    expect(events.find((e) => e.text === "confirmed Invoice · Invoice date")?.detail).toBe("3 Oct 2026"); // US supplier: 10/03 is 3 October
    expect([...events].sort((a, b) => b.at.localeCompare(a.at))).toEqual(events);
  });

  it("reveals an importer contact once and logs it without the contact itself", async () => {
    const [imp] = await db().select().from(importers).where(eq(importers.iec, "TESTIEC001"));
    const [s] = await db().select().from(shipments).where(eq(shipments.ref, "SHP-24811"));
    const contact = await revealImporterContact({ importerId: imp?.id ?? "", shipmentId: s?.id ?? null, actorId: "int-test" });
    expect(contact.contactEmail).toBe("imports.p@example.test");
    const [log] = await db().select().from(auditLogs).where(eq(auditLogs.action, "PII_REVEALED"));
    expect(JSON.stringify(log?.metadata)).not.toContain("example.test");
  });
});

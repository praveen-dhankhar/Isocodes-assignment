import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, extractedFields, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { approveShipment, reopenShipment, sendBack } from "./approval";
import { extractDocument } from "./extraction";
import { acceptDiscrepancy } from "./resolutions";
import { confirmField, submitForApproval } from "./review";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const EXEC = { id: "exec-a", role: "DOCUMENTATION_EXECUTIVE" as const };
const MANAGER = { id: "manager-m", role: "DOCUMENTATION_MANAGER" as const };
const recorded = (sha: string) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const ship = async (id: string) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0];
const version = async (id: string) => (await ship(id))?.version ?? 0;

beforeAll(async () => {
  await seed();
});

async function sample(ref: string) {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: ref, actorId: EXEC.id });
  for (const id of Object.values(documentIds)) if (id) await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: EXEC.id }, { providers: recorded });
  return { shipmentId, ids: documentIds };
}

/** SHP-24812 is clean: submitted straight away by an executive. */
async function submitted() {
  const { shipmentId } = await sample("SHP-24812");
  await submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
  return shipmentId;
}

describe("approval (API_SPECS §5.3, PRD §10.3 gate 2)", () => {
  it("only a manager approves, never their own submission", async () => {
    const shipmentId = await submitted();
    expect(await code(approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: EXEC }))).toBe("FORBIDDEN");

    const own = await sample("SHP-24812");
    await submitForApproval({ shipmentId: own.shipmentId, expectedVersion: await version(own.shipmentId), actor: MANAGER });
    expect(await code(approveShipment({ shipmentId: own.shipmentId, expectedVersion: await version(own.shipmentId), acknowledgedCheckIds: [], actor: MANAGER }))).toBe("SELF_APPROVAL_FORBIDDEN");

    const ok = await approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: MANAGER });
    expect(ok.status).toBe("APPROVED");
    const row = await ship(shipmentId);
    expect(row).toMatchObject({ status: "APPROVED", approvedBy: MANAGER.id });
    expect(row?.approvedAt && row.lastDataChangeAt <= row.approvedAt).toBe(true);
  });

  it("every accepted discrepancy must be acknowledged", async () => {
    const { shipmentId, ids } = await sample("SHP-24811");
    const cc03 = (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, "CC-03"))))[0];
    await acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "3165", note: "Carrier re-weighed; B/L is final.", actor: EXEC });
    const net = (await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, ids.PACKING_LIST ?? ""), eq(extractedFields.fieldKey, "netWeight"), isNull(extractedFields.lineItemId))))[0];
    await confirmField({ fieldId: net?.id ?? "", expectedFieldVersion: net?.version ?? 1, actorId: EXEC.id });
    await submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });

    expect(await code(approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: MANAGER }))).toBe("VALIDATION_FAILED");
    await approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [cc03?.id ?? ""], actor: MANAGER });
    expect((await db().select().from(crossCheckResults).where(eq(crossCheckResults.id, cc03?.id ?? "")))[0]?.acknowledgedBy).toBe(MANAGER.id);
  });

  it("send back re-derives the status; reopen opens an approved shipment again", async () => {
    const shipmentId = await submitted();
    expect(await code(sendBack({ shipmentId, expectedVersion: await version(shipmentId), note: "Check the invoice date.", actor: EXEC }))).toBe("FORBIDDEN");
    const back = await sendBack({ shipmentId, expectedVersion: await version(shipmentId), note: "Check the invoice date.", actor: MANAGER });
    expect(back.status).toBe("EXTRACTED");
    expect((await ship(shipmentId))?.submittedBy).toBeNull();

    await submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
    await approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: MANAGER });
    const reopened = await reopenShipment({ shipmentId, expectedVersion: await version(shipmentId), reason: "Importer sent an amended invoice.", actor: MANAGER });
    expect(reopened.status).toBe("EXTRACTED");
    expect(await ship(shipmentId)).toMatchObject({ approvedBy: null, approvedAt: null });
    expect((await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action)).toEqual(expect.arrayContaining(["SENT_BACK", "APPROVED", "REOPENED"]));
  });
});

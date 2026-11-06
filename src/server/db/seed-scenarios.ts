import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { SAMPLES } from "../../../scripts/sample-data";
import { selectProviders } from "../ai/provider";
import { extractDocument } from "../services/extraction";
import { createSampleShipment } from "../services/shipments";
import { db } from "./client";
import { HUMAN_SCENARIOS, steps, touchedByPeople } from "./scenario-steps";
import { documents, shipments, user } from "./schema";

// PLAN M6.1: each sample shipment goes through the real services (create, upload the bundled files, extract from the
// recorded samples), never through hand-written rows. A live model is never called here, whatever EXTRACTION_MODE says.
const recordedOnly = (sha256: string) =>
  selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha256);

/**
 * Idempotent by ref: an existing sample shipment is not recreated, but a document a crashed run left unread is
 * extracted. Then the human steps (scenario-steps.ts) run once per shipment. Run after `seed()` (it needs the users).
 */
export async function seedScenarios(): Promise<{ shipments: number }> {
  const people = await db().select({ id: user.id, email: user.email, role: user.role }).from(user).where(inArray(user.email, ["asha@demo.test", "vikram@demo.test", "meera@demo.test"]));
  const asha = people.find((p) => p.email === "asha@demo.test");
  const vikram = people.find((p) => p.email === "vikram@demo.test");
  const meera = people.find((p) => p.email === "meera@demo.test");
  if (!asha || !vikram || !meera) throw new Error("The demo users are missing; seed them first");
  const existing = new Map(
    (await db().select({ id: shipments.id, ref: shipments.ref }).from(shipments).where(inArray(shipments.ref, SAMPLES.map((s) => s.ref)))).map((r) => [r.ref, r.id]),
  );

  let created = 0;
  for (const sample of SAMPLES) {
    let shipmentId = existing.get(sample.ref);
    if (!shipmentId) {
      shipmentId = (await createSampleShipment({ sampleRef: sample.ref, ref: sample.ref, actorId: asha.id })).shipmentId;
      created++;
    }
    const unread = await db()
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.shipmentId, shipmentId), isNull(documents.supersededAt), inArray(documents.status, ["UPLOADED", "FAILED"])));
    for (const { id } of unread) {
      const { document } = await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: asha.id }, { providers: recordedOnly });
      if (document.status !== "EXTRACTED") throw new Error(`${sample.ref} ${document.docType}: extraction ${document.status} ${document.errorCode ?? ""}`);
    }
    const human = HUMAN_SCENARIOS[sample.ref];
    if (human && !(await touchedByPeople(shipmentId))) await human(steps(shipmentId), { asha, vikram, meera });
  }
  return { shipments: created };
}

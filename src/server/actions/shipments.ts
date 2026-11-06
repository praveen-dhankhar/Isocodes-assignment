"use server";

import { z } from "zod";
import { runAction } from "@/lib/result";
import { SAMPLE_REFS } from "../../../scripts/sample-data";
import { createSampleShipment as createSample, createShipment as create } from "../services/shipments";
import { requireUser } from "../session";

// API_SPECS §5.1. A "use server" module may export only async functions, so input schemas stay module-private.
const CreateShipmentInput = z.object({ importerId: z.uuid(), supplierId: z.uuid() });
const CreateSampleShipmentInput = z.object({ sampleRef: z.enum(SAMPLE_REFS) });

export async function createShipment(input: unknown) {
  return runAction(async () => {
    const data = CreateShipmentInput.parse(input);
    const user = await requireUser();
    return create({ ...data, actorId: user.id });
  });
}

export async function createSampleShipment(input: unknown) {
  return runAction(async () => {
    const data = CreateSampleShipmentInput.parse(input);
    const user = await requireUser();
    return createSample({ ...data, actorId: user.id });
  });
}

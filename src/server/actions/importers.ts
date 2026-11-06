"use server";

import { z } from "zod";
import { runAction } from "@/lib/result";
import { revealImporterContact as reveal } from "../services/importers";
import { requireUser } from "../session";

// API_SPECS §5.4. The shipment id only ties the audit entry to the shipment's history.
const RevealInput = z.object({ importerId: z.uuid(), shipmentId: z.uuid().nullable().default(null) });

export async function revealImporterContact(input: unknown) {
  return runAction(async () => {
    const data = RevealInput.parse(input);
    const user = await requireUser();
    return reveal({ ...data, actorId: user.id });
  });
}

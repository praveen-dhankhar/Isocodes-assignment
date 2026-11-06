"use server";

import { z } from "zod";
import { runAction } from "@/lib/result";
import { approveShipment as approve, reopenShipment as reopen, sendBack as back } from "../services/approval";
import { requireRole } from "../session";

// API_SPECS §5.3: manager only. Schemas stay module-private ("use server").
const Base = z.object({ shipmentId: z.uuid(), expectedVersion: z.int().min(0) });
const ApproveInput = Base.extend({ acknowledgedCheckIds: z.array(z.uuid()) });
const SendBackInput = Base.extend({ note: z.string().trim().min(10).max(1000) });
const ReopenInput = Base.extend({ reason: z.string().trim().min(10).max(1000) });

export async function approveShipment(input: unknown) {
  return runAction(async () => {
    const data = ApproveInput.parse(input);
    const user = await requireRole("DOCUMENTATION_MANAGER");
    return approve({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function sendBack(input: unknown) {
  return runAction(async () => {
    const data = SendBackInput.parse(input);
    const user = await requireRole("DOCUMENTATION_MANAGER");
    return back({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function reopenShipment(input: unknown) {
  return runAction(async () => {
    const data = ReopenInput.parse(input);
    const user = await requireRole("DOCUMENTATION_MANAGER");
    return reopen({ ...data, actor: { id: user.id, role: user.role } });
  });
}

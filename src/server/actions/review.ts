"use server";

import { z } from "zod";
import { runAction } from "@/lib/result";
import { addLineItem as addLine, dismissWrongType as dismiss, markPageUnreadable as markUnreadable, removeLineItem as removeLine, startManualEntry as startManual } from "../services/manual-entry";
import { confirmField as confirm, setFieldValue as setValue, submitForApproval as submit } from "../services/review";
import { requireUser } from "../session";

// API_SPECS §5.2. Validate → authorise → one service call → ActionResult. Schemas stay module-private ("use server").
const Version = z.int().min(0);
const ConfirmInput = z.object({ fieldId: z.uuid(), expectedFieldVersion: Version });
const SetValueInput = z.object({ fieldId: z.uuid(), expectedFieldVersion: Version, input: z.string().trim().min(1).max(500) });
const DocumentInput = z.object({ documentId: z.uuid(), expectedVersion: Version });
const LineInput = DocumentInput.extend({ lineNo: z.int().min(1) });
const PageInput = DocumentInput.extend({ pageNo: z.int().min(1) });
const ShipmentInput = z.object({ shipmentId: z.uuid(), expectedVersion: Version });

export async function confirmField(input: unknown) {
  return runAction(async () => {
    const data = ConfirmInput.parse(input);
    const user = await requireUser();
    return confirm({ ...data, actorId: user.id });
  });
}

export async function setFieldValue(input: unknown) {
  return runAction(async () => {
    const data = SetValueInput.parse(input);
    const user = await requireUser();
    return setValue({ ...data, actorId: user.id });
  });
}

export async function addLineItem(input: unknown) {
  return runAction(async () => {
    const data = DocumentInput.parse(input);
    const user = await requireUser();
    return addLine({ ...data, actorId: user.id });
  });
}

export async function removeLineItem(input: unknown) {
  return runAction(async () => {
    const data = LineInput.parse(input);
    const user = await requireUser();
    return removeLine({ ...data, actorId: user.id });
  });
}

export async function markPageUnreadable(input: unknown) {
  return runAction(async () => {
    const data = PageInput.parse(input);
    const user = await requireUser();
    return markUnreadable({ ...data, actorId: user.id });
  });
}

export async function dismissWrongType(input: unknown) {
  return runAction(async () => {
    const data = DocumentInput.parse(input);
    const user = await requireUser();
    return dismiss({ ...data, actorId: user.id });
  });
}

export async function startManualEntry(input: unknown) {
  return runAction(async () => {
    const data = DocumentInput.parse(input);
    const user = await requireUser();
    return startManual({ ...data, actorId: user.id });
  });
}

export async function submitForApproval(input: unknown) {
  return runAction(async () => {
    const data = ShipmentInput.parse(input);
    const user = await requireUser();
    return submit({ ...data, actor: { id: user.id, role: user.role } });
  });
}

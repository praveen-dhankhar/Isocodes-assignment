"use server";

import { z } from "zod";
import { runAction } from "@/lib/result";
import { addLineItem as addLine, dismissWrongType as dismiss, markPageUnreadable as markUnreadable, removeLineItem as removeLine, startManualEntry as startManual } from "../services/manual-entry";
import {
  acceptDiscrepancy as accept,
  acknowledgeMissing as acknowledge,
  clearResolution as clear,
  raiseImporterQuery as raiseQuery,
  resumeFromHold as resume,
} from "../services/resolutions";
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
const Note = z.string().trim().min(10).max(1000);
const CheckInput = z.object({ checkId: z.uuid(), expectedVersion: Version });
const AcceptInput = CheckInput.extend({ declaredValue: z.string().trim().min(1).max(500), note: Note });
const AcknowledgeInput = CheckInput.extend({ note: Note });
const QueryInput = ShipmentInput.extend({ checkIds: z.array(z.uuid()).min(1), message: z.string().trim().min(10).max(2000) });
const ResumeInput = ShipmentInput.extend({ note: z.string().trim().min(5).max(1000) });

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

export async function acceptDiscrepancy(input: unknown) {
  return runAction(async () => {
    const data = AcceptInput.parse(input);
    const user = await requireUser();
    return accept({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function acknowledgeMissing(input: unknown) {
  return runAction(async () => {
    const data = AcknowledgeInput.parse(input);
    const user = await requireUser();
    return acknowledge({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function clearResolution(input: unknown) {
  return runAction(async () => {
    const data = CheckInput.parse(input);
    const user = await requireUser();
    return clear({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function raiseImporterQuery(input: unknown) {
  return runAction(async () => {
    const data = QueryInput.parse(input);
    const user = await requireUser();
    return raiseQuery({ ...data, actor: { id: user.id, role: user.role } });
  });
}

export async function resumeFromHold(input: unknown) {
  return runAction(async () => {
    const data = ResumeInput.parse(input);
    const user = await requireUser();
    return resume({ ...data, actor: { id: user.id, role: user.role } });
  });
}

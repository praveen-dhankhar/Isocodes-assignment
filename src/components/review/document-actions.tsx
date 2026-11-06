"use client";

import { FileX2, PencilLine, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UploadSlot, type SlotState } from "@/components/shipments/upload-slot";
import { uploadFile } from "@/components/shipments/upload";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReasonButton } from "@/components/ui/reason-button";
import { DOC_LABEL, type DocType } from "@/domain/fields";
import { addLineItem, dismissWrongType, markPageUnreadable, removeLineItem, startManualEntry } from "@/server/actions/review";
import { useReviewAction } from "./use-review-action";

/** Upload into a slot from S4: a missing document, or a replacement (the old file is kept for audit, A-23). */
export function SlotUpload({ shipmentId, docType, onDone }: { shipmentId: string; docType: DocType; onDone?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<SlotState>({ phase: "empty" });
  const busy = state.phase === "uploading";
  async function send() {
    if (state.phase !== "ready" && state.phase !== "failed") return;
    const file = state.file;
    setState({ phase: "uploading", file, progress: 0 });
    const r = await uploadFile(shipmentId, docType, file, (progress) => setState({ phase: "uploading", file, progress }));
    setState(r.ok ? { phase: "uploaded", file } : { phase: "failed", file, error: r.message });
    if (r.ok) {
      onDone?.();
      router.refresh(); // the review screen starts extraction for the new upload
    }
  }
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <UploadSlot label={DOC_LABEL[docType]} hint="PDF, JPEG or PNG" state={state} onChange={setState} disabled={busy || state.phase === "uploaded"} />
      <ReasonButton size="sm" reason={state.phase === "ready" || state.phase === "failed" ? null : "Choose a file first"} disabled={busy} onClick={() => void send()}>
        <Upload aria-hidden /> {busy ? "Uploading…" : "Upload"}
      </ReasonButton>
    </div>
  );
}

export function ReplaceFileButton({ shipmentId, docType, readOnly }: { shipmentId: string; docType: DocType; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ReasonButton size="xs" variant="ghost" reason={readOnly ? "Exported shipments are read-only until reopened" : null} onClick={() => setOpen(true)}>
        <Upload aria-hidden /> Replace file
      </ReasonButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace the {DOC_LABEL[docType].toLowerCase()}</DialogTitle>
            <DialogDescription>The new file is read from scratch. The old one and its edits stay in the history.</DialogDescription>
          </DialogHeader>
          <SlotUpload shipmentId={shipmentId} docType={docType} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** PRD F7: the page can't be read; its values are cleared and typed in by hand (recorded as manual entries). */
export function MarkUnreadableButton({ documentId, pageNo, version, reason }: { documentId: string; pageNo: number; version: number; reason: string | null }) {
  const { run, pending } = useReviewAction();
  return (
    <ReasonButton size="xs" variant="ghost" reason={reason} disabled={pending} onClick={() => void run(markPageUnreadable, { documentId, pageNo, expectedVersion: version })}>
      <FileX2 aria-hidden /> Page unreadable
    </ReasonButton>
  );
}

/** PRD F2.3: after a failed extraction, type the values in instead (or retry). */
export function EnterManuallyButton({ documentId, version }: { documentId: string; version: number }) {
  const { run, pending } = useReviewAction();
  return (
    <Button size="xs" variant="outline" disabled={pending} onClick={() => void run(startManualEntry, { documentId, expectedVersion: version })}>
      <PencilLine aria-hidden /> Enter manually
    </Button>
  );
}

/** PRD F2.4: the model thought the file was another document type; the user knows better. */
export function KeepTypeButton({ documentId, docType, version }: { documentId: string; docType: DocType; version: number }) {
  const { run, pending } = useReviewAction();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(dismissWrongType, { documentId, expectedVersion: version })}>
      Keep as {DOC_LABEL[docType].toLowerCase()}
    </Button>
  );
}

/** PRD F7: a table on an unreadable page is typed in line by line. Only hand-added lines can be removed. */
export function AddLineButton({ documentId, version }: { documentId: string; version: number }) {
  const { run, pending } = useReviewAction();
  return (
    <Button size="xs" variant="ghost" disabled={pending} onClick={() => void run(addLineItem, { documentId, expectedVersion: version })}>
      <Plus aria-hidden /> Add line
    </Button>
  );
}

export function RemoveLineButton({ documentId, lineNo, version }: { documentId: string; lineNo: number; version: number }) {
  const { run, pending } = useReviewAction();
  return (
    <Button size="xs" variant="ghost" aria-label={`Remove line ${lineNo}`} disabled={pending} onClick={() => void run(removeLineItem, { documentId, lineNo, expectedVersion: version })}>
      <Trash2 aria-hidden /> Remove
    </Button>
  );
}

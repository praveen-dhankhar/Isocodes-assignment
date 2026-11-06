"use client";

import { useState } from "react";
import { ReasonButton } from "@/components/ui/reason-button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { approveShipment, reopenShipment, sendBack } from "@/server/actions/approval";
import { useReviewAction } from "@/components/review/use-review-action";

interface Props {
  shipmentId: string;
  version: number;
  status: string;
  isManager: boolean;
  selfSubmitted: boolean;
  unresolved: number;
  acknowledged: string[];
  toAcknowledge: number;
}

/** Approve / send back (READY_FOR_APPROVAL) and reopen (APPROVED, EXPORTED). Every disabled button says why. */
export function ApprovalActions({ shipmentId, version, status, isManager, selfSubmitted, unresolved, acknowledged, toAcknowledge }: Props) {
  const { run, pending } = useReviewAction();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shortNote = note.trim().length < 10 ? "Write at least 10 characters" : null;
  const notManager = isManager ? null : "Only a documentation manager can do this";
  const act = async (result: Promise<{ ok: boolean; error?: { message: string; code: string } }>) => {
    setError(null);
    const r = await result;
    if (!r.ok && r.error && r.error.code !== "VERSION_CONFLICT") setError(r.error.message);
    else if (r.ok) setNote("");
  };

  if (status === "APPROVED" || status === "EXPORTED") {
    return (
      <section aria-labelledby="reopen-heading" className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="reopen-heading" className="font-medium">
          Reopen for changes
        </h2>
        <p className="text-sm text-muted-foreground">For an amendment: the shipment goes back to review and needs submitting and approving again. Earlier exports stay in the history.</p>
        <Label htmlFor="reopen-reason">Reason</Label>
        <Textarea id="reopen-reason" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={!isManager} />
        {error && <p role="alert" className="text-sm">{error}</p>}
        <div>
          <ReasonButton variant="outline" reason={notManager ?? shortNote} disabled={pending} onClick={() => void act(run(reopenShipment, { shipmentId, expectedVersion: version, reason: note.trim() }))}>
            Reopen
          </ReasonButton>
        </div>
      </section>
    );
  }

  const approveReason =
    notManager ??
    (status !== "READY_FOR_APPROVAL" ? "The shipment has not been submitted for approval" : null) ??
    (selfSubmitted ? "You submitted this shipment; another manager must approve it (A-14)" : null) ??
    (unresolved > 0 ? `${unresolved} unresolved issue(s) remain` : null) ??
    (acknowledged.length < toAcknowledge ? "Tick every accepted discrepancy first" : null);
  const backReason = notManager ?? (status !== "READY_FOR_APPROVAL" ? "Only a submitted shipment can be sent back" : null) ?? shortNote;

  return (
    <section aria-label="Decision" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="send-back-note">Note for the executive (to send back)</Label>
        <Textarea id="send-back-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={!isManager} placeholder="e.g. The B/L weight needs the carrier's re-weigh slip attached." />
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <ReasonButton reason={approveReason} disabled={pending} onClick={() => void act(run(approveShipment, { shipmentId, expectedVersion: version, acknowledgedCheckIds: acknowledged }))}>
          Approve
        </ReasonButton>
        <ReasonButton variant="outline" reason={backReason} disabled={pending} onClick={() => void act(run(sendBack, { shipmentId, expectedVersion: version, note: note.trim() }))}>
          Send back
        </ReasonButton>
      </div>
    </section>
  );
}

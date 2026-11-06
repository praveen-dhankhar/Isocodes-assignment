"use client";

import { Keyboard, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, type MutableRefObject } from "react";
import { Button } from "@/components/ui/button";
import { ReasonButton } from "@/components/ui/reason-button";
import { submitForApproval } from "@/server/actions/review";
import type { ReviewModel } from "@/server/queries/review-model";
import { useReviewAction } from "./use-review-action";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Why submit can't run yet, in the user's words (PRD §10.3 gate 1, mirrored from the server). */
export function submitBlocker(model: ReviewModel): string | null {
  const { status, unresolvedIssuesCount: n } = model.shipment;
  if (status === "ON_HOLD") return "On hold: resume once the importer replies";
  if (status === "READY_FOR_APPROVAL") return "Already submitted; waiting for a manager";
  if (status === "APPROVED" || status === "EXPORTED") return "Already approved";
  if (status === "DRAFT" || status === "EXTRACTING") return "All three documents must be uploaded and read first";
  if (n > 0) return `${plural(n, "issue")} left: resolve them to submit`;
  return null;
}

/** Bottom of the panel: issues left, Submit (Ctrl/⌘+Enter) and the shortcut sheet. */
export function SubmitBar({ model, submitRef, onHelp }: { model: ReviewModel; submitRef: MutableRefObject<(() => void) | null>; onHelp: () => void }) {
  const { run, pending } = useReviewAction();
  const blocker = submitBlocker(model);
  const n = model.shipment.unresolvedIssuesCount;
  const submit = () => {
    if (!blocker && !pending) void run(submitForApproval, { shipmentId: model.shipment.id, expectedVersion: model.shipment.version });
  };
  useEffect(() => {
    submitRef.current = submit;
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-t bg-background px-4 py-3">
      <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" aria-keyshortcuts="?" onClick={onHelp}>
        <Keyboard aria-hidden />
      </Button>
      <p className="text-sm" aria-live="polite">
        {model.shipment.status === "READY_FOR_APPROVAL" ? (
          "Submitted. A manager approves next."
        ) : n === 0 ? (
          "No issues left."
        ) : (
          <>
            <span className="font-medium tabular-nums">{n}</span> {n === 1 ? "issue" : "issues"} left
          </>
        )}
      </p>
      <div className="ml-auto flex items-center gap-2">
        {model.shipment.status === "READY_FOR_APPROVAL" && model.viewer.role === "DOCUMENTATION_MANAGER" && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/shipments/${model.shipment.id}/approval`}>Open approval</Link>
          </Button>
        )}
        <ReasonButton size="sm" reason={blocker} disabled={pending} onClick={submit} aria-keyshortcuts="Control+Enter Meta+Enter">
          <Send aria-hidden />
          {pending ? "Submitting…" : "Submit for approval"}
        </ReasonButton>
      </div>
    </div>
  );
}

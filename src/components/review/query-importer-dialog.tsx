"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ReasonButton } from "@/components/ui/reason-button";
import { Textarea } from "@/components/ui/textarea";
import { raiseImporterQuery, resumeFromHold } from "@/server/actions/review";
import type { ReviewModel } from "@/server/queries/review-model";
import { useReviewAction } from "./use-review-action";

const scopeLabel = (scope: string) => (scope === "shipment" ? "" : ` · ${scope.replace("pl-line:", "PL line ").replace("line:", "line ")}`);

/** PRD F3.4 / F6 "Query importer": a mock notification to the importer; the shipment waits ON_HOLD for the reply. */
export function QueryImporterDialog({ model, initialCheckId, open, onOpenChange }: { model: ReviewModel; initialCheckId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryable = model.checks.filter((c) => (c.status === "FAIL" || c.status === "INCOMPLETE") && c.resolution !== "DISCREPANCY_ACCEPTED");
  const [selected, setSelected] = useState<string[]>(initialCheckId ? [initialCheckId] : []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useReviewAction();
  const blocked = selected.length === 0 ? "Pick at least one check to ask about" : message.trim().length < 10 ? "Write at least 10 characters" : null;

  async function send() {
    setError(null);
    const result = await run(raiseImporterQuery, { shipmentId: model.shipment.id, expectedVersion: model.shipment.version, checkIds: selected, message: message.trim() });
    if (result.ok || result.error.code === "VERSION_CONFLICT") onOpenChange(false);
    else setError(result.error.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Query importer · {model.shipment.importer.name}</DialogTitle>
          <DialogDescription className="text-pretty">
            Sent to the importer&apos;s contact on file (<span className="font-mono">{model.shipment.importer.contactMasked}</span>). The shipment goes on hold
            until you resume it with their answer. In this demo the message is recorded, not emailed.
          </DialogDescription>
        </DialogHeader>
        <form
          id="query-importer"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked && !pending) void send();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">About</legend>
            {queryable.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(c.id)} onCheckedChange={(on) => setSelected((s) => (on ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                {c.ruleId} {c.ruleName}
                <span className="text-muted-foreground">{scopeLabel(c.scope)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-message">Message</Label>
            <Textarea id="query-message" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. The packing list shows 10,000 USB-C receptacles but the invoice bills 12,000. Which quantity was shipped?" />
          </div>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ReasonButton type="submit" form="query-importer" reason={blocked} disabled={pending}>
            {pending ? "Sending…" : "Send and put on hold"}
          </ReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** PRD F6 "Resume": the importer answered; open queries close and the status is derived from the data again. */
export function ResumeDialog({ model, open, onOpenChange }: { model: ReviewModel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useReviewAction();
  const blocked = note.trim().length < 5 ? "Note what the importer said (at least 5 characters)" : null;

  async function resume() {
    setError(null);
    const result = await run(resumeFromHold, { shipmentId: model.shipment.id, expectedVersion: model.shipment.version, note: note.trim() });
    if (result.ok || result.error.code === "VERSION_CONFLICT") onOpenChange(false);
    else setError(result.error.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resume from hold</DialogTitle>
          <DialogDescription>Record the importer&apos;s answer. Then correct values or accept the discrepancy as their reply requires.</DialogDescription>
        </DialogHeader>
        <form
          id="resume-hold"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked && !pending) void resume();
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="resume-note">Importer&apos;s answer</Label>
          <Textarea id="resume-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ReasonButton type="submit" form="resume-hold" reason={blocked} disabled={pending}>
            {pending ? "Resuming…" : "Resume"}
          </ReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ReasonButton } from "@/components/ui/reason-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { declaredDefault, RULE_FIELD } from "@/domain/export/precedence";
import { DOC_LABEL } from "@/domain/fields";
import { formatFieldValue } from "@/lib/format";
import { acceptDiscrepancy, acknowledgeMissing } from "@/server/actions/review";
import type { CheckDTO, ReviewModel } from "@/server/queries/review-model";
import { SHORT } from "./labels";
import { useReviewAction } from "./use-review-action";

const MIN_NOTE = 10;

/**
 * PRD F3.4–F3.5. FAIL → "Accept discrepancy": the documents really disagree; declare the value to file (prefilled by
 * export precedence, A-05) and say why. INCOMPLETE → "Acknowledge not on document" with a note. Fixing a misread is
 * not done here: that is Correct on the field (rule 5).
 */
export function ResolveCheckDialog({ check, model, open, onOpenChange }: { check: CheckDTO; model: ReviewModel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const accepting = check.status === "FAIL";
  const { kind } = RULE_FIELD[check.ruleId];
  const observed = check.observed.map((o) => ({ ...o, fieldKey: model.fields.find((f) => f.id === o.fieldId)?.fieldKey ?? "" }));
  const suggested = declaredDefault(check.ruleId, observed);
  const [declared, setDeclared] = useState(suggested ? formatFieldValue(kind, suggested.value) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useReviewAction();
  const noteShort = note.trim().length < MIN_NOTE;
  const blocked = noteShort ? `Write at least ${MIN_NOTE} characters explaining why` : accepting && !declared.trim() ? "Enter the value to declare" : null;

  async function submit() {
    setError(null);
    const input = { checkId: check.id, expectedVersion: model.shipment.version, note: note.trim(), ...(accepting ? { declaredValue: declared.trim() } : {}) };
    const result = accepting ? await run(acceptDiscrepancy, input) : await run(acknowledgeMissing, input);
    if (result.ok || result.error.code === "VERSION_CONFLICT") onOpenChange(false);
    else setError(result.error.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {accepting ? "Accept discrepancy" : "Acknowledge not on document"} · {check.ruleId} {check.ruleName}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {accepting
              ? "Use this when the documents genuinely disagree. If the AI misread a value, close this and correct the field instead. The manager must acknowledge this at approval."
              : "Use this when the value is genuinely not printed on the document. If it is printed, close this and enter it on the field instead."}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/60 p-3 text-sm">
          {check.observed.map((o, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{SHORT[o.docType]}</dt>
              <dd className="tabular-nums">{o.display}</dd>
            </div>
          ))}
        </dl>

        <form
          id="resolve-check"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked && !pending) void submit();
          }}
        >
          {accepting && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="declared">Value to file</Label>
              <Input id="declared" value={declared} onChange={(e) => setDeclared(e.target.value)} className="tabular-nums" autoComplete="off" />
              {suggested && <p className="text-xs text-muted-foreground">Prefilled with the {DOC_LABEL[suggested.docType].toLowerCase()} value, which export files by default (A-05).</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="note">Reason</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder={accepting ? "e.g. Carrier re-weighed the container at Ningbo; B/L weight is final." : "e.g. Supplier does not print net weight on the B/L."} />
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
          <ReasonButton type="submit" form="resolve-check" reason={blocked} disabled={pending}>
            {pending ? "Saving…" : accepting ? "Accept discrepancy" : "Acknowledge"}
          </ReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

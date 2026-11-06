"use client";

import { Check, CircleAlert, FileWarning, MessageSquareMore, PencilLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonButton } from "@/components/ui/reason-button";
import { StateBadge } from "@/components/ui/state-badge";
import { cn } from "@/lib/cn";
import type { IssueDTO, ReviewModel } from "@/server/queries/review-model";
import { CheckList, CheckSummary } from "./check-card";
import { KeepTypeButton } from "./document-actions";
import type { FieldActions } from "./field-actions";
import { SHORT } from "./labels";
import { QueryImporterDialog, ResumeDialog } from "./query-importer-dialog";
import { ResolveCheckDialog } from "./resolve-check-dialog";
import type { Focus } from "./workstation";

type Select = (f: { fieldId: string } | { checkId: string }) => void;
type DialogState = { kind: "resolve"; checkId: string } | { kind: "query"; checkId: string | null } | { kind: "resume" } | null;

// Crimson first (documents disagree), then amber (low confidence), then everything else.
const RANK: Record<IssueDTO["type"], number> = {
  CHECK_FAILED: 0, FIELD_NEEDS_REVIEW: 1, DOCUMENT_MISSING: 2, DOCUMENT_NOT_READY: 2, WRONG_DOCUMENT_TYPE: 2, CHECK_INCOMPLETE: 3, IMPORTER_QUERY_OPEN: 4,
};
export const sortIssues = (issues: IssueDTO[]) => [...issues].sort((a, b) => RANK[a.type] - RANK[b.type]);

/** S4 issues panel (PRD F3.1): every blocking item, most serious first; selecting one shows its source. */
export function IssuesPanel({ model, focus, select, actions, edit }: { model: ReviewModel; focus: Focus; select: Select; actions: FieldActions; edit: (fieldId: string) => void }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const issues = sortIssues(model.issues);
  const checks = new Map(model.checks.map((c) => [c.id, c]));
  const fields = new Map(model.fields.map((f) => [f.id, f]));
  const status = model.shipment.status;
  const exported = status === "EXPORTED";
  const queryReason = status === "ON_HOLD" ? "Already waiting for the importer" : status === "NEEDS_REVIEW" || status === "EXTRACTED" ? null : "Only a shipment under review can be queried";
  const selected = (i: IssueDTO) => (focus?.kind === "check" ? focus.checkId === i.checkId : focus?.kind === "field" && focus.fieldId === i.fieldId);
  const close = (open: boolean) => !open && setDialog(null);
  const resolving = dialog?.kind === "resolve" ? checks.get(dialog.checkId) : undefined;

  return (
    <section aria-labelledby="issues-heading" className="flex flex-col gap-3 p-4">
      <h2 id="issues-heading" className="text-sm font-semibold">
        {issues.length === 0 ? "No open issues" : <>Open issues <span className="font-normal tabular-nums text-muted-foreground">{issues.length}</span></>}
      </h2>
      {issues.length === 0 && <p className="text-sm text-muted-foreground text-pretty">Every value is confident or confirmed and every check passes or is resolved.</p>}
      <ul aria-label="Open issues" className="flex flex-col gap-2">
        {issues.map((issue, n) => {
          const check = issue.checkId ? checks.get(issue.checkId) : undefined;
          const field = issue.fieldId ? fields.get(issue.fieldId) : undefined;
          const target = issue.fieldId ? { fieldId: issue.fieldId } : issue.checkId ? { checkId: issue.checkId } : null;
          return (
            <li key={`${issue.type}-${issue.fieldId ?? issue.checkId ?? issue.documentId ?? n}`} className={cn("rounded-lg border transition-colors duration-150", selected(issue) && "border-foreground/40 bg-muted/60")}>
              <button type="button" disabled={!target} aria-pressed={selected(issue)} onClick={() => target && select(target)} className="flex w-full flex-col gap-2 rounded-lg p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted/60">
                {(issue.type === "CHECK_FAILED" || issue.type === "CHECK_INCOMPLETE") && check ? (
                  check.status === "FAIL" ? <CheckSummary check={check} /> : <Plain icon={CircleAlert} text={issue.label} />
                ) : issue.type === "FIELD_NEEDS_REVIEW" && field ? (
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <StateBadge state="low">{field.value === null ? "Missing" : "Low confidence"}</StateBadge>
                    <span className="font-medium">
                      {SHORT[field.docType]} · {field.lineNo ? `Line ${field.lineNo} · ` : ""}
                      {field.label}
                    </span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{field.value === null ? "not found" : field.display}</span>
                  </span>
                ) : (
                  <Plain icon={issue.type === "IMPORTER_QUERY_OPEN" ? MessageSquareMore : FileWarning} text={issue.label} />
                )}
              </button>
              {check && !exported && check.resolution !== "QUERY_RAISED" && (
                <div className="flex flex-wrap gap-2 px-3 pb-3">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "resolve", checkId: check.id })}>
                    {check.status === "FAIL" ? "Accept discrepancy" : "Acknowledge not on document"}
                  </Button>
                  <ReasonButton size="sm" variant="outline" reason={queryReason} onClick={() => setDialog({ kind: "query", checkId: check.id })}>
                    Query importer
                  </ReasonButton>
                </div>
              )}
              {issue.type === "FIELD_NEEDS_REVIEW" && field && !exported && (
                <div className="flex flex-wrap gap-2 px-3 pb-3">
                  {field.value !== null && (
                    <Button size="sm" disabled={actions.pending} onClick={() => void actions.confirm(field)}>
                      <Check aria-hidden /> Confirm
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => edit(field.id)}>
                    <PencilLine aria-hidden /> {field.value === null ? "Enter value" : "Correct"}
                  </Button>
                </div>
              )}
              {issue.type === "WRONG_DOCUMENT_TYPE" && issue.documentId && !exported && (
                <div className="px-3 pb-3">
                  <KeepTypeButton documentId={issue.documentId} docType={model.shipment.documents.find((d) => d.id === issue.documentId)?.docType ?? "INVOICE"} version={model.shipment.version} />
                </div>
              )}
              {issue.type === "IMPORTER_QUERY_OPEN" && (
                <div className="px-3 pb-3">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "resume" })}>
                    Importer replied · Resume
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <CheckList model={model} onSelect={(checkId) => select({ checkId })} readOnly={exported} />

      {resolving && <ResolveCheckDialog check={resolving} model={model} open onOpenChange={close} />}
      {dialog?.kind === "query" && <QueryImporterDialog model={model} initialCheckId={dialog.checkId} open onOpenChange={close} />}
      {dialog?.kind === "resume" && <ResumeDialog model={model} open onOpenChange={close} />}
    </section>
  );
}

function Plain({ icon: Icon, text }: { icon: typeof FileWarning; text: string }) {
  return (
    <span className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {text}
    </span>
  );
}

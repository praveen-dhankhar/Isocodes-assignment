"use client";

import { CircleAlert, FileWarning, MessageSquareMore } from "lucide-react";
import { StateBadge } from "@/components/ui/state-badge";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/cn";
import type { CheckDTO, IssueDTO, ReviewModel } from "@/server/queries/review-model";
import { SHORT } from "./labels";
import type { Focus } from "./workstation";

type Select = (f: { fieldId: string } | { checkId: string }) => void;

// Crimson first (documents disagree), then amber (low confidence), then everything else.
const RANK: Record<IssueDTO["type"], number> = {
  CHECK_FAILED: 0, FIELD_NEEDS_REVIEW: 1, DOCUMENT_MISSING: 2, DOCUMENT_NOT_READY: 2, WRONG_DOCUMENT_TYPE: 2, CHECK_INCOMPLETE: 3, IMPORTER_QUERY_OPEN: 4,
};
const DELTA_UNIT: Partial<Record<CheckDTO["ruleId"], string>> = { "CC-03": "kg", "CC-04": "kg" };

export const sortIssues = (issues: IssueDTO[]) => [...issues].sort((a, b) => RANK[a.type] - RANK[b.type]);

/** S4 issues panel (PRD F3.1): every blocking item, most serious first; selecting one shows its source. */
export function IssuesPanel({ model, focus, select }: { model: ReviewModel; focus: Focus; select: Select }) {
  const issues = sortIssues(model.issues);
  const checks = new Map(model.checks.map((c) => [c.id, c]));
  const fields = new Map(model.fields.map((f) => [f.id, f]));
  const selected = (i: IssueDTO) => (focus?.kind === "check" ? focus.checkId === i.checkId : focus?.kind === "field" && focus.fieldId === i.fieldId);

  return (
    <section aria-labelledby="issues-heading" className="flex flex-col gap-3 p-4">
      <h2 id="issues-heading" className="text-sm font-semibold">
        {issues.length === 0 ? "No open issues" : <>Open issues <span className="font-normal tabular-nums text-muted-foreground">{issues.length}</span></>}
      </h2>
      {issues.length === 0 && (
        <p className="text-sm text-muted-foreground text-pretty">Every value is confident or confirmed and every check passes or is resolved. The shipment can go for approval.</p>
      )}
      <ul className="flex flex-col gap-2">
        {issues.map((issue, n) => {
          const check = issue.checkId ? checks.get(issue.checkId) : undefined;
          const field = issue.fieldId ? fields.get(issue.fieldId) : undefined;
          const target = issue.fieldId ? { fieldId: issue.fieldId } : issue.checkId ? { checkId: issue.checkId } : null;
          return (
            <li key={`${issue.type}-${issue.fieldId ?? issue.checkId ?? issue.documentId ?? n}`}>
              <button
                type="button"
                disabled={!target}
                aria-pressed={selected(issue)}
                onClick={() => target && select(target)}
                className={cn(
                  "flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted/60",
                  selected(issue) && "border-foreground/40 bg-muted/60",
                )}
              >
                {issue.type === "CHECK_FAILED" && check ? (
                  <CheckCard check={check} />
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
                  <span className="flex items-start gap-2 text-sm">
                    {issue.type === "IMPORTER_QUERY_OPEN" ? <MessageSquareMore aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : issue.type === "CHECK_INCOMPLETE" ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <FileWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    {issue.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CheckCard({ check }: { check: CheckDTO }) {
  const unit = DELTA_UNIT[check.ruleId];
  return (
    <>
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <StateBadge state="mismatch" />
        <span className="font-medium">
          {check.ruleId} {check.ruleName}
          {check.scope !== "shipment" && <span className="font-normal text-muted-foreground"> · {check.scope.replace("line:", "line ").replace("pl-line:", "PL line ")}</span>}
        </span>
        {check.delta && (
          <span className="ml-auto text-sm font-medium">
            Δ <Num value={check.delta} />
            {unit && ` ${unit}`}
          </span>
        )}
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {check.observed.map((o, i) => (
          <div key={i} className="contents">
            <dt className="text-muted-foreground">{SHORT[o.docType]}</dt>
            <dd className={cn("tabular-nums", o.value === null && "text-muted-foreground")}>{o.display}</dd>
          </div>
        ))}
      </dl>
      <span className="text-xs text-muted-foreground text-pretty">{check.message}</span>
    </>
  );
}

"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { StateBadge } from "@/components/ui/state-badge";
import { ModeBadge } from "@/components/review/field-panel";
import { SHORT } from "@/components/review/labels";
import { formatDateTime } from "@/components/shipments/format";
import { RULE_FIELD } from "@/domain/export/precedence";
import { formatFieldValue } from "@/lib/format";
import type { ApprovalEdit, ApprovalSummary as Summary } from "@/server/queries/approval";
import type { ReviewModel } from "@/server/queries/review-model";
import { ApprovalActions } from "./approval-actions";

/** S5 (PRD F4): what people changed and decided, read before approving. */
export function ApprovalSummary({ model, summary }: { model: ReviewModel; summary: Summary }) {
  const accepted = model.checks.filter((c) => c.resolution === "DISCREPANCY_ACCEPTED");
  const [ticked, setTicked] = useState<string[]>(accepted.filter((c) => c.acknowledgedBy).map((c) => c.id));
  const { shipment, viewer } = model;
  const canTick = viewer.role === "DOCUMENTATION_MANAGER" && shipment.status === "READY_FOR_APPROVAL";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6">
      <section aria-label="Status" className="flex flex-col gap-2 text-sm">
        <p>
          {summary.submitted ? <>Submitted by <strong>{summary.submitted.by}</strong>{summary.submitted.at && <> on <time className="tabular-nums">{formatDateTime(summary.submitted.at)}</time></>}.</> : "Not submitted yet."}{" "}
          {summary.approved && <>Approved by <strong>{summary.approved.by}</strong>{summary.approved.at && <> on <time className="tabular-nums">{formatDateTime(summary.approved.at)}</time></>}.</>}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          {shipment.unresolvedIssuesCount === 0 ? <StateBadge state="ok">No unresolved issues</StateBadge> : <span className="font-medium">{shipment.unresolvedIssuesCount} unresolved issue(s)</span>}
          <span className="text-muted-foreground">·</span>
          {shipment.documents.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1.5">
              {SHORT[d.docType]} <ModeBadge document={d} />
            </span>
          ))}
          <span className="text-muted-foreground">· {summary.confirmations} value(s) confirmed as read</span>
        </p>
      </section>

      <Changes title="Corrected (the AI misread)" empty="No values were corrected." rows={summary.corrections} from="AI read" />
      <Changes title="Entered by hand" empty="Nothing was entered by hand." rows={summary.manualEntries} from="AI read" />

      <section aria-labelledby="accepted-heading" className="flex flex-col gap-3">
        <h2 id="accepted-heading" className="font-medium">
          Accepted discrepancies
        </h2>
        {accepted.length === 0 && <p className="text-sm text-muted-foreground">None. Every check passes or was resolved another way.</p>}
        {accepted.map((c) => (
          <label key={c.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox className="mt-0.5" checked={ticked.includes(c.id)} disabled={!canTick} onCheckedChange={(on) => setTicked((t) => (on ? [...t, c.id] : t.filter((x) => x !== c.id)))} aria-label={`Acknowledge ${c.ruleId} ${c.ruleName}`} />
            <span className="flex flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <StateBadge state="mismatch" />
                <span className="font-medium">
                  {c.ruleId} {c.ruleName}
                </span>
                <span className="ml-auto">
                  Filing <span className="font-medium tabular-nums">{c.declaredValue ? formatFieldValue(RULE_FIELD[c.ruleId].kind, c.declaredValue) : "—"}</span>
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">{c.observed.map((o) => `${SHORT[o.docType]} ${o.display}`).join(" · ")}</span>
              <span className="text-pretty">“{c.resolutionNote}” — {c.resolvedBy}</span>
              {c.acknowledgedBy && <span className="text-xs text-muted-foreground">Acknowledged by {c.acknowledgedBy}</span>}
            </span>
          </label>
        ))}
      </section>

      <ApprovalActions
        shipmentId={shipment.id}
        version={shipment.version}
        status={shipment.status}
        isManager={viewer.role === "DOCUMENTATION_MANAGER"}
        selfSubmitted={shipment.submittedBy === viewer.userId}
        unresolved={shipment.unresolvedIssuesCount}
        acknowledged={ticked}
        toAcknowledge={accepted.length}
      />
    </div>
  );
}

function Changes({ title, empty, rows, from }: { title: string; empty: string; rows: ApprovalEdit[]; from: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">Field</th>
              <th className="py-1.5 pr-3 font-medium">{from}</th>
              <th className="py-1.5 pr-3 font-medium">Now</th>
              <th className="py-1.5 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-3">{r.where}</td>
                <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{r.aiValue || "nothing"}</td>
                <td className="py-1.5 pr-3 font-medium tabular-nums">{r.humanValue}</td>
                <td className="py-1.5">{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}


"use client";

import { CircleDashed, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { RULE_FIELD } from "@/domain/export/precedence";
import { cn } from "@/lib/cn";
import { formatFieldValue } from "@/lib/format";
import { clearResolution } from "@/server/actions/review";
import type { CheckDTO, ReviewModel } from "@/server/queries/review-model";
import { SHORT } from "./labels";
import { useReviewAction } from "./use-review-action";

const DELTA_UNIT: Partial<Record<CheckDTO["ruleId"], string>> = { "CC-03": "kg", "CC-04": "kg" };
export const scopeLabel = (scope: string) => (scope === "shipment" ? "" : ` · ${scope.replace("pl-line:", "PL line ").replace("line:", "line ")}`);
const RESOLUTION: Record<NonNullable<CheckDTO["resolution"]>, string> = {
  DISCREPANCY_ACCEPTED: "Discrepancy accepted",
  ACKNOWLEDGED_MISSING: "Acknowledged not on document",
  QUERY_RAISED: "Importer queried",
};

/** A failed check: what each document says, the difference, and the engine's explanation. */
export function CheckSummary({ check }: { check: CheckDTO }) {
  const unit = DELTA_UNIT[check.ruleId];
  return (
    <>
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <StateBadge state="mismatch" />
        <span className="font-medium">
          {check.ruleId} {check.ruleName}
          <span className="font-normal text-muted-foreground">{scopeLabel(check.scope)}</span>
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

/** Every check, with its resolution and an undo (PRD F3; resolutions re-open by themselves when values change). */
export function CheckList({ model, onSelect, readOnly }: { model: ReviewModel; onSelect: (checkId: string) => void; readOnly: boolean }) {
  const { run, pending } = useReviewAction();
  return (
    <section aria-labelledby="checks-heading" className="flex flex-col gap-2">
      <h2 id="checks-heading" className="text-sm font-semibold">
        All checks
      </h2>
      {model.checks.length === 0 && <p className="text-sm text-muted-foreground">Checks run once documents have been read.</p>}
      <ul className="divide-y rounded-lg border">
        {model.checks.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
            {c.status === "PASS" ? (
              <StateBadge state="ok">Pass</StateBadge>
            ) : c.status === "FAIL" ? (
              <StateBadge state="mismatch" />
            ) : c.status === "INCOMPLETE" ? (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-border ring-inset">
                <CircleDashed aria-hidden className="size-3.5" /> Incomplete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border ring-inset">
                <MinusCircle aria-hidden className="size-3.5" /> Not applicable
              </span>
            )}
            <button type="button" className="rounded-sm text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => onSelect(c.id)}>
              {c.ruleId} {c.ruleName}
              <span className="text-muted-foreground">{scopeLabel(c.scope)}</span>
            </button>
            {c.resolution && (
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span title={c.resolutionNote ?? undefined}>
                  {RESOLUTION[c.resolution]}
                  {c.declaredValue && <> · filing <span className="tabular-nums text-foreground">{formatFieldValue(RULE_FIELD[c.ruleId].kind, c.declaredValue)}</span></>}
                  {c.resolvedBy && ` · ${c.resolvedBy}`}
                </span>
                {c.resolution !== "QUERY_RAISED" && !readOnly && (
                  <Button variant="ghost" size="xs" disabled={pending} onClick={() => void run(clearResolution, { checkId: c.id, expectedVersion: model.shipment.version })}>
                    Undo
                  </Button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

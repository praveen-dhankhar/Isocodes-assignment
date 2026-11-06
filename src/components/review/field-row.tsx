"use client";

import { useEffect, useRef } from "react";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { FieldDTO } from "@/server/queries/review-model";
import { confidenceWhy, SHORT } from "./labels";

const NUMERIC = new Set(["MONEY", "DECIMAL", "INTEGER", "WEIGHT"]);
const CODE = new Set(["IDENTIFIER", "HS_CODE", "CONTAINER_LIST", "CURRENCY", "INCOTERM", "UNIT"]);
const HUMAN: Record<Exclude<FieldDTO["status"], "UNREVIEWED">, string> = { CONFIRMED: "Confirmed", CORRECTED: "Corrected", MANUAL: "Entered" };

export function FieldValue({ field }: { field: FieldDTO }) {
  if (field.value === null) return <span className="text-muted-foreground">Not found</span>;
  if (NUMERIC.has(field.kind)) return <Num value={field.value} />;
  if (CODE.has(field.kind)) return <Mono>{field.display}</Mono>;
  return <span className="break-words">{field.display}</span>;
}

/** One value: label, value, confidence with its reason, and a chip that shows where it was read. */
export function FieldRow({ field, selected, onSelect }: { field: FieldDTO; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const why = confidenceWhy(field.signals, field.confidence);
  const score = field.confidence === null ? "—" : field.confidence.toFixed(2);

  return (
    <div ref={ref} data-field-id={field.id} className={cn("grid grid-cols-[minmax(7rem,2fr)_minmax(0,3fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm", selected && "bg-muted")}>
      <span className="text-muted-foreground">{field.label}</span>
      <span className="min-w-0">
        <FieldValue field={field} />
        {field.rawText && field.status === "UNREVIEWED" && field.value !== null && field.rawText.trim() !== field.display && (
          <span className="block truncate text-xs text-muted-foreground" title={field.rawText}>
            printed “{field.rawText}”
          </span>
        )}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {field.status !== "UNREVIEWED" ? (
                <StateBadge state="ok">{HUMAN[field.status]}</StateBadge>
              ) : field.needsReview ? (
                <StateBadge state="low">
                  <span className="tabular-nums">{score}</span>
                </StateBadge>
              ) : (
                <span className="inline-flex rounded-md px-2 py-0.5 text-xs tabular-nums text-muted-foreground ring-1 ring-border ring-inset">{score}</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{field.status === "UNREVIEWED" ? why : `${HUMAN[field.status]} by a person · AI read ${field.originalAiValue ?? "nothing"}`}</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={onSelect}
          disabled={field.pageNo === null}
          aria-label={field.pageNo === null ? `${field.label}: no source on the document` : `Show ${field.label} on ${SHORT[field.docType]} page ${field.pageNo}`}
          className="rounded-md px-1.5 py-0.5 font-mono text-xs text-muted-foreground ring-1 ring-border ring-inset outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          {SHORT[field.docType]} · p{field.pageNo ?? "–"}
        </button>
      </span>
    </div>
  );
}

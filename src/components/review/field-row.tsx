"use client";

import { Check, PencilLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/mono";
import { Num } from "@/components/ui/num";
import { StateBadge } from "@/components/ui/state-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { FieldDTO } from "@/server/queries/review-model";
import type { FieldActions } from "./field-actions";
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

interface Props {
  field: FieldDTO;
  selected: boolean;
  onSelect: () => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  actions: FieldActions;
  editable: boolean;
}

/** One value: label, value, confidence with its reason, a chip that shows where it was read, and its actions. */
export function FieldRow({ field, selected, onSelect, editing, onEdit, actions, editable }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected || editing) return;
    // Keyboard focus follows the selection, so Enter/E after J act on this row rather than on a stray button.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, editing]);
  const why = confidenceWhy(field.signals, field.confidence);
  const score = field.confidence === null ? "—" : field.confidence.toFixed(2);

  return (
    <div ref={ref} tabIndex={-1} aria-label={`${field.label}: ${field.value === null ? "not found" : field.display}`} data-field-id={field.id} className={cn("outline-none grid grid-cols-[minmax(7rem,2fr)_minmax(0,3fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm", field.needsReview && "bg-state-low-bg/60", selected && "bg-muted")}>
      <button type="button" onClick={onSelect} className="rounded-sm text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {field.label}
        {field.lineNo !== null && <span className="sr-only"> (line {field.lineNo}, {SHORT[field.docType]})</span>}
      </button>
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
      {editable && editing ? (
        <FieldEditor field={field} actions={actions} onDone={() => onEdit(false)} />
      ) : (
        editable &&
        (selected || field.needsReview) && ( // uncertain values keep their actions one click away
          <div className="col-span-3 flex flex-wrap items-center gap-2 pt-1">
            {field.value !== null && field.status === "UNREVIEWED" && (
              <Button size="xs" disabled={actions.pending} onClick={() => void actions.confirm(field)} aria-keyshortcuts="Enter">
                <Check aria-hidden /> Confirm
              </Button>
            )}
            <Button size="xs" variant="outline" onClick={() => onEdit(true)} aria-keyshortcuts="E">
              <PencilLine aria-hidden /> {field.value === null ? "Enter value" : "Correct"}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

/** Correct (the AI misread) or Enter (nothing usable was read). A real disagreement between documents is not fixed here. */
function FieldEditor({ field, actions, onDone }: { field: FieldDTO; actions: FieldActions; onDone: () => void }) {
  const [value, setValue] = useState(field.value === null ? "" : field.display);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="col-span-3 flex flex-col gap-1.5 pt-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return setError("Type the value as the document shows it");
        const message = await actions.save(field, value.trim());
        if (message) setError(message);
        else onDone();
      }}
    >
      <div className="flex gap-2">
        <Input
          autoFocus
          aria-label={`${field.label}, as printed on the document`}
          aria-invalid={error !== null}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onDone()}
          className="h-7 tabular-nums"
          maxLength={500}
        />
        <Button size="sm" type="submit" disabled={actions.pending}>
          Save
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Correct means the AI misread the document. If the document itself is wrong, use Accept discrepancy or Query importer.</p>
      )}
    </form>
  );
}

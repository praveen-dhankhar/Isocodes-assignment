"use client";

import { CircleX, FileText, Upload, X } from "lucide-react";
import { useId, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ACCEPT, precheck } from "./upload";

export type SlotState =
  | { phase: "empty"; error?: string }
  | { phase: "ready"; file: File }
  | { phase: "uploading"; file: File; progress: number }
  | { phase: "uploaded"; file: File }
  | { phase: "failed"; file: File; error: string };

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** One document slot (S3): drop or browse, a client-side precheck, then progress and the server's verdict. */
export function UploadSlot({ label, hint, state, onChange, disabled }: {
  label: string;
  hint: string;
  state: SlotState;
  onChange: (next: SlotState) => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const error = precheck(file);
    onChange(error ? { phase: "empty", error } : { phase: "ready", file });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) pick(e.dataTransfer.files[0]);
  };
  const error = state.phase === "failed" || state.phase === "empty" ? state.error : undefined;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        "flex min-h-40 flex-col gap-3 rounded-lg border p-4 transition-colors duration-150",
        state.phase === "empty" && "border-dashed",
        over && "border-foreground bg-muted",
        error && "border-solid border-foreground/40", // colour is reserved for confidence states; errors use icon + text
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>

      {state.phase === "empty" ? (
        <label htmlFor={inputId} className={cn("flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-md text-center text-sm text-muted-foreground", disabled && "cursor-not-allowed opacity-60")}>
          <Upload aria-hidden className="size-5" />
          <span>
            Drop a file or <span className="font-medium text-foreground underline underline-offset-4">browse</span>
          </span>
          <span className="text-xs">PDF, JPEG or PNG · up to 4 MB · 5 pages</span>
          <input id={inputId} type="file" accept={ACCEPT} aria-label={`Upload ${label.toLowerCase()}`} className="sr-only" disabled={disabled} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={state.file.name}>
              {state.file.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{kb(state.file.size)}</span>
            {(state.phase === "ready" || state.phase === "failed") && (
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${state.file.name}`} disabled={disabled} onClick={() => onChange({ phase: "empty" })}>
                <X aria-hidden />
              </Button>
            )}
          </div>
          {state.phase === "uploading" && (
            <div role="progressbar" aria-label={`Uploading ${label}`} aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground transition-[width] duration-200 ease-out" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
          )}
          {state.phase === "uploaded" && <span className="text-xs text-muted-foreground">Uploaded</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-foreground">
          <CircleX aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

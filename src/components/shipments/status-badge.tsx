import { Archive, CircleDashed, CircleDot, FileCheck2, Loader, PauseCircle, Send, Stamp, type LucideIcon } from "lucide-react";
import type { ShipmentStatus } from "@/domain/snapshot";
import { cn } from "@/lib/cn";

// Workflow states stay neutral: amber, crimson and emerald are reserved for confidence, mismatch and verified.
export const STATUS: Record<ShipmentStatus, { label: string; Icon: LucideIcon }> = {
  DRAFT: { label: "Draft", Icon: CircleDashed },
  EXTRACTING: { label: "Extracting", Icon: Loader },
  NEEDS_REVIEW: { label: "Needs review", Icon: CircleDot },
  EXTRACTED: { label: "Extracted", Icon: FileCheck2 },
  READY_FOR_APPROVAL: { label: "Ready for approval", Icon: Send },
  APPROVED: { label: "Approved", Icon: Stamp },
  EXPORTED: { label: "Exported", Icon: Archive },
  ON_HOLD: { label: "On hold", Icon: PauseCircle },
};

export function ShipmentStatusBadge({ status, className }: { status: ShipmentStatus; className?: string }) {
  const { label, Icon } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground", className)}>
      <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", status === "EXTRACTING" && "animate-spin motion-reduce:animate-none")} />
      {label}
    </span>
  );
}

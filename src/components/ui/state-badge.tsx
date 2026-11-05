import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeState = "low" | "mismatch" | "ok";

// Distinct shapes as well as colours, so state survives colour blindness and greyscale print.
const STATES: Record<BadgeState, { Icon: LucideIcon; label: string; tone: string }> = {
  low: { Icon: TriangleAlert, label: "Low confidence", tone: "bg-state-low-bg text-state-low" },
  mismatch: { Icon: CircleX, label: "Mismatch", tone: "bg-state-mismatch-bg text-state-mismatch" },
  ok: { Icon: CircleCheck, label: "Verified", tone: "bg-state-ok-bg text-state-ok" },
};

/** Colour is never the only signal: always icon + text. `children` replaces the default text. */
export function StateBadge({ state, children, className }: { state: BadgeState; children?: ReactNode; className?: string }) {
  const { Icon, label, tone } = STATES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-current/20 ring-inset",
        tone,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children ?? label}
    </span>
  );
}

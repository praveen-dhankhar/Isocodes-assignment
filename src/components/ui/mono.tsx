import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Codes, references and container numbers: monospaced, tabular digits. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

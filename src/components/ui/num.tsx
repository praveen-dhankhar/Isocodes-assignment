import { cn } from "@/lib/cn";
import { formatDecimal } from "@/lib/format";

export { formatDecimal };

export function Num({ value, className }: { value: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatDecimal(value)}</span>;
}

import { cn } from "@/lib/cn";

const CANONICAL = /^-?\d+(\.\d+)?$/;

/**
 * Canonical decimal string → en-IN grouping (A-15), keeping the string's own scale.
 * Intl formats the string exactly; it never becomes a JS number.
 */
export function formatDecimal(value: string): string {
  if (!CANONICAL.test(value)) return value;
  const scale = value.split(".")[1]?.length ?? 0;
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: scale, maximumFractionDigits: scale }).format(
    value as Intl.StringNumericLiteral,
  );
}

export function Num({ value, className }: { value: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatDecimal(value)}</span>;
}

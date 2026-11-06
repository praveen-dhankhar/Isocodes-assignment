import type { FieldKind } from "@/domain/fields";

// Display formatting shared by server queries and client components (A-15: en-IN grouping). Canonical decimal strings
// are formatted by Intl as strings; they never become JS numbers.

const CANONICAL = /^-?\d+(\.\d+)?$/;

export function formatDecimal(value: string): string {
  if (!CANONICAL.test(value)) return value;
  const scale = value.split(".")[1]?.length ?? 0;
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: scale, maximumFractionDigits: scale }).format(value as Intl.StringNumericLiteral);
}

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A stored field value as people read it: 3,120.000 · 14 Oct 2026 · 9405.42.90 · XZQU4821171, XZQU4821189. */
export function formatFieldValue(kind: FieldKind, value: string | null): string {
  if (value === null) return "";
  switch (kind) {
    case "MONEY":
    case "DECIMAL":
    case "INTEGER":
    case "WEIGHT":
      return formatDecimal(value);
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? DATE.format(new Date(`${value}T00:00:00Z`)) : value;
    case "CONTAINER_LIST":
      return value.split("|").join(", ");
    case "HS_CODE":
      return value.length === 8 ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6)}` : value;
    default:
      return value;
  }
}

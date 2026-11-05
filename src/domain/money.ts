import Decimal from "decimal.js";

/**
 * The only numeric type for money, weights and quantities: values travel as canonical strings and are
 * computed with D, never JS numbers. A private clone so nothing else can change its precision or rounding.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type D = InstanceType<typeof D>;

/**
 * en-IN grouping of a canonical decimal (A-15): last three digits, then pairs ("12,34,567.50").
 * Plain string rules, so check messages never depend on the runtime's locale data. Non-canonical input is returned as is.
 */
export function formatEnIn(value: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!m) return value;
  const [, sign = "", int = "", frac = ""] = m;
  const head = int.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ",");
  return `${sign}${head ? `${head},` : ""}${int.slice(-3)}${frac}`;
}

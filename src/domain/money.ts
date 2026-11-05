import Decimal from "decimal.js";

/**
 * The only numeric type for money, weights and quantities: values travel as canonical strings and are
 * computed with D, never JS numbers. A private clone so nothing else can change its precision or rounding.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type D = InstanceType<typeof D>;

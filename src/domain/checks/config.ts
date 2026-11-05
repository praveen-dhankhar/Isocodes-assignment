import type { CheckConfig } from "./types";

export const CHECK_CONFIG: CheckConfig = {
  moneyTolerance: "0.01", // A-04: in invoice currency
  weightToleranceKg: "0.5", // A-04: absolute
  descriptionMatchMin: 0.5, // A-12: token similarity to pair lines
  hsMatchBonus: 0.2, // A-12: added when HS codes are equal
};

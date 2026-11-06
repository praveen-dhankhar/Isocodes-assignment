import { describe, expect, it } from "vitest";
import { declaredDefault, RULE_FIELD } from "./precedence";

const obs = (pairs: Array<[string, string, string | null]>) => pairs.map(([docType, fieldKey, value]) => ({ docType: docType as "INVOICE", fieldKey, value }));

describe("declaredDefault (A-05 export precedence)", () => {
  it.each<[string, ReturnType<typeof obs>, string | null]>([
    ["CC-03", obs([["INVOICE", "grossWeight", "3120.000"], ["PACKING_LIST", "grossWeight", "3165.000"], ["BILL_OF_LADING", "grossWeight", "3165.000"]]), "3165.000"], // BL > PL > INV
    ["CC-03", obs([["INVOICE", "grossWeight", "3120.000"], ["PACKING_LIST", "grossWeight", "3165.000"], ["BILL_OF_LADING", "grossWeight", null]]), "3165.000"],
    ["CC-04", obs([["INVOICE", "netWeight", "2880.000"], ["PACKING_LIST", "netWeight", "2870.000"], ["BILL_OF_LADING", "netWeight", "2900.000"]]), "2870.000"], // PL > INV > BL
    ["CC-05", obs([["INVOICE", "totalPackages", "240"], ["PACKING_LIST", "totalPackages", "238"]]), "238"],
    ["CC-07", obs([["PACKING_LIST", "containerNumbers", "XZQU4821253"], ["BILL_OF_LADING", "containerNumbers", "XZQU4821254"]]), "XZQU4821254"],
    ["CC-06", obs([["INVOICE", "description", "USB-C"], ["INVOICE", "quantity", "12000"], ["PACKING_LIST", "quantity", "10000"]]), "12000"], // invoice-level
    ["CC-02", obs([["INVOICE", "invoiceTotal", "10620.00"]]), "10620.00"],
    ["CC-08", obs([["INVOICE", "invoiceNumber", "TW-1"], ["PACKING_LIST", "invoiceNumber", "TW-2"]]), "TW-1"],
    ["CC-03", obs([]), null],
  ])("%s → %s", (ruleId, observed, expected) => {
    expect(declaredDefault(ruleId as "CC-03", observed)?.value ?? null).toBe(expected);
  });

  it("says which document the value came from", () => {
    const observed = obs([["PACKING_LIST", "grossWeight", "3165.000"], ["BILL_OF_LADING", "grossWeight", "3165.000"]]);
    expect(declaredDefault("CC-03", observed)).toEqual({ value: "3165.000", docType: "BILL_OF_LADING" });
  });

  it("names the field each rule declares", () => {
    expect(RULE_FIELD["CC-03"]).toEqual({ fieldKey: "grossWeight", kind: "WEIGHT" });
    expect(RULE_FIELD["CC-06"]).toEqual({ fieldKey: "quantity", kind: "DECIMAL" });
  });
});

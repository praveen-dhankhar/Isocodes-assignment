import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./checks/__fixtures__/snapshots";
import { ShipmentSnapshot } from "./snapshot";

describe("ShipmentSnapshot schema", () => {
  it.each(Object.entries(SCENARIOS))("accepts the %s fixture unchanged", (_, build) => {
    const snap = build();
    expect(ShipmentSnapshot.parse(snap)).toEqual(snap);
  });

  it("rejects a field key that is not in the registry", () => {
    const snap = SCENARIOS["SHP-24811"]();
    const invoice = snap.documents.INVOICE;
    const bad = { ...snap, documents: { ...snap.documents, INVOICE: { ...invoice, header: { notAField: invoice?.header.supplierName } } } };
    expect(ShipmentSnapshot.safeParse(bad).success).toBe(false);
  });

  it("rejects a confidence outside 0–1", () => {
    const snap = SCENARIOS["SHP-24811"]();
    const field = snap.documents.INVOICE?.header.invoiceTotal;
    if (!field) throw new Error("fixture lost its invoice total");
    field.confidence = 1.5;
    expect(ShipmentSnapshot.safeParse(snap).success).toBe(false);
  });
});

describe("scenario fixtures (API_SPECS §7.2)", () => {
  it("SHP-24812 reads European numbers into canonical values", () => {
    const inv = SCENARIOS["SHP-24812"]().documents.INVOICE;
    expect(inv?.header.invoiceTotal?.value).toBe("7650.00");
    expect(inv?.header.grossWeight?.value).toBe("1460.000");
    expect(inv?.lines[0]?.cells.unitPrice?.value).toBe("42.50");
  });

  it("SHP-24816 converts packing-list pounds to kilograms", () => {
    expect(SCENARIOS["SHP-24816"]().documents.PACKING_LIST?.header.grossWeight?.value).toBe("999.999");
  });

  it("SHP-24815 carries the bad BL container at low confidence", () => {
    const field = SCENARIOS["SHP-24815"]().documents.BILL_OF_LADING?.header.containerNumbers;
    expect(field?.value).toBe("XZQU4821254");
    expect(field?.confidence).toBeLessThan(0.85);
  });
});

import { HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "../../fields";
import { detectDecimalSeparator, parseDecimal } from "../../normalize/number";
import { parseWeightKg } from "../../normalize/weight";
import type { FieldRef, FieldStatus, ShipmentSnapshot, ShipmentStatus, SnapshotDocument } from "../../snapshot";

// Scenario snapshots for API_SPECS §7.2. Values marked "brief" there come from the client brief; the rest
// are invented (A-13). Like a real extraction, every registry field for the slot is present: what a
// scenario leaves out is null, at confidence 0 when required (PRD §8). Others are UNREVIEWED at 0.97.

type Cell = string | null | { value: string | null; confidence: number; status?: FieldStatus };
type Cells = Record<string, Cell>;

const DETECTED: Record<DocType, string> = {
  INVOICE: "COMMERCIAL_INVOICE",
  PACKING_LIST: "PACKING_LIST",
  BILL_OF_LADING: "BILL_OF_LADING",
};

function refs(prefix: string, docType: DocType, registry: Record<string, FieldDef>, cells: Cells) {
  for (const key of Object.keys(cells)) {
    if (!registry[key]?.on[docType]) throw new Error(`${prefix}: ${key} is not extracted on ${docType}`);
  }
  const out: Record<string, FieldRef> = {};
  for (const [key, def] of Object.entries(registry)) {
    const requirement = def.on[docType];
    if (!requirement) continue;
    const cell = cells[key] ?? null;
    const given = typeof cell === "object" && cell !== null ? cell : { value: cell, confidence: undefined };
    out[key] = {
      fieldId: `${prefix}/${key}`,
      value: given.value,
      status: (typeof cell === "object" && cell?.status) || "UNREVIEWED",
      confidence: given.confidence ?? (given.value === null && requirement === "R" ? 0 : 0.97),
    };
  }
  return out;
}

function doc(ref: string, docType: DocType, header: Cells, lines: Cells[] = []): SnapshotDocument {
  const id = `${ref}/${docType}`;
  return {
    documentId: id,
    status: "EXTRACTED",
    detectedDocType: DETECTED[docType],
    wrongTypeDismissed: false,
    header: refs(id, docType, HEADER_FIELDS, header),
    lines: lines.map((cells, i) => ({ lineNo: i + 1, cells: refs(`${id}/line:${i + 1}`, docType, LINE_FIELDS, cells) })),
  };
}

function shipment(ref: string, status: ShipmentStatus, docs: SnapshotDocument[]): ShipmentSnapshot {
  const documents: ShipmentSnapshot["documents"] = {};
  for (const d of docs) documents[d.documentId.split("/")[1] as DocType] = d;
  return { shipmentId: ref, ref, status, documents, priorResolutions: {} };
}

/** Brief: INV gross 3,120 kg vs PL 3,165 kg → CC-03 FAIL, Δ 45 kg; 2,400 × 6.80 = 16,320.00. */
export function shp24811(): ShipmentSnapshot {
  const ref = "SHP-24811";
  const line = { description: "LED panel light 40W", quantity: "2400", unit: "PCS" };
  return shipment(ref, "NEEDS_REVIEW", [
    doc(ref, "INVOICE", {
      supplierName: "Company B", importerName: "Company P", consigneeName: "Company P",
      invoiceNumber: "CB-2026-1187", invoiceDate: "2026-10-14", currency: "USD", incoterm: "FOB",
      invoiceTotal: "16320.00", totalPackages: "240", grossWeight: "3120.000", netWeight: "2880.000",
      containerNumbers: "XZQU4821171",
    }, [{ ...line, hsCode: "94054290", unitPrice: "6.80", lineTotal: "16320.00" }]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company B", consigneeName: "Company P", invoiceNumber: "CB-2026-1187",
      totalPackages: "240", grossWeight: "3165.000", netWeight: "2880.000", containerNumbers: "XZQU4821171",
    }, [line]),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLNGB2610447", supplierName: "Company B", consigneeName: "Company P",
      portOfLoading: "Ningbo", portOfDischarge: "Nhava Sheva", totalPackages: "240",
      grossWeight: "3165.000", containerNumbers: "XZQU4821171",
    }),
  ]);
}

/** Brief: European number format on the invoice; everything agrees once normalised. */
export function shp24812(): ShipmentSnapshot {
  const ref = "SHP-24812";
  // Read the invoice's printed numbers the way extraction will (PRD §7, A-09).
  const printed = { unitPrice: "42,50", total: "7.650,00", gross: "1.460,00 kg", net: "1.340,00 kg" };
  const sep = detectDecimalSeparator(Object.values(printed));
  const money = (text: string) => parseDecimal(text, sep)?.value ?? null;
  const kg = (text: string) => parseWeightKg(text, sep)?.kg ?? null;
  const line = { description: "Steel ball valve DN50", quantity: "180", unit: "PCS" };
  return shipment(ref, "EXTRACTED", [
    doc(ref, "INVOICE", {
      supplierName: "Company C", importerName: "Company Q", consigneeName: "Company Q",
      invoiceNumber: "CC-2026-0412", invoiceDate: "2026-10-09", currency: "EUR", incoterm: "FCA",
      invoiceTotal: money(printed.total), totalPackages: "6", grossWeight: kg(printed.gross),
      netWeight: kg(printed.net), containerNumbers: "KQZU2073199",
    }, [{ ...line, hsCode: "84818030", unitPrice: money(printed.unitPrice), lineTotal: money(printed.total) }]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company C", consigneeName: "Company Q", invoiceNumber: "CC-2026-0412",
      totalPackages: "6", grossWeight: "1460.000", netWeight: "1340.000", containerNumbers: "KQZU2073199",
    }, [line]),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLGOT2610118", supplierName: "Company C", consigneeName: "Company Q",
      portOfLoading: "Gothenburg", portOfDischarge: "Nhava Sheva", totalPackages: "6",
      grossWeight: "1460.000", netWeight: "1340.000", containerNumbers: "KQZU2073199",
    }),
  ]);
}

/** Two lines, all clean: 40 × 118.00 + 40 × 9.50 = 5,100.00. */
export function shp24813(): ShipmentSnapshot {
  const ref = "SHP-24813";
  const lines = [
    { description: "Hydraulic gear pump 16cc", quantity: "40", unit: "PCS" },
    { description: "Pump seal kit", quantity: "40", unit: "SET" },
  ];
  return shipment(ref, "APPROVED", [
    doc(ref, "INVOICE", {
      supplierName: "Company D", importerName: "Company R", consigneeName: "Company R",
      invoiceNumber: "DE-2026-3307", invoiceDate: "2026-10-02", currency: "EUR", incoterm: "FOB",
      invoiceTotal: "5100.00", totalPackages: "8", grossWeight: "620.000", netWeight: "560.000",
      containerNumbers: "ZXKU7310049",
    }, [
      { ...lines[0], hsCode: "84136010", unitPrice: "118.00", lineTotal: "4720.00" },
      { ...lines[1], hsCode: "84849000", unitPrice: "9.50", lineTotal: "380.00" },
    ]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company D", consigneeName: "Company R", invoiceNumber: "DE-2026-3307",
      totalPackages: "8", grossWeight: "620.000", netWeight: "560.000", containerNumbers: "ZXKU7310049",
    }, lines),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLHAM2610231", supplierName: "Company D", consigneeName: "Company R",
      portOfLoading: "Hamburg", portOfDischarge: "Nhava Sheva", totalPackages: "8",
      grossWeight: "620.000", containerNumbers: "ZXKU7310049",
    }),
  ]);
}

/** Packing list shows 10,000 USB-C receptacles against 12,000 invoiced → CC-06 FAIL on line:2. */
export function shp24814(): ShipmentSnapshot {
  const ref = "SHP-24814";
  const ble = { description: "BLE 5.3 module", quantity: "5000", unit: "PCS" };
  const usbc = { description: "USB-C receptacle 16P", unit: "PCS" };
  return shipment(ref, "NEEDS_REVIEW", [
    doc(ref, "INVOICE", {
      supplierName: "Company E", importerName: "Company P", consigneeName: "Company P",
      invoiceNumber: "TW-2026-0881", invoiceDate: "2026-10-11", currency: "USD", incoterm: "FOB",
      invoiceTotal: "10620.00", totalPackages: "35", grossWeight: "512.000", netWeight: "468.000",
      containerNumbers: "QZXU5609317",
    }, [
      { ...ble, hsCode: "85176290", unitPrice: "1.92", lineTotal: "9600.00" },
      { ...usbc, quantity: "12000", hsCode: "85369090", unitPrice: "0.085", lineTotal: "1020.00" },
    ]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company E", consigneeName: "Company P", invoiceNumber: "TW-2026-0881",
      totalPackages: "35", grossWeight: "512.000", netWeight: "468.000", containerNumbers: "QZXU5609317",
    }, [ble, { ...usbc, quantity: "10000" }]),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLKHH2610552", supplierName: "Company E", consigneeName: "Company P",
      portOfLoading: "Kaohsiung", portOfDischarge: "Nhava Sheva", totalPackages: "35",
      grossWeight: "512.000", containerNumbers: "QZXU5609317",
    }),
  ]);
}

/** BL is a phone scan: container XZQU4821254 (bad check digit, low confidence) vs PL XZQU4821253 → CC-07 FAIL. */
export function shp24815(): ShipmentSnapshot {
  const ref = "SHP-24815";
  const line = { description: "Rubber timing belt", quantity: "3000", unit: "PCS" };
  return shipment(ref, "NEEDS_REVIEW", [
    doc(ref, "INVOICE", {
      supplierName: "Company F", importerName: "Company Q", consigneeName: "Company Q",
      invoiceNumber: "TH-2026-1290", invoiceDate: "2026-10-07", currency: "USD", incoterm: "FOB",
      invoiceTotal: "7200.00", totalPackages: "60", grossWeight: "1830.000", netWeight: "1710.000",
    }, [{ ...line, hsCode: "40103900", unitPrice: "2.40", lineTotal: "7200.00" }]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company F", consigneeName: "Company Q", invoiceNumber: "TH-2026-1290",
      totalPackages: "60", grossWeight: "1830.000", netWeight: "1710.000", containerNumbers: "XZQU4821253",
    }, [line]),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLLCH2610090", supplierName: "Company F", consigneeName: "Company Q",
      portOfLoading: "Laem Chabang", portOfDischarge: "Nhava Sheva", totalPackages: "60",
      grossWeight: "1830.000", containerNumbers: { value: "XZQU4821254", confidence: 0.62 },
    }),
  ]);
}

/** US supplier: packing list in pounds (2,204.62 LBS) vs BL 1,000 KGS → passes after conversion; MM/DD date. */
export function shp24816(): ShipmentSnapshot {
  const ref = "SHP-24816";
  const lbs = (text: string) => parseWeightKg(text, ".")?.kg ?? null;
  const line = { description: "Stainless fastener assortment", quantity: "600", unit: "KITS" };
  return shipment(ref, "EXPORTED", [
    doc(ref, "INVOICE", {
      supplierName: "Company G", importerName: "Company R", consigneeName: "Company R",
      invoiceNumber: "US-2026-4471", currency: "USD", incoterm: "FCA", invoiceTotal: "8550.00", totalPackages: "50",
      // Printed 10/03/2026: ambiguous (A-10), read MM/DD for a US supplier, then confirmed by a person.
      invoiceDate: { value: "2026-10-03", confidence: 0.6, status: "CONFIRMED" },
    }, [{ ...line, hsCode: "73181500", unitPrice: "14.25", lineTotal: "8550.00" }]),
    doc(ref, "PACKING_LIST", {
      supplierName: "Company G", consigneeName: "Company R", invoiceNumber: "US-2026-4471", totalPackages: "50",
      grossWeight: lbs("2,204.62 LBS"), netWeight: lbs("1,984.16 LBS"), containerNumbers: "KQZU2074003",
    }, [line]),
    doc(ref, "BILL_OF_LADING", {
      blNumber: "BLHOU2610377", supplierName: "Company G", consigneeName: "Company R",
      portOfLoading: "Houston", portOfDischarge: "Nhava Sheva", totalPackages: "50",
      grossWeight: "1000.000", containerNumbers: "KQZU2074003",
    }),
  ]);
}

export const SCENARIOS = {
  "SHP-24811": shp24811,
  "SHP-24812": shp24812,
  "SHP-24813": shp24813,
  "SHP-24814": shp24814,
  "SHP-24815": shp24815,
  "SHP-24816": shp24816,
} as const;

import { z } from "zod";

export const DocType = z.enum(["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]);
export type DocType = z.infer<typeof DocType>;

export const DOC_LABEL: Record<DocType, string> = {
  INVOICE: "Invoice",
  PACKING_LIST: "Packing list",
  BILL_OF_LADING: "Bill of lading",
};

export type FieldKind =
  | "TEXT" | "IDENTIFIER" | "DATE" | "CURRENCY" | "INCOTERM" | "MONEY" | "DECIMAL"
  | "INTEGER" | "WEIGHT" | "CONTAINER_LIST" | "HS_CODE" | "UNIT";

/** R = required, O = optional. A document type that is absent does not carry the field. */
export type Requirement = "R" | "O";

export interface FieldDef {
  label: string;
  kind: FieldKind;
  on: Partial<Record<DocType, Requirement>>;
}

// PRD §6.1, row for row (fields.test.ts compares against the PRD table).
export const HEADER_FIELDS = {
  supplierName: { label: "Supplier / Shipper", kind: "TEXT", on: { INVOICE: "R", PACKING_LIST: "O", BILL_OF_LADING: "R" } },
  importerName: { label: "Buyer / Importer", kind: "TEXT", on: { INVOICE: "R" } },
  consigneeName: { label: "Consignee", kind: "TEXT", on: { INVOICE: "O", PACKING_LIST: "O", BILL_OF_LADING: "R" } },
  invoiceNumber: { label: "Invoice no.", kind: "IDENTIFIER", on: { INVOICE: "R", PACKING_LIST: "O" } }, // PL: reference (CC-08)
  invoiceDate: { label: "Invoice date", kind: "DATE", on: { INVOICE: "R" } },
  currency: { label: "Currency", kind: "CURRENCY", on: { INVOICE: "R" } },
  incoterm: { label: "Incoterm", kind: "INCOTERM", on: { INVOICE: "R" } },
  invoiceTotal: { label: "Invoice total", kind: "MONEY", on: { INVOICE: "R" } },
  totalPackages: { label: "Total packages", kind: "INTEGER", on: { INVOICE: "O", PACKING_LIST: "R", BILL_OF_LADING: "R" } },
  grossWeight: { label: "Gross weight (kg)", kind: "WEIGHT", on: { INVOICE: "O", PACKING_LIST: "R", BILL_OF_LADING: "R" } },
  netWeight: { label: "Net weight (kg)", kind: "WEIGHT", on: { INVOICE: "O", PACKING_LIST: "R", BILL_OF_LADING: "O" } },
  containerNumbers: { label: "Container no(s).", kind: "CONTAINER_LIST", on: { INVOICE: "O", PACKING_LIST: "O", BILL_OF_LADING: "R" } },
  blNumber: { label: "B/L no.", kind: "IDENTIFIER", on: { BILL_OF_LADING: "R" } },
  portOfLoading: { label: "Port of loading", kind: "TEXT", on: { BILL_OF_LADING: "O" } }, // display only
  portOfDischarge: { label: "Port of discharge", kind: "TEXT", on: { BILL_OF_LADING: "O" } }, // display only
} as const satisfies Record<string, FieldDef>;

// PRD §6.2. Line items exist on the invoice and packing list only.
export const LINE_FIELDS = {
  description: { label: "Description", kind: "TEXT", on: { INVOICE: "R", PACKING_LIST: "R" } },
  hsCode: { label: "HSN / HS code", kind: "HS_CODE", on: { INVOICE: "O" } }, // A-11
  quantity: { label: "Quantity", kind: "DECIMAL", on: { INVOICE: "R", PACKING_LIST: "R" } },
  unit: { label: "Unit", kind: "UNIT", on: { INVOICE: "O", PACKING_LIST: "O" } },
  unitPrice: { label: "Unit price", kind: "MONEY", on: { INVOICE: "R" } },
  lineTotal: { label: "Line total", kind: "MONEY", on: { INVOICE: "R" } },
} as const satisfies Record<string, FieldDef>;

export type HeaderFieldKey = keyof typeof HEADER_FIELDS;
export type LineFieldKey = keyof typeof LINE_FIELDS;
export type FieldKey = HeaderFieldKey | LineFieldKey;

// Object.keys loses the literal types; the registries above are the only source of these keys.
export const HeaderFieldKey = z.enum(Object.keys(HEADER_FIELDS) as HeaderFieldKey[]);
export const LineFieldKey = z.enum(Object.keys(LINE_FIELDS) as LineFieldKey[]);

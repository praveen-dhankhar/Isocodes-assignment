import type { CheckOutcome, RuleId } from "../checks/types";
import type { DocType, HeaderFieldKey } from "../fields";
import { D } from "../money";
import type { ShipmentSnapshot, SnapshotLine } from "../snapshot";
import { PRECEDENCE, RULE_FIELD } from "./precedence";

// API_SPECS §6: layout CF-1 (invented, A-06). One row per invoice line, header values repeated. Pure: the export
// service rebuilds the snapshot inside its transaction and calls these.

export const LAYOUT_VERSION = "CF-1";

export const HEADER = [
  "SHIPMENT_REF", "IMPORTER_NAME", "IMPORTER_IEC", "SUPPLIER_NAME", "SUPPLIER_COUNTRY", "INVOICE_NO", "INVOICE_DATE", "CURRENCY",
  "INCOTERM", "INVOICE_VALUE", "BL_NO", "CONTAINER_NOS", "TOTAL_PACKAGES", "GROSS_WT_KG", "NET_WT_KG", "ITEM_SR_NO",
  "ITEM_DESCRIPTION", "HSN_CODE", "QUANTITY", "UQC", "UNIT_PRICE", "ITEM_VALUE",
] as const;
type Column = (typeof HEADER)[number];

/** Free-text columns get the formula-injection guard (§6.1); numbers, dates and codes are produced by code. */
const TEXT_COLUMNS = new Set<Column>(["SHIPMENT_REF", "IMPORTER_NAME", "IMPORTER_IEC", "SUPPLIER_NAME", "INVOICE_NO", "BL_NO", "CONTAINER_NOS", "ITEM_DESCRIPTION", "UQC"]);

/** ISO 4217 currencies without minor units; everything else is exported with 2 decimals (§6.2). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"]);

export interface ExportMasters {
  importer: { name: string; iec: string };
  supplier: { name: string; countryCode: string };
}

const fixed = (value: string | null, dp: number) => (value === null ? "" : new D(value).toFixed(dp));
const ddmmyyyy = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso ?? ""));
const guard = (cell: string) => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);

/**
 * The CF-1 table, header row first. Values follow export precedence (A-05) unless an accepted discrepancy declared one;
 * `outcomes` carry only resolutions whose fingerprint still matches, so a stale declaration is never exported.
 */
export function buildExportRows(snapshot: ShipmentSnapshot, masters: ExportMasters, outcomes: readonly CheckOutcome[]): string[][] {
  const declared = (ruleId: RuleId, scope = "shipment") => {
    const r = outcomes.find((o) => o.ruleId === ruleId && o.scope === scope)?.resolution;
    return r?.type === "DISCREPANCY_ACCEPTED" ? (r.declaredValue ?? null) : null;
  };
  const inv = snapshot.documents.INVOICE;
  const header = (key: HeaderFieldKey) => inv?.header[key]?.value ?? null;
  const preferred = (key: HeaderFieldKey) => {
    for (const docType of PRECEDENCE[key] ?? (["INVOICE"] as DocType[])) {
      const value = snapshot.documents[docType]?.header[key]?.value;
      if (value) return value;
    }
    return null;
  };
  const byRule = (key: HeaderFieldKey) => {
    const rule = (Object.keys(RULE_FIELD) as RuleId[]).find((r) => RULE_FIELD[r].fieldKey === key);
    return (rule && declared(rule)) ?? preferred(key);
  };
  const currency = header("currency");
  const money = (value: string | null) => fixed(value, currency && ZERO_DECIMAL.has(currency) ? 0 : 2);

  const shipmentCells: Partial<Record<Column, string>> = {
    SHIPMENT_REF: snapshot.ref,
    IMPORTER_NAME: masters.importer.name,
    IMPORTER_IEC: masters.importer.iec,
    SUPPLIER_NAME: masters.supplier.name,
    SUPPLIER_COUNTRY: masters.supplier.countryCode,
    INVOICE_NO: declared("CC-08") ?? header("invoiceNumber") ?? "",
    INVOICE_DATE: ddmmyyyy(header("invoiceDate")),
    CURRENCY: currency ?? "",
    INCOTERM: header("incoterm") ?? "",
    INVOICE_VALUE: money(declared("CC-02") ?? header("invoiceTotal")),
    BL_NO: snapshot.documents.BILL_OF_LADING?.header.blNumber?.value ?? "",
    CONTAINER_NOS: byRule("containerNumbers") ?? "",
    TOTAL_PACKAGES: byRule("totalPackages") ?? "",
    GROSS_WT_KG: fixed(byRule("grossWeight"), 3),
    NET_WT_KG: fixed(byRule("netWeight"), 3),
  };
  const lineCells = (line: SnapshotLine): Partial<Record<Column, string>> => {
    const cell = (key: keyof SnapshotLine["cells"]) => line.cells[key]?.value ?? null;
    return {
      ITEM_SR_NO: String(line.lineNo),
      ITEM_DESCRIPTION: cell("description") ?? "",
      HSN_CODE: (cell("hsCode") ?? "").replace(/\D/g, ""),
      QUANTITY: declared("CC-06", `line:${line.lineNo}`) ?? cell("quantity") ?? "",
      UQC: cell("unit") ?? "", // already mapped to UQC where known (A-21)
      UNIT_PRICE: cell("unitPrice") ?? "",
      ITEM_VALUE: money(declared("CC-01", `line:${line.lineNo}`) ?? cell("lineTotal")),
    };
  };

  const rows = [...(inv?.lines ?? [])].sort((a, b) => a.lineNo - b.lineNo).map((line) => {
    const cells = { ...shipmentCells, ...lineCells(line) };
    return HEADER.map((column) => (TEXT_COLUMNS.has(column) ? guard(cells[column] ?? "") : (cells[column] ?? "")));
  });
  return [[...HEADER], ...rows];
}

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/** RFC 4180 with a UTF-8 BOM and CRLF after every record (§6.1). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}

/** §6.4: {REF}_{INVOICE_NO}_CF1_{yyyyMMdd-HHmm IST}.csv; anything outside [A-Za-z0-9._-] becomes "_". */
export function exportFileName(ref: string, invoiceNo: string | null, at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000); // Asia/Kolkata, UTC+05:30, no DST (A-15)
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${ist.getUTCFullYear()}${two(ist.getUTCMonth() + 1)}${two(ist.getUTCDate())}-${two(ist.getUTCHours())}${two(ist.getUTCMinutes())}`;
  return `${ref}_${invoiceNo ?? "NO-INVOICE"}_CF1_${stamp}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
}

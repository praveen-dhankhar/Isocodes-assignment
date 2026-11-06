import type { HeaderFieldKey, LineFieldKey } from "@/domain/fields";
import type { SampleDocument, SampleShipment } from "./sample-data";

// HTML for the sample documents (API_SPECS §7.1). One `.sheet` per page, sized A4. Every printed field value carries
// data-field (and data-line in tables) so generate-samples can read its box from the rendered layout.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = (fontDataUri: string) => `
@font-face { font-family: "Noto Sans SC"; src: url(${fontDataUri}) format("woff2"); }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Helvetica, Arial, "Noto Sans SC", sans-serif; font-size: 10.5pt; color: #111; }
.sheet { width: 210mm; height: 297mm; padding: 16mm 15mm; position: relative; overflow: hidden; page-break-after: always; background: #fff; }
.sheet:last-child { page-break-after: auto; }
.letterhead { border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
.letterhead .name { font-size: 17pt; font-weight: 700; }
.muted { color: #444; font-size: 9pt; }
h1 { font-size: 14pt; letter-spacing: 0.06em; margin: 10px 0 12px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 12px; }
.label { font-size: 8.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.03em; }
.box { border: 1px solid #999; padding: 6px 8px; min-height: 52px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #eee; font-size: 8.5pt; text-transform: uppercase; }
td.num { text-align: right; }
.totals { width: 60%; margin-left: auto; }
.footer { position: absolute; left: 15mm; right: 15mm; bottom: 14mm; font-size: 8.5pt; color: #333; }
.sign { margin-top: 18px; border-top: 1px solid #555; width: 60mm; padding-top: 3px; }
`;

type Labels = Record<string, string>;
const EN: Labels = {
  invoice: "COMMERCIAL INVOICE", packingList: "PACKING LIST", bl: "BILL OF LADING",
  invoiceNumber: "Invoice No.", invoiceDate: "Date", currency: "Currency", incoterm: "Terms of delivery",
  importerName: "Buyer", consigneeName: "Consignee", containerNumbers: "Container No.", invoiceRef: "Invoice ref.",
  description: "Description of goods", hsCode: "HS code", quantity: "Quantity", unit: "Unit", unitPrice: "Unit price",
  lineTotal: "Amount", invoiceTotal: "Total", totalPackages: "Packages", grossWeight: "Gross weight", netWeight: "Net weight",
};
// SHP-24817: the Chinese side uses only characters in scripts/fonts/noto-sans-sc-subset.chars.txt.
const ZH: Labels = {
  ...EN,
  invoice: "商业发票 COMMERCIAL INVOICE", invoiceNumber: "发票号 Invoice No.", invoiceDate: "日期 Date", currency: "货币 Currency",
  incoterm: "贸易条款 Terms", importerName: "买方 Buyer", consigneeName: "收货人 Consignee", containerNumbers: "集装箱号 Container",
  description: "品名 Description", quantity: "数量 Quantity", unit: "单位 Unit", unitPrice: "单价 Unit price", lineTotal: "金额 Amount",
  invoiceTotal: "合计 Total", totalPackages: "件数 Packages", grossWeight: "毛重 Gross weight", netWeight: "净重 Net weight",
};

function value(doc: SampleDocument, key: HeaderFieldKey, page: number) {
  const onPage2 = doc.page2?.includes(key) ?? false;
  const text = doc.header[key];
  if (text === undefined || onPage2 !== (page === 2)) return "";
  return `<span data-field="${key}">${esc(text)}</span>`;
}

function cell(doc: SampleDocument, lineNo: number, key: LineFieldKey, cls = "") {
  const text = doc.lines[lineNo - 1]?.[key];
  return `<td class="${cls}">${text === undefined ? "" : `<span data-line="${lineNo}" data-field="${key}">${esc(text)}</span>`}</td>`;
}

const addressBlock = (lines: string[]) => lines.map((l) => `<div class="muted">${esc(l)}</div>`).join("");

const row = (label: string, html: string) => (html ? `<div><div class="label">${esc(label)}</div><div>${html}</div></div>` : "");

function invoice(ship: SampleShipment, doc: SampleDocument, L: Labels) {
  const lines = doc.lines
    .map((_, i) => `<tr><td>${i + 1}</td>${cell(doc, i + 1, "description")}${cell(doc, i + 1, "hsCode")}${cell(doc, i + 1, "quantity", "num")}${cell(doc, i + 1, "unit")}${cell(doc, i + 1, "unitPrice", "num")}${cell(doc, i + 1, "lineTotal", "num")}</tr>`)
    .join("");
  return `<section class="sheet">
  <div class="letterhead"><div class="name">${value(doc, "supplierName", 1)}</div>${addressBlock(ship.supplier.address)}</div>
  <h1>${esc(L.invoice ?? "")}</h1>
  <div class="grid">
    ${row(L.invoiceNumber ?? "", value(doc, "invoiceNumber", 1))}${row(L.invoiceDate ?? "", value(doc, "invoiceDate", 1))}
    ${row(L.currency ?? "", value(doc, "currency", 1))}${row(L.incoterm ?? "", value(doc, "incoterm", 1))}
    ${row(L.containerNumbers ?? "", value(doc, "containerNumbers", 1))}
  </div>
  <div class="grid">
    <div class="box"><div class="label">${esc(L.importerName ?? "")}</div>${value(doc, "importerName", 1)}${addressBlock(ship.importer.address)}</div>
    <div class="box"><div class="label">${esc(L.consigneeName ?? "")}</div>${value(doc, "consigneeName", 1)}${addressBlock(ship.importer.address)}</div>
  </div>
  <table><thead><tr><th>#</th><th>${esc(L.description ?? "")}</th><th>${esc(L.hsCode ?? "")}</th><th>${esc(L.quantity ?? "")}</th><th>${esc(L.unit ?? "")}</th><th>${esc(L.unitPrice ?? "")}</th><th>${esc(L.lineTotal ?? "")}</th></tr></thead><tbody>${lines}</tbody></table>
  <table class="totals"><tbody>
    <tr><th>${esc(L.invoiceTotal ?? "")}</th><td class="num">${value(doc, "invoiceTotal", 1)}</td></tr>
    ${doc.header.totalPackages ? `<tr><th>${esc(L.totalPackages ?? "")}</th><td class="num">${value(doc, "totalPackages", 1)}</td></tr>` : ""}
    ${doc.header.grossWeight ? `<tr><th>${esc(L.grossWeight ?? "")}</th><td class="num">${value(doc, "grossWeight", 1)}</td></tr>` : ""}
    ${doc.header.netWeight ? `<tr><th>${esc(L.netWeight ?? "")}</th><td class="num">${value(doc, "netWeight", 1)}</td></tr>` : ""}
  </tbody></table>
  <div class="footer">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
    <div class="sign">Authorised signatory, ${esc(ship.supplier.name)}</div></div>
</section>`;
}

function packingList(ship: SampleShipment, doc: SampleDocument, L: Labels) {
  const lines = doc.lines
    .map((_, i) => `<tr><td>${i + 1}</td>${cell(doc, i + 1, "description")}${cell(doc, i + 1, "quantity", "num")}${cell(doc, i + 1, "unit")}</tr>`)
    .join("");
  const totals = (page: number) => {
    const rows = (["totalPackages", "grossWeight", "netWeight", "containerNumbers"] as const)
      .map((k) => [k, value(doc, k, page)] as const)
      .filter(([, html]) => html)
      .map(([k, html]) => `<tr><th>${esc(L[k] ?? k)}</th><td class="num">${html}</td></tr>`)
      .join("");
    return rows ? `<table class="totals"><tbody>${rows}</tbody></table>` : "";
  };
  const page1 = `<section class="sheet">
  <div class="letterhead"><div class="name">${value(doc, "supplierName", 1)}</div>${addressBlock(ship.supplier.address)}</div>
  <h1>${esc(L.packingList ?? "")}</h1>
  <div class="grid">${row(L.invoiceRef ?? "", value(doc, "invoiceNumber", 1))}</div>
  <div class="grid"><div class="box"><div class="label">${esc(L.consigneeName ?? "")}</div>${value(doc, "consigneeName", 1)}${addressBlock(ship.importer.address)}</div></div>
  <table><thead><tr><th>#</th><th>${esc(L.description ?? "")}</th><th>${esc(L.quantity ?? "")}</th><th>${esc(L.unit ?? "")}</th></tr></thead><tbody>${lines}</tbody></table>
  ${totals(1)}
  <div class="footer">Page 1 of ${doc.page2 ? 2 : 1}<div class="sign">Packed and checked by, ${esc(ship.supplier.name)}</div></div>
</section>`;
  const page2 = doc.page2
    ? `<section class="sheet"><h1>${esc(L.packingList ?? "")} (continued)</h1><div class="muted">Packing summary</div>${totals(2)}<div class="footer">Page 2 of 2</div></section>`
    : "";
  return page1 + page2;
}

function billOfLading(ship: SampleShipment, doc: SampleDocument, L: Labels, goods: string) {
  return `<section class="sheet">
  <div class="letterhead"><div class="name">Company S Lines</div><div class="muted">Ocean carrier (synthetic sample)</div></div>
  <h1>${esc(L.bl ?? "")} &nbsp; <span class="muted">B/L No.</span> ${value(doc, "blNumber", 1)}</h1>
  <div class="grid">
    <div class="box"><div class="label">Shipper</div>${value(doc, "supplierName", 1)}${addressBlock(ship.supplier.address)}</div>
    <div class="box"><div class="label">Consignee</div>${value(doc, "consigneeName", 1)}${addressBlock(ship.importer.address)}</div>
    ${row("Port of loading", value(doc, "portOfLoading", 1))}${row("Port of discharge", value(doc, "portOfDischarge", 1))}
  </div>
  <table><thead><tr><th>Container No.</th><th>No. of packages</th><th>Description of goods</th><th>Gross weight</th>${doc.header.netWeight ? "<th>Net weight</th>" : ""}</tr></thead>
  <tbody><tr><td>${value(doc, "containerNumbers", 1)}</td><td>${value(doc, "totalPackages", 1)}</td><td>Said to contain: ${esc(goods)}</td><td class="num">${value(doc, "grossWeight", 1)}</td>${doc.header.netWeight ? `<td class="num">${value(doc, "netWeight", 1)}</td>` : ""}</tr></tbody></table>
  <div class="footer">Shipped on board in apparent good order and condition. Freight payable as per agreement.
    <div class="sign">For the carrier, Company S Lines</div></div>
</section>`;
}

/** Full HTML for one sample document. */
export function renderDocument(ship: SampleShipment, doc: SampleDocument, fontDataUri: string): string {
  const L = doc.variant === "bilingual" ? ZH : EN;
  const goods = ship.documents.find((d) => d.docType === "INVOICE")?.lines.map((l) => l.description).join("; ") ?? "general cargo";
  const body =
    doc.docType === "INVOICE" ? invoice(ship, doc, L) : doc.docType === "PACKING_LIST" ? packingList(ship, doc, L) : billOfLading(ship, doc, L, goods);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(fontDataUri)}</style></head><body>${body}</body></html>`;
}

/** Page images: wraps scanned page images back into A4 sheets (for a PDF with no text layer). */
export function imagesToHtml(jpegs: Buffer[]): string {
  const sheets = jpegs.map((b) => `<section class="sheet" style="padding:0"><img src="data:image/jpeg;base64,${b.toString("base64")}" style="width:100%;height:100%;display:block"></section>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS("data:,")}</style></head><body>${sheets.join("")}</body></html>`;
}

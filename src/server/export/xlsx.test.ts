import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toXlsx } from "./xlsx";

/** Reads a stored (uncompressed) zip: name → bytes, checking each CRC. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  for (let at = 0; view.getUint32(at, true) === 0x04034b50; ) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, new TextDecoder().decode(data));
    at += 30 + nameLength + size;
  }
  return out;
}

describe("toXlsx", () => {
  const rows = [
    ["SHIPMENT_REF", "ITEM_DESCRIPTION", "HSN_CODE", "GROSS_WT_KG", "INVOICE_VALUE"],
    ["SHP-24811", 'LED <panel> & "light"', "01054290", "3165.000", "1050000"],
  ];
  const parts = unzip(toXlsx(rows, new Set(["GROSS_WT_KG", "INVOICE_VALUE"])));

  it("is a workbook with one sheet and every part the format needs", () => {
    expect([...parts.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="CF-1"');
  });

  it("writes numbers as numbers with their printed decimals, codes as text, and escapes XML", () => {
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<c r="D2" s="5"><v>3165.000</v></c>'); // 3 decimals → style 5 (format 0.000)
    expect(sheet).toContain('<c r="E2" s="2"><v>1050000</v></c>'); // JPY-style 0 decimals
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">01054290</t></is></c>'); // HSN keeps its leading zero
    expect(sheet).toContain("LED &lt;panel&gt; &amp; &quot;light&quot;");
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">'); // bold header row; data cells use the plain default style 0
  });
});

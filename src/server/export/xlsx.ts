import "server-only";
import { crc32 } from "node:zlib";

// A minimal Office Open XML workbook: one sheet, inline strings, numbers with their printed decimals. An .xlsx file is
// a zip of a few XML parts; entries are stored uncompressed (the files are a few KB), so the zip is short to write.
// ponytail: one sheet, no shared strings or column widths; reach for a library if layouts grow beyond CF-1.

const xml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const column = (i: number): string => (i < 26 ? "" : column(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));
const NUMBER = /^-?\d+(\.\d+)?$/;
const MAX_DP = 6;

/** Rows → .xlsx bytes. `numeric` names the header cells whose values are written as numbers. */
export function toXlsx(rows: readonly (readonly string[])[], numeric: ReadonlySet<string>, sheetName = "CF-1"): Uint8Array {
  const header = rows[0] ?? [];
  const sheetRows = rows
    .map((row, r) => {
      const cells = row.map((value, c) => {
        const ref = `${column(c)}${r + 1}`;
        if (r > 0 && numeric.has(header[c] ?? "") && NUMBER.test(value)) {
          const dp = Math.min(MAX_DP, value.split(".")[1]?.length ?? 0);
          return `<c r="${ref}" s="${dp + 2}"><v>${value}</v></c>`; // style dp+2 shows exactly the printed decimals
        }
        return value === "" ? "" : `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    })
    .join("");
  const formats = Array.from({ length: MAX_DP + 1 }, (_, dp) => `<numFmt numFmtId="${164 + dp}" formatCode="${dp === 0 ? "0" : `0.${"0".repeat(dp)}`}"/>`).join("");
  const xfs = Array.from({ length: MAX_DP + 1 }, (_, dp) => `<xf numFmtId="${164 + dp}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join("");

  const parts: Array<[string, string]> = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${MAX_DP + 1}">${formats}</numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${MAX_DP + 3}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`],
  ];
  return zipStored(parts.map(([name, text]) => [name, new TextEncoder().encode(text)]));
}

/** A zip with every entry stored (method 0): local headers, data, central directory, end record. */
function zipStored(entries: Array<[string, Uint8Array]>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const fileName = new TextEncoder().encode(name);
    const crc = crc32(data) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, fileName.length, true);
    chunks.push(new Uint8Array(local.buffer), fileName, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, fileName.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), fileName);
    offset += 30 + fileName.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

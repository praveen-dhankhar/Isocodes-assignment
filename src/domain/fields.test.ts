import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEADER_FIELDS, LINE_FIELDS } from "./fields";

// The registry must be PRD §6 exactly: parse the PRD tables and compare.
const prd = readFileSync(new URL("../../docs/PRD.md", import.meta.url), "utf8");

function tableRows(heading: string): string[][] {
  const start = prd.indexOf(heading);
  const section = prd.slice(start, prd.indexOf("\n#", start + heading.length));
  return section
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

function registryFrom(rows: string[][], docTypes: string[]) {
  return Object.fromEntries(
    rows.map(([key = "", label, kind, ...cells]) => {
      const on = Object.fromEntries(
        docTypes.flatMap((docType, i) => {
          const cell = cells[i] ?? "";
          return cell.startsWith("R") ? [[docType, "R"]] : cell.startsWith("O") ? [[docType, "O"]] : [];
        }),
      );
      return [key.replaceAll("`", ""), { label, kind, on }];
    }),
  );
}

describe("field registry = PRD §6", () => {
  it("header fields (§6.1)", () => {
    const rows = tableRows("### 6.1 Header fields");
    expect(rows).toHaveLength(15);
    expect(HEADER_FIELDS).toEqual(registryFrom(rows, ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]));
  });

  it("line-item fields (§6.2)", () => {
    const rows = tableRows("### 6.2 Line-item fields");
    expect(rows).toHaveLength(6);
    expect(LINE_FIELDS).toEqual(registryFrom(rows, ["INVOICE", "PACKING_LIST"]));
  });
});

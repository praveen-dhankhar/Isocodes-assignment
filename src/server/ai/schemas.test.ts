import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HEADER_FIELDS, LINE_FIELDS, type DocType } from "@/domain/fields";
import { repairPrompt, userPrompt } from "./prompts";
import { PAGE_SCHEMAS, toModelJsonSchema } from "./schemas";

const SLOTS: DocType[] = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"];

describe("toModelJsonSchema (API_SPECS §2.2)", () => {
  it.each(SLOTS)("%s schema is pinned", (slot) => {
    expect(toModelJsonSchema(PAGE_SCHEMAS[slot])).toMatchSnapshot();
  });

  it("closes every object and drops bounds but keeps descriptions", () => {
    const text = JSON.stringify(toModelJsonSchema(PAGE_SCHEMAS.INVOICE));
    for (const banned of ['"minimum"', '"maximum"', '"maxLength"', '"maxItems"', '"$schema"']) expect(text).not.toContain(banned);
    expect(text).toContain("Exactly as printed");
    const objects = text.match(/"type":"object"/g)?.length ?? 0;
    expect(text.match(/"additionalProperties":false/g)?.length).toBe(objects);
  });
});

describe("page schemas follow the field registry (PRD §6)", () => {
  it.each(SLOTS)("%s has exactly the registry fields for its slot", (slot) => {
    const shape = PAGE_SCHEMAS[slot].shape;
    const header = Object.keys(HEADER_FIELDS).filter((k) => HEADER_FIELDS[k as keyof typeof HEADER_FIELDS].on[slot as never]);
    expect(Object.keys(shape.fields.shape).sort()).toEqual(header.sort());
    if ("lineItems" in shape) {
      const lines = Object.keys(LINE_FIELDS).filter((k) => LINE_FIELDS[k as keyof typeof LINE_FIELDS].on[slot as never]);
      expect(Object.keys(shape.lineItems.element.shape).sort()).toEqual(lines.sort());
    }
  });
});

describe("extraction fixtures (API_SPECS §7.4)", async () => {
  const manifest = JSON.parse(await readFile("fixtures/samples/manifest.json", "utf8")) as {
    samples: Array<{ ref: string; documents: Array<{ docType: DocType; sha256: string }> }>;
  };
  const slotBySha = new Map(manifest.samples.flatMap((s) => s.documents.map((d) => [d.sha256, d.docType] as const)));
  const files = (await readdir("fixtures/extractions")).filter((f) => f.endsWith(".json"));

  it("every bundled sample has a fixture", () => {
    expect(files.map((f) => f.replace(".json", "")).sort()).toEqual([...slotBySha.keys()].sort());
  });

  it.each(files)("%s validates against its slot's page schema", async (file) => {
    const fixture = JSON.parse(await readFile(`fixtures/extractions/${file}`, "utf8"));
    const slot = slotBySha.get(fixture.sha256);
    if (!slot) throw new Error("fixture for an unknown file");
    for (const page of fixture.pages) expect(PAGE_SCHEMAS[slot].safeParse(page.output).error?.issues ?? []).toEqual([]);
  });
});

describe("prompts (API_SPECS §2.3)", () => {
  it("names the slot and page and adds the slot hints", () => {
    expect(userPrompt("BILL_OF_LADING", 1, 2)).toBe(
      "Slot: BILL_OF_LADING. Page 1 of 2.\nblNumber = the B/L number. supplierName = Shipper. consigneeName = Consignee. totalPackages = number of packages stated for the cargo. grossWeight = gross weight stated for the cargo.",
    );
  });

  it("appends the JSON schema for the fallback model only", () => {
    expect(userPrompt("INVOICE", 1, 1, { type: "object" })).toContain('matching this JSON Schema:\n{"type":"object"}');
  });

  it("caps the repair prompt at 20 issues and 12,000 characters of output", () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({ path: `fields.f${i}`, message: "Required" }));
    const prompt = repairPrompt(issues, "x".repeat(20000));
    expect(prompt.match(/^- fields\./gm)).toHaveLength(20);
    expect(prompt).toContain(`${"x".repeat(12000)}\nReturn the corrected JSON object only.`);
  });
});

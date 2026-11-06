import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { findEvidence } from "@/domain/evidence";
import { extractTextLayer } from "./text-layer";

const read = (file: string) => readFile(file).then((b) => new Uint8Array(b));
const manifest = JSON.parse(await readFile("fixtures/samples/manifest.json", "utf8")) as {
  samples: Array<{ ref: string; documents: Array<{ docType: string; file: string; sha256: string }> }>;
};
const entry = (ref: string, docType: string) => manifest.samples.find((s) => s.ref === ref)?.documents.find((d) => d.docType === docType);

describe("extractTextLayer", () => {
  it("reads the SHP-24811 invoice text layer, including 3,120.00", async () => {
    const { hasTextLayer, pages } = await extractTextLayer(await read("fixtures/samples/SHP-24811/invoice.pdf"));
    expect(hasTextLayer).toBe(true);
    expect(pages).toHaveLength(1);
    const text = (pages[0] ?? []).map((t) => t.str).join(" ");
    expect(text).toContain("3,120.00");
    expect(text).toContain("CB-2026-1187");
    for (const { box } of pages[0] ?? []) {
      for (const v of [box.x, box.y, box.w, box.h]) expect(v).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1.0001);
    }
  });

  it("finds a printed value and boxes it in page fractions, origin top-left", async () => {
    const doc = entry("SHP-24811", "INVOICE");
    const { pages } = await extractTextLayer(await read(`fixtures/samples/${doc?.file}`));
    const found = findEvidence("WEIGHT", "3,120.00 KGS", pages[0] ?? null, ".");
    expect(found.evidence).toBe("FOUND");
    if (found.evidence !== "FOUND" || !found.box) throw new Error("no box");
    // The invoice prints gross weight in the totals table: right-hand column, a little above the middle of the page.
    expect(found.box.x).toBeGreaterThan(0.6);
    expect(found.box.x + found.box.w).toBeLessThanOrEqual(1);
    expect(found.box.y).toBeGreaterThan(0.3);
    expect(found.box.y).toBeLessThan(0.6);
    expect(found.box.h).toBeGreaterThan(0);
  });

  it("reads the European invoice's numbers with a comma separator", async () => {
    const { pages } = await extractTextLayer(await read("fixtures/samples/SHP-24812/invoice.pdf"));
    expect(findEvidence("MONEY", "7.650,00", pages[0] ?? null, ",").evidence).toBe("FOUND");
  });

  it("has no text layer for a PDF of scanned pages", async () => {
    expect(await extractTextLayer(await read("fixtures/samples/SHP-24818/packing-list.pdf"))).toEqual({ hasTextLayer: false, pages: [null, null] });
  });
});

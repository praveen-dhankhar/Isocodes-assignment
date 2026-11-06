import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LONG_EDGE, renderPages } from "./render";

const sample = (file: string) => readFile(`fixtures/samples/${file}`).then((b) => new Uint8Array(b));

describe("renderPages (ARCHITECTURE §7.1)", () => {
  it.each([
    ["SHP-24811/invoice.pdf", "pdf", 1],
    ["SHP-24818/packing-list.pdf", "pdf", 2],
    ["SHP-24813/bill-of-lading.png", "png", 1],
    ["SHP-24815/bill-of-lading.jpg", "jpeg", 1],
  ] as const)("%s (%s) → %i WebP page(s), long edge ≤ 1800 px", async (file, kind, count) => {
    const pages = await renderPages(await sample(file), kind);
    expect(pages.map((p) => p.pageNo)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    for (const page of pages) {
      const meta = await sharp(page.webp).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([page.width, page.height]);
      expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(LONG_EDGE);
    }
  });

  it("renders PDF pages at the full 1800 px long edge in A4 proportion", async () => {
    const [page] = await renderPages(await sample("SHP-24811/invoice.pdf"), "pdf");
    expect(page?.height).toBeGreaterThanOrEqual(LONG_EDGE - 2);
    expect((page?.width ?? 0) / (page?.height ?? 1)).toBeCloseTo(210 / 297, 2);
  });

  it("applies EXIF orientation to photos", async () => {
    const portrait = await sharp({ create: { width: 40, height: 80, channels: 3, background: "#fff" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const [page] = await renderPages(new Uint8Array(portrait), "jpeg");
    expect([page?.width, page?.height]).toEqual([80, 40]); // orientation 6 = rotate 90°
  });
});

import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_BASE64_BYTES, toModelJpeg } from "./images";

describe("toModelJpeg (API_SPECS §2.1 image rules)", () => {
  it("steps a 443 KB phone scan down under 180 KB base64, as RGB JPEG ≤ 1536 px", async () => {
    const scan = new Uint8Array(await readFile("fixtures/samples/SHP-24815/bill-of-lading.jpg"));
    expect(scan.length * (4 / 3)).toBeGreaterThan(MAX_BASE64_BYTES); // would not fit as is
    const b64 = await toModelJpeg(scan, { grayscale: true });
    expect(b64.length).toBeLessThanOrEqual(MAX_BASE64_BYTES);
    const meta = await sharp(Buffer.from(b64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1536);
  });

  it("flattens transparency onto white", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data, info } = await sharp(Buffer.from(await toModelJpeg(new Uint8Array(png)), "base64")).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(data[0]).toBeGreaterThan(245); // white, not black
  });

  it("keeps a small page image at its size and makes scans grayscale", async () => {
    const page = await sharp({ create: { width: 800, height: 1100, channels: 3, background: "#e8d0b0" } }).webp().toBuffer();
    const b64 = await toModelJpeg(new Uint8Array(page), { grayscale: true });
    const { data, info } = await sharp(Buffer.from(b64, "base64")).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([800, 1100]);
    expect(data[0] === data[1] && data[1] === data[2]).toBe(true); // R = G = B
  });
});

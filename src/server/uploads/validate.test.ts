import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES, sniff, validateUpload } from "./validate";

const sample = (file: string) => readFile(`fixtures/samples/${file}`).then((b) => new Uint8Array(b));

/** A bare PDF with `n` empty pages (PDF.js rebuilds the missing xref table). */
function blankPdf(n: number): Uint8Array {
  const kids = Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(" ");
  const pages = Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj`);
  return new TextEncoder().encode(
    ["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${n} >> endobj`, ...pages, "trailer << /Root 1 0 R >>", "%%EOF"].join("\n"),
  );
}

const outcome = (p: Promise<unknown>) => p.then((v) => v, (e: unknown) => (e instanceof AppError ? e.code : String(e)));

describe("validateUpload (A-02)", () => {
  it.each([
    ["SHP-24811/invoice.pdf", "application/pdf", "pdf", 1],
    ["SHP-24818/packing-list.pdf", "application/pdf", "pdf", 2],
    ["SHP-24813/bill-of-lading.png", "image/png", "png", 1],
    ["SHP-24815/bill-of-lading.jpg", "image/jpeg", "jpeg", 1],
  ])("accepts %s", async (file, mimeType, kind, pageCount) => {
    expect(await validateUpload(await sample(file), { filename: file, mimeType })).toEqual({ kind, mimeType, pageCount });
  });

  it("rejects a .pdf that is really a PNG", async () => {
    const png = await sample("SHP-24813/bill-of-lading.png");
    expect(await outcome(validateUpload(png, { filename: "invoice.pdf", mimeType: "application/pdf" }))).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("goes by content when the name says nothing", async () => {
    const png = await sample("SHP-24813/bill-of-lading.png");
    expect(await outcome(validateUpload(png, { filename: "scan", mimeType: "application/octet-stream" }))).toMatchObject({ kind: "png" });
  });

  it("rejects a 6-page PDF with PAGE_LIMIT_EXCEEDED", async () => {
    expect(await outcome(validateUpload(blankPdf(6), { filename: "six.pdf", mimeType: "application/pdf" }))).toBe("PAGE_LIMIT_EXCEEDED");
    expect(await outcome(validateUpload(blankPdf(5), { filename: "five.pdf", mimeType: "application/pdf" }))).toMatchObject({ pageCount: 5 });
  });

  it("rejects files over 4 MB", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(await outcome(validateUpload(big, { filename: "big.pdf", mimeType: "application/pdf" }))).toBe("FILE_TOO_LARGE");
  });

  it.each([
    ["a text file", new TextEncoder().encode("hello")],
    ["a GIF", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ["a broken PDF", new TextEncoder().encode("%PDF-1.7 truncated garbage")],
  ])("rejects %s as UNSUPPORTED_FILE_TYPE", async (_, bytes) => {
    expect(await outcome(validateUpload(bytes, { filename: "x", mimeType: "" }))).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("sniffs by magic bytes", () => {
    expect([sniff(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), sniff(new Uint8Array([0]))]).toEqual(["pdf", "jpeg", null]);
  });
});

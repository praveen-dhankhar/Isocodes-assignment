import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertKey, contentTypeOf, type BlobStore } from "./index";
import { LocalBlobStore } from "./local";

const root = await mkdtemp(path.join(tmpdir(), "blobstore-"));
const store: BlobStore = new LocalBlobStore(root);
afterAll(() => rm(root, { recursive: true, force: true }));

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message));

describe("LocalBlobStore", () => {
  it("puts, gets, streams and deletes", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 sample");
    await store.put("shipments/s1/d1/original.pdf", bytes, "application/pdf");
    expect(await store.get("shipments/s1/d1/original.pdf")).toEqual(bytes);

    const { body, contentType, size } = await store.stream("shipments/s1/d1/original.pdf");
    expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqual(bytes);
    expect([contentType, size]).toEqual(["application/pdf", bytes.length]);

    await store.delete("shipments/s1/d1/original.pdf");
    expect(await code(store.get("shipments/s1/d1/original.pdf"))).toBe("NOT_FOUND");
  });

  it("reports a missing file as NOT_FOUND", async () => {
    expect(await code(store.stream("shipments/none.pdf"))).toBe("NOT_FOUND");
  });

  it("deleting a missing file is not an error", async () => {
    expect(await code(store.delete("shipments/none.pdf"))).toBe("ok");
  });
});

describe("storage keys", () => {
  it.each(["shipments/a/b/original.pdf", "shipments/a/page-1.webp", "x.csv"])("accepts %s", (key) => {
    expect(() => assertKey(key)).not.toThrow();
  });

  it.each(["../etc/passwd", "/abs/path", "a//b", "a/../b", "a/./b", "", "a b.pdf", "shipments/évil.pdf"])("rejects %j", (key) => {
    expect(() => assertKey(key)).toThrow("Invalid storage key");
  });

  it("refuses to escape the root even through the store", async () => {
    expect(await code(store.put("../outside.pdf", new Uint8Array(1), "application/pdf"))).toBe("Invalid storage key");
  });

  it.each([
    ["a/original.pdf", "application/pdf"],
    ["a/page-1.webp", "image/webp"],
    ["a/scan.JPG", "image/jpeg"],
    ["a/export.csv", "text/csv; charset=utf-8"],
    ["a/unknown.bin", "application/octet-stream"],
  ])("content type of %s is %s", (key, type) => {
    expect(contentTypeOf(key)).toBe(type);
  });
});

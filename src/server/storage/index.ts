import "server-only";
import { env } from "@/lib/env";
import { LocalBlobStore } from "./local";
import { SupabaseBlobStore } from "./supabase";

/** Originals, page images and exports (ARCHITECTURE §2). Keys are always server-generated — never a filename. */
export interface BlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  stream(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number | null }>;
  delete(key: string): Promise<void>;
}

/** Rejects anything that is not a plain relative key (no "..", no leading "/", no odd characters). */
export function assertKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(key) || key.split("/").includes("..")) {
    throw new Error("Invalid storage key");
  }
}

export const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const contentTypeOf = (key: string) => CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

let instance: BlobStore | undefined;

/** STORAGE_DRIVER picks the backend: local disk in dev and tests, Supabase Storage (private bucket) in production. */
export function blobStore(): BlobStore {
  if (!instance) {
    const e = env();
    instance =
      e.STORAGE_DRIVER === "supabase"
        ? new SupabaseBlobStore(e.SUPABASE_URL ?? "", e.SUPABASE_SERVICE_ROLE_KEY ?? "", e.SUPABASE_STORAGE_BUCKET)
        : new LocalBlobStore(e.LOCAL_STORAGE_DIR);
  }
  return instance;
}

import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { SupabaseBlobStore } from "./supabase";

type Call = { url: string; method: string; headers: Record<string, string> };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, impl };
}

const BASE = "https://proj.supabase.co/";
const SECRET = "sb_secret_test"; // not a real key
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : (e as Error).message));

describe("SupabaseBlobStore", () => {
  it("uploads with upsert to the bucket path, the secret key in apikey only", async () => {
    const f = fakeFetch(() => new Response("{}", { status: 200 }));
    await new SupabaseBlobStore(BASE, SECRET, "documents", f.impl).put("shipments/s1/original.pdf", new Uint8Array([1]), "application/pdf");
    expect(f.calls[0]).toMatchObject({
      url: "https://proj.supabase.co/storage/v1/object/documents/shipments/s1/original.pdf",
      method: "POST",
      headers: { apikey: SECRET, "Content-Type": "application/pdf", "x-upsert": "true" },
    });
    expect(f.calls[0]?.headers.Authorization).toBeUndefined();
  });

  it("sends a legacy JWT service key as Bearer too", async () => {
    const f = fakeFetch(() => new Response("{}"));
    await new SupabaseBlobStore(BASE, "eyJhbGciOi.test", "documents", f.impl).delete("a/b.pdf");
    expect(f.calls[0]?.headers.Authorization).toBe("Bearer eyJhbGciOi.test");
  });

  it("downloads through the authenticated object path", async () => {
    const f = fakeFetch(() => new Response(new Uint8Array([7, 8]), { headers: { "content-type": "image/webp", "content-length": "2" } }));
    const store = new SupabaseBlobStore(BASE, SECRET, "documents", f.impl);
    expect(await store.get("a/page-1.webp")).toEqual(new Uint8Array([7, 8]));
    const streamed = await store.stream("a/page-1.webp");
    expect([streamed.contentType, streamed.size]).toEqual(["image/webp", 2]);
    expect(f.calls[0]?.url).toBe("https://proj.supabase.co/storage/v1/object/authenticated/documents/a/page-1.webp");
  });

  it.each([
    [new Response("not found", { status: 404 }), "NOT_FOUND"],
    [new Response('{"error":"not_found","message":"Object not found"}', { status: 400 }), "NOT_FOUND"],
    [new Response("boom", { status: 500 }), "Supabase Storage download failed with HTTP 500"],
  ])("maps a failed download: %#", async (response, expected) => {
    const f = fakeFetch(() => response);
    expect(await code(new SupabaseBlobStore(BASE, SECRET, "documents", f.impl).get("a/b.pdf"))).toBe(expected);
  });

  it("never puts the key in an error message", async () => {
    const f = fakeFetch(() => new Response(`bad key ${SECRET}`, { status: 403 }));
    const message = await code(new SupabaseBlobStore(BASE, SECRET, "documents", f.impl).put("a/b.pdf", new Uint8Array(1), "application/pdf"));
    expect(message).toBe("Supabase Storage upload failed with HTTP 403");
  });

  it("treats deleting a missing object as done", async () => {
    const f = fakeFetch(() => new Response("", { status: 404 }));
    expect(await code(new SupabaseBlobStore(BASE, SECRET, "documents", f.impl).delete("a/b.pdf"))).toBe("ok");
  });

  it("validates keys before any request", async () => {
    const f = fakeFetch(() => new Response("{}"));
    expect(await code(new SupabaseBlobStore(BASE, SECRET, "documents", f.impl).get("../x"))).toBe("Invalid storage key");
    expect(f.calls).toHaveLength(0);
  });
});

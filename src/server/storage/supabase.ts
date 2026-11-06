import "server-only";
import { AppError } from "@/lib/errors";
import { assertKey, contentTypeOf, type BlobStore } from "./index";

/**
 * Supabase Storage over its REST API with the server-only secret key (plain fetch, no SDK). The bucket is private;
 * files reach browsers only through authorised routes (ARCHITECTURE §9).
 */
export class SupabaseBlobStore implements BlobStore {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // New secret keys (sb_secret_…) authenticate through `apikey`; legacy service_role keys are JWTs and go as Bearer.
    const bearer: Record<string, string> = this.key.startsWith("eyJ") ? { Authorization: `Bearer ${this.key}` } : {};
    return { apikey: this.key, ...bearer, ...extra };
  }

  private objectUrl(key: string, authenticated = false): string {
    assertKey(key);
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${authenticated ? "authenticated/" : ""}${encodeURIComponent(this.bucket)}/${path}`;
  }

  private async fail(response: Response, action: string): Promise<never> {
    if (response.status === 404 || response.status === 400) {
      const text = await response.text().catch(() => "");
      if (response.status === 404 || /not.?found/i.test(text)) throw new AppError("NOT_FOUND", "File not found");
    }
    // Status only: storage error bodies can echo keys or paths.
    throw new Error(`Supabase Storage ${action} failed with HTTP ${response.status}`);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const response = await this.fetchImpl(this.objectUrl(key), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "max-age=0" }),
      body: new Uint8Array(body), // a copy backed by a plain ArrayBuffer, which fetch accepts
    });
    if (!response.ok) await this.fail(response, "upload");
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.fetchImpl(this.objectUrl(key, true), { headers: this.headers() });
    if (!response.ok) await this.fail(response, "download");
    return new Uint8Array(await response.arrayBuffer());
  }

  async stream(key: string) {
    const response = await this.fetchImpl(this.objectUrl(key, true), { headers: this.headers() });
    if (!response.ok || !response.body) return this.fail(response, "download");
    const length = response.headers.get("content-length");
    return { body: response.body, contentType: response.headers.get("content-type") ?? contentTypeOf(key), size: length ? Number(length) : null };
  }

  async delete(key: string): Promise<void> {
    const response = await this.fetchImpl(this.objectUrl(key), { method: "DELETE", headers: this.headers() });
    if (!response.ok && response.status !== 404) await this.fail(response, "delete");
  }
}

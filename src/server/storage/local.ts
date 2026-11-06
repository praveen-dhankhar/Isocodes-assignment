import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AppError } from "@/lib/errors";
import { assertKey, contentTypeOf, type BlobStore } from "./index";

const isMissing = (e: unknown) => e instanceof Error && "code" in e && e.code === "ENOENT";

/** Files under a root directory (default ./.data); for local development and tests only. */
export class LocalBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(key: string): string {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch (e) {
      if (isMissing(e)) throw new AppError("NOT_FOUND", "File not found");
      throw e;
    }
  }

  async stream(key: string) {
    const file = this.file(key);
    try {
      const { size } = await stat(file);
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return { body, contentType: contentTypeOf(key), size };
    } catch (e) {
      if (isMissing(e)) throw new AppError("NOT_FOUND", "File not found");
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}

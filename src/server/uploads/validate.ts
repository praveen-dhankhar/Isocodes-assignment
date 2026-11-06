import "server-only";
import { getDocumentProxy } from "unpdf";
import { AppError } from "@/lib/errors";

// A-02: PDF, JPEG or PNG; ≤ 4 MB (under Vercel's 4.5 MB request body limit); ≤ 5 pages.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_PAGES = 5;

export type UploadKind = "pdf" | "png" | "jpeg";
export const MIME: Record<UploadKind, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };
export const EXTENSION: Record<UploadKind, string> = { pdf: "pdf", png: "png", jpeg: "jpg" };

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/** What the bytes are, by magic number — never by filename or browser-supplied type. */
export function sniff(bytes: Uint8Array): UploadKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  return null;
}

/** The type a client claims through filename extension or Content-Type, when it claims one we know. */
function claimed(filename: string, mimeType: string): UploadKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "png" || mimeType === "image/png") return "png";
  if (ext === "jpg" || ext === "jpeg" || mimeType === "image/jpeg") return "jpeg";
  return null;
}

export interface ValidatedUpload {
  kind: UploadKind;
  mimeType: string;
  pageCount: number;
}

/** ARCHITECTURE §7.1 step 2. Throws AppError FILE_TOO_LARGE / UNSUPPORTED_FILE_TYPE / PAGE_LIMIT_EXCEEDED. */
export async function validateUpload(bytes: Uint8Array, declared: { filename: string; mimeType: string }): Promise<ValidatedUpload> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Files can be at most 4 MB");
  const kind = sniff(bytes);
  if (!kind) throw new AppError("UNSUPPORTED_FILE_TYPE", "Upload a PDF, JPEG or PNG file");
  const says = claimed(declared.filename, declared.mimeType);
  if (says && says !== kind) {
    throw new AppError("UNSUPPORTED_FILE_TYPE", `This file is named as ${says.toUpperCase()} but its contents are ${kind.toUpperCase()}`);
  }

  let pageCount = 1;
  if (kind === "pdf") {
    try {
      pageCount = (await getDocumentProxy(new Uint8Array(bytes))).numPages;
    } catch {
      throw new AppError("UNSUPPORTED_FILE_TYPE", "This PDF could not be read");
    }
  }
  if (pageCount > MAX_PAGES) throw new AppError("PAGE_LIMIT_EXCEEDED", `Documents can have at most ${MAX_PAGES} pages; this one has ${pageCount}`);
  return { kind, mimeType: MIME[kind], pageCount };
}

import type { DocType } from "@/domain/fields";

// Client-side mirror of the upload limits (A-02) so a wrong file is caught before it travels; the server re-checks
// everything (magic bytes, size, pages) and its message wins.
export const MAX_BYTES = 4 * 1024 * 1024;
export const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const ALLOWED = /\.(pdf|jpe?g|png)$/i;

export function precheck(file: File): string | null {
  if (!ALLOWED.test(file.name)) return "Only PDF, JPEG or PNG files can be uploaded.";
  if (file.size > MAX_BYTES) return `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB.`;
  if (file.size === 0) return "This file is empty.";
  return null;
}

export type UploadOutcome = { ok: true; documentId: string } | { ok: false; message: string };

/** POST /api/shipments/:id/documents with upload progress (fetch has no upload progress, XHR does). */
export function uploadFile(shipmentId: string, docType: DocType, file: File, onProgress: (fraction: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/shipments/${encodeURIComponent(shipmentId)}/documents`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => resolve({ ok: false, message: "The upload did not reach the server. Check the connection and try again." });
    xhr.onload = () => {
      const body: unknown = xhr.response;
      if (xhr.status === 201 && isUploaded(body)) return resolve({ ok: true, documentId: body.document.id });
      resolve({ ok: false, message: errorMessage(body) ?? `Upload failed (HTTP ${xhr.status}).` });
    };
    const form = new FormData();
    form.set("docType", docType);
    form.set("file", file);
    xhr.send(form);
  });
}

const isUploaded = (b: unknown): b is { document: { id: string } } =>
  typeof b === "object" && b !== null && "document" in b && typeof (b as { document: { id?: unknown } }).document?.id === "string";

function errorMessage(b: unknown): string | null {
  const error = typeof b === "object" && b !== null && "error" in b ? (b as { error: { message?: unknown } }).error : null;
  return typeof error?.message === "string" ? error.message : null;
}

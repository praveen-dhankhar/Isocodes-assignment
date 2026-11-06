import "server-only";
import { extractTextItems, getDocumentProxy } from "unpdf";
import type { TextItem } from "@/domain/evidence";

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The PDF text layer per page as strings with boxes normalised to the page (origin top-left), for evidence matching
 * (ARCHITECTURE §7.3) and highlighting. A page without text — a scanned page — is null.
 */
export async function extractTextLayer(bytes: Uint8Array): Promise<{ hasTextLayer: boolean; pages: Array<TextItem[] | null> }> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { items } = await extractTextItems(doc);
  const pages: Array<TextItem[] | null> = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const { width: W, height: H } = (await doc.getPage(pageNo)).getViewport({ scale: 1 });
    const texts = (items[pageNo - 1] ?? [])
      .filter((t) => t.str.trim() !== "")
      .map((t) => ({
        str: t.str,
        // PDF space has its origin bottom-left at the baseline; the box spans one text height above it.
        box: { x: r4(clamp(t.x / W)), y: r4(clamp((H - t.y - t.height) / H)), w: r4(clamp(t.width / W)), h: r4(clamp(t.height / H)) },
      }));
    pages.push(texts.length > 0 ? texts : null);
  }
  return { hasTextLayer: pages.some((p) => p !== null), pages };
}

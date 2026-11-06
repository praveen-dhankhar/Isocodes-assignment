import "server-only";
import sharp from "sharp";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import type { UploadKind } from "../uploads/validate";

/** Viewer images: ~1800 px on the long edge, WebP q80 (ARCHITECTURE §7.1 step 4). */
export const LONG_EDGE = 1800;

export interface RenderedPage {
  pageNo: number;
  webp: Uint8Array;
  width: number;
  height: number;
}

const toWebp = async (input: Uint8Array | Buffer) => {
  const { data, info } = await sharp(input).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  return { webp: new Uint8Array(data), width: info.width, height: info.height };
};

/** One WebP per page: PDFs through PDF.js + @napi-rs/canvas; images auto-oriented from EXIF by sharp. */
export async function renderPages(bytes: Uint8Array, kind: UploadKind): Promise<RenderedPage[]> {
  if (kind !== "pdf") {
    const oriented = await sharp(bytes).rotate().resize(LONG_EDGE, LONG_EDGE, { fit: "inside", withoutEnlargement: true }).toBuffer();
    return [{ pageNo: 1, ...(await toWebp(oriented)) }];
  }

  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const pages: RenderedPage[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const { width, height } = (await doc.getPage(pageNo)).getViewport({ scale: 1 });
    const png = await renderPageAsImage(doc, pageNo, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: LONG_EDGE / Math.max(width, height),
    });
    pages.push({ pageNo, ...(await toWebp(png)) });
  }
  return pages;
}

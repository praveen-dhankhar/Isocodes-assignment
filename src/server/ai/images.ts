import "server-only";
import sharp from "sharp";

// API_SPECS §2.1 image rules: JPEG, RGB (no alpha), long edge ≤ 1536 px, base64 ≤ 180 KB (larger payloads need
// NVIDIA's asset upload, which we never use). Step quality down first, then size.
export const MAX_BASE64_BYTES = 180 * 1024;
const QUALITIES = [80, 70, 60, 50];
const EDGES = [1536, 1280, 1024];

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** A page image (WebP from storage, or an uploaded JPEG/PNG) as the base64 JPEG the model receives. */
export async function toModelJpeg(image: Uint8Array, opts: { grayscale?: boolean } = {}): Promise<string> {
  let smallest: Buffer | undefined;
  for (const edge of EDGES) {
    const base = sharp(image).rotate().flatten({ background: "#ffffff" }).resize(edge, edge, { fit: "inside", withoutEnlargement: true });
    const prepared = await (opts.grayscale ? base.grayscale() : base).toColourspace("srgb").toBuffer();
    for (const quality of QUALITIES) {
      const jpeg = await sharp(prepared).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (base64Length(jpeg.length) <= MAX_BASE64_BYTES) return jpeg.toString("base64");
      if (!smallest || jpeg.length < smallest.length) smallest = jpeg;
    }
  }
  // ponytail: an image still over 180 KB at 1024 px / q50 goes as is; add a further step if the API starts rejecting it.
  return (smallest ?? Buffer.alloc(0)).toString("base64");
}

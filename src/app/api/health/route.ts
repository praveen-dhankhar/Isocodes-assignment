import { renderPages } from "@/server/pdf/render";

// Deploy smoke check: renders a blank in-memory PDF page through PDF.js, @napi-rs/canvas and sharp, proving the native
// modules load in this region. No auth, no data, nothing stored.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLANK_PDF = new TextEncoder().encode(
  ["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj", "trailer << /Root 1 0 R >>", "%%EOF"].join("\n"),
);

export async function GET() {
  const started = performance.now();
  try {
    const [page] = await renderPages(BLANK_PDF, "pdf");
    return Response.json({ ok: true, pdfRender: page ? `${page.width}x${page.height} webp` : "no page", region: process.env.VERCEL_REGION ?? "local", ms: Math.round(performance.now() - started) });
  } catch (e) {
    return Response.json({ ok: false, pdfRender: e instanceof Error ? e.name : "error", region: process.env.VERCEL_REGION ?? "local" }, { status: 503 });
  }
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DocType } from "@/domain/fields";
import { env } from "@/lib/env";
import { toModelJpeg } from "@/server/ai/images";
import { NvidiaVisionProvider, type CallRecord, type PageInput, type PageResult } from "@/server/ai/nvidia";
import { renderPages } from "@/server/pdf/render";
import { extractTextLayer } from "@/server/pdf/text-layer";
import { sniff } from "@/server/uploads/validate";

// Shared by fixtures:record and eval:extraction: the bundled samples through the live model, page by page, exactly as
// the extraction service prepares them (same render, same JPEG, same prompts).

export const SAMPLES_DIR = "fixtures/samples";

const Truth = z.object({ header: z.record(z.string(), z.string().nullable()), lines: z.array(z.record(z.string(), z.string().nullable())) });
const Manifest = z.object({
  samples: z.array(
    z.object({
      ref: z.string(),
      documents: z.array(z.object({ docType: DocType, file: z.string(), sha256: z.string(), variant: z.string(), truth: Truth })),
    }),
  ),
});
export type SampleFile = z.infer<typeof Manifest>["samples"][number]["documents"][number] & { ref: string };

/** `--model <one of models>` (default the first) and any number of `--ref SHP-…`. */
export function parseArgs<M extends string>(argv: string[], models: readonly [M, ...M[]]): { variant: M; refs: string[] } {
  const values = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1] ?? ""] : []));
  const variant = values("--model")[0] ?? models[0];
  const known = models.find((m) => m === variant);
  if (!known) throw new Error(`--model must be one of: ${models.join(", ")}`);
  return { variant: known, refs: values("--ref") };
}

export async function sampleFiles(refs: string[]): Promise<SampleFile[]> {
  const manifest = Manifest.parse(JSON.parse(await readFile(path.join(SAMPLES_DIR, "manifest.json"), "utf8")));
  const unknown = refs.filter((r) => !manifest.samples.some((s) => s.ref === r));
  if (unknown.length > 0) throw new Error(`Unknown sample ref: ${unknown.join(", ")}`);
  return manifest.samples.filter((s) => refs.length === 0 || refs.includes(s.ref)).flatMap((s) => s.documents.map((d) => ({ ...d, ref: s.ref })));
}

export function liveModel(variant: "primary" | "fallback"): NvidiaVisionProvider {
  const e = env();
  if (!e.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not set; add it to .env.local");
  const model = variant === "primary" ? e.NVIDIA_VLM_MODEL : e.NVIDIA_VLM_FALLBACK_MODEL;
  return new NvidiaVisionProvider({ baseUrl: e.NVIDIA_BASE_URL, apiKey: e.NVIDIA_API_KEY, model, variant });
}

/** The live provider, or the stored fixture for one file (eval only). */
export interface PageReader {
  readonly modelId: string;
  calls?: CallRecord[];
  extractPage(input: PageInput): Promise<PageResult>;
}

export interface PageRun {
  pageNo: number;
  result: PageResult;
  calls: CallRecord[];
}

export async function readSample(model: PageReader, file: SampleFile): Promise<PageRun[]> {
  const bytes = new Uint8Array(await readFile(path.join(SAMPLES_DIR, file.file)));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`${file.file} does not match the manifest; run pnpm samples:generate`);
  const kind = sniff(bytes);
  if (!kind) throw new Error(`${file.file}: unsupported file type`);
  const hasTextLayer = kind === "pdf" && (await extractTextLayer(bytes)).hasTextLayer;
  const pages = await renderPages(bytes, kind);

  const runs: PageRun[] = [];
  for (const page of pages) {
    const jpegBase64 = await toModelJpeg(page.webp, { grayscale: !hasTextLayer });
    const result = await model.extractPage({ slot: file.docType, pageNo: page.pageNo, pageCount: pages.length, jpegBase64 });
    runs.push({ pageNo: page.pageNo, result, calls: [...(model.calls ?? [])] });
  }
  return runs;
}

import "server-only";
import type { Env } from "@/lib/env";
import { NvidiaVisionProvider, type AiError, type CallRecord, type PageInput, type PageResult } from "./nvidia";
import { hasFixture, RecordedSampleProvider } from "./sample";

export type { AiError, CallRecord, PageInput, PageResult } from "./nvidia";

/** ARCHITECTURE §8.1. */
export interface ExtractionProvider {
  readonly mode: "LIVE" | "SAMPLE";
  readonly modelId: string;
  /** Live providers expose the HTTP calls of their last extractPage. */
  readonly calls?: CallRecord[];
  extractPage(input: PageInput): Promise<PageResult>;
}

type ProviderEnv = Pick<Env, "EXTRACTION_MODE" | "NVIDIA_API_KEY" | "NVIDIA_BASE_URL" | "NVIDIA_VLM_MODEL" | "NVIDIA_VLM_FALLBACK_MODEL">;

/**
 * ARCHITECTURE §8.2. The ordered chain for one file:
 *   auto   — primary, fallback (with a key), then the recorded sample (if the file has one);
 *   live   — primary, fallback; never a sample (proves the AI is real);
 *   sample — the recorded sample only; no network (CI, e2e).
 * An empty chain means the document fails with AI_NOT_CONFIGURED: nothing is invented for an unknown file.
 */
export function selectProviders(
  env: ProviderEnv,
  sha256: string,
  deps: { fetch?: typeof fetch; hasFixture?: (sha256: string) => boolean } = {},
): ExtractionProvider[] {
  const live: ExtractionProvider[] = env.NVIDIA_API_KEY
    ? (["primary", "fallback"] as const).map(
        (variant) =>
          new NvidiaVisionProvider({
            baseUrl: env.NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY, variant, fetch: deps.fetch,
            model: variant === "primary" ? env.NVIDIA_VLM_MODEL : env.NVIDIA_VLM_FALLBACK_MODEL,
          }),
      )
    : [];
  const sample: ExtractionProvider[] = (deps.hasFixture ?? hasFixture)(sha256) ? [new RecordedSampleProvider(sha256)] : [];
  if (env.EXTRACTION_MODE === "live") return live;
  if (env.EXTRACTION_MODE === "sample") return sample;
  return [...live, ...sample];
}

export interface ChainResult {
  result: PageResult;
  provider: ExtractionProvider | null;
  /** Live providers that failed before the one that answered (for EXTRACTION_FALLBACK_USED). */
  failed: Array<{ modelId: string; error: AiError }>;
  calls: CallRecord[];
}

/**
 * One page through the chain. After a live failure the next live model is tried only if the error was retryable or
 * the output invalid (a bad key would fail the same way); the recorded sample is always the last resort.
 */
export async function extractWithChain(chain: ExtractionProvider[], input: PageInput): Promise<ChainResult> {
  const failed: ChainResult["failed"] = [];
  const calls: CallRecord[] = [];
  let skipLive = false;
  let last: PageResult = { ok: false, error: { code: "AI_NOT_CONFIGURED", retryable: false, message: "No live model or recorded sample for this file" } };
  for (const provider of chain) {
    if (provider.mode === "LIVE" && skipLive) continue;
    const result = await provider.extractPage(input);
    calls.push(...(provider.calls ?? []));
    if (result.ok) return { result, provider, failed, calls };
    last = result;
    if (provider.mode === "LIVE") {
      failed.push({ modelId: provider.modelId, error: result.error });
      skipLive = !(result.error.retryable || result.error.code === "AI_INVALID_OUTPUT");
    }
  }
  return { result: last, provider: null, failed, calls };
}

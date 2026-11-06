import "server-only";
import type { z } from "zod";
import type { DocType } from "@/domain/fields";
import { repairPrompt, SYSTEM_PROMPT, userPrompt } from "./prompts";
import { ChatCompletion, PAGE_SCHEMAS, toModelJsonSchema, type PageExtraction } from "./schemas";

// ARCHITECTURE §8.1–8.3, API_SPECS §2.1/§2.4. Plain fetch (injected for tests); no SDK.

export type AiErrorCode = "AI_UNAVAILABLE" | "AI_RATE_LIMITED" | "AI_INVALID_OUTPUT" | "AI_TIMEOUT" | "AI_NOT_CONFIGURED";
export interface AiError {
  code: AiErrorCode;
  retryable: boolean;
  message: string;
}

export interface PageInput {
  slot: DocType;
  pageNo: number;
  pageCount: number;
  jpegBase64: string;
}

/** One HTTP call, recorded into documents.ai_usage — ids, counts and timings only, never content. */
export interface CallRecord {
  model: string;
  pageNo: number;
  attempt: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  outcome: "OK" | AiErrorCode;
}

export type PageResult = { ok: true; data: PageExtraction } | { ok: false; error: AiError };

export interface NvidiaOptions {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  variant: "primary" | "fallback";
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  statusUrl?: (requestId: string) => string;
}

const SCHEMA_NAME: Record<DocType, string> = {
  INVOICE: "commercial_invoice_page",
  PACKING_LIST: "packing_list_page",
  BILL_OF_LADING: "bill_of_lading_page",
};
const BACKOFF_MS = [2000, 4000, 8000];
const MAX_ATTEMPTS = 3;
const POLL_MS = 2000;
// NVCF answers a long-running request with 202 + NVCF-REQID and serves the result from its status endpoint.
const NVCF_STATUS = (requestId: string) => `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/${encodeURIComponent(requestId)}`;

const fail = (code: AiErrorCode, message: string, retryable = true): PageResult => ({ ok: false, error: { code, retryable, message } });

/** Seconds or an HTTP date → milliseconds to wait, capped at 30 s. */
function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 30000) : null;
}

/** Content → JSON: drop a <think> block and a ```json fence, then parse. */
function parseContent(content: string): unknown {
  const body = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return nullEmptyBoxes(JSON.parse(body));
}

/**
 * Some models describe a missing box as {"x": null, "y": null, ...} instead of null. That shape means "no box"; any
 * other malformed box still fails the schema.
 */
export function nullEmptyBoxes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullEmptyBoxes);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      const empty = k === "bbox" && v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((c) => c === null);
      return [k, empty ? null : nullEmptyBoxes(v)];
    }),
  );
}

type Message = { role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> };

export class NvidiaVisionProvider {
  readonly mode = "LIVE" as const;
  readonly modelId: string;
  /** Every call made by the last extractPage, for documents.ai_usage. */
  calls: CallRecord[] = [];

  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly statusUrl: (requestId: string) => string;

  constructor(private readonly opts: NvidiaOptions) {
    this.modelId = opts.model;
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? (() => Date.now());
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.statusUrl = opts.statusUrl ?? NVCF_STATUS;
  }

  private body(input: PageInput, messages: Message[], maxTokens: number): Record<string, unknown> {
    // Both models document one thinking switch: the chat-template flag. Reading printed text needs no reasoning.
    const common = { model: this.opts.model, messages, temperature: 0, seed: 7, max_tokens: maxTokens, stream: false, chat_template_kwargs: { enable_thinking: false } };
    if (this.opts.variant === "fallback") return common; // the schema travels in the prompt instead of response_format
    return {
      ...common,
      response_format: { type: "json_schema", json_schema: { name: SCHEMA_NAME[input.slot], schema: toModelJsonSchema(PAGE_SCHEMAS[input.slot]) } },
    };
  }

  private pageMessages(input: PageInput): Message[] {
    const fallback = this.opts.variant === "fallback";
    const text = userPrompt(input.slot, input.pageNo, input.pageCount, fallback ? toModelJsonSchema(PAGE_SCHEMAS[input.slot]) : undefined);
    return [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${input.jpegBase64}` } }] },
    ];
  }

  /** One logical request: retries 429 / 5xx / network errors, polls a 202, enforces the per-call timeout. */
  private async request(pageNo: number, body: Record<string, unknown>): Promise<{ ok: true; completion: Completion } | { ok: false; result: PageResult }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = this.now();
      const record = (outcome: CallRecord["outcome"], c?: Completion) =>
        this.calls.push({ model: this.opts.model, pageNo, attempt, latencyMs: this.now() - started, promptTokens: c?.usage?.prompt_tokens, completionTokens: c?.usage?.completion_tokens, outcome });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        let response = await this.fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.opts.apiKey ?? ""}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const requestId = response.headers.get("nvcf-reqid");
        while (response.status === 202 && requestId) {
          await this.sleep(POLL_MS);
          response = await this.fetch(this.statusUrl(requestId), {
            headers: { Authorization: `Bearer ${this.opts.apiKey ?? ""}`, Accept: "application/json" },
            signal: controller.signal,
          });
        }
        if (response.ok) {
          const parsed = ChatCompletion.safeParse(await response.json());
          if (!parsed.success) {
            record("AI_INVALID_OUTPUT");
            return { ok: false, result: fail("AI_INVALID_OUTPUT", "Unexpected response envelope") };
          }
          record("OK", parsed.data);
          return { ok: true, completion: parsed.data };
        }
        const limited = response.status === 429;
        if (!limited && response.status < 500) {
          record("AI_UNAVAILABLE");
          return { ok: false, result: fail("AI_UNAVAILABLE", `Model API refused the request (HTTP ${response.status})`, false) };
        }
        record(limited ? "AI_RATE_LIMITED" : "AI_UNAVAILABLE");
        if (attempt === MAX_ATTEMPTS) {
          return { ok: false, result: limited ? fail("AI_RATE_LIMITED", "Model API rate limit reached") : fail("AI_UNAVAILABLE", `Model API unavailable (HTTP ${response.status})`) };
        }
        await this.sleep(retryAfterMs(response.headers.get("retry-after"), this.now()) ?? BACKOFF_MS[attempt - 1] ?? 8000);
      } catch (e) {
        if (controller.signal.aborted) {
          record("AI_TIMEOUT");
          return { ok: false, result: fail("AI_TIMEOUT", `Model call exceeded ${Math.round(this.timeoutMs / 1000)} s`) };
        }
        record("AI_UNAVAILABLE");
        if (attempt === MAX_ATTEMPTS) return { ok: false, result: fail("AI_UNAVAILABLE", `Model API unreachable (${e instanceof Error ? e.name : "error"})`) };
        await this.sleep(BACKOFF_MS[attempt - 1] ?? 8000);
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, result: fail("AI_UNAVAILABLE", "Model API unavailable") };
  }

  /** ARCHITECTURE §8.3: request → (length → one retry with doubled max_tokens) → validate → (one repair) → result. */
  async extractPage(input: PageInput): Promise<PageResult> {
    this.calls = [];
    if (!this.opts.apiKey) return fail("AI_NOT_CONFIGURED", "NVIDIA_API_KEY is not set", false);
    const messages = this.pageMessages(input);

    // 4096 to start; a truncated reply ("length") gets one retry at 8192, the fallback endpoint's cap.
    let maxTokens = 4096;
    let reply = await this.request(input.pageNo, this.body(input, messages, maxTokens));
    if (reply.ok && reply.completion.choices[0]?.finish_reason === "length") {
      maxTokens *= 2;
      reply = await this.request(input.pageNo, this.body(input, messages, maxTokens));
    }
    if (!reply.ok) return reply.result;

    const content = reply.completion.choices[0]?.message.content ?? "";
    const first = this.validate(input.slot, content);
    if (first.ok) return first;

    // One repair attempt: text only, same model, listing what was wrong.
    const repairMessages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: repairPrompt(first.issues, content) },
    ];
    const repaired = await this.request(input.pageNo, this.body(input, repairMessages, maxTokens));
    if (!repaired.ok) return repaired.result;
    const second = this.validate(input.slot, repaired.completion.choices[0]?.message.content ?? "");
    return second.ok ? second : fail("AI_INVALID_OUTPUT", "Model output did not match the schema after one repair");
  }

  private validate(slot: DocType, content: string): { ok: true; data: PageExtraction } | { ok: false; issues: Array<{ path: string; message: string }> } {
    let json: unknown;
    try {
      json = parseContent(content);
    } catch {
      return { ok: false, issues: [{ path: "(root)", message: "Not valid JSON" }] };
    }
    const parsed = PAGE_SCHEMAS[slot].safeParse(json);
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })) };
  }
}

type Completion = z.infer<typeof ChatCompletion>;

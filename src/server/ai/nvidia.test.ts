import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { NvidiaVisionProvider, type PageInput } from "./nvidia";

// A valid invoice page, taken from the SHP-24811 hand-authored fixture.
const manifest = JSON.parse(await readFile("fixtures/samples/manifest.json", "utf8"));
const sha = manifest.samples[0].documents.find((d: { docType: string }) => d.docType === "INVOICE").sha256;
const PAGE = JSON.parse(await readFile(`fixtures/extractions/${sha}.json`, "utf8")).pages[0].output;

const INPUT: PageInput = { slot: "INVOICE", pageNo: 1, pageCount: 1, jpegBase64: "AAAA" };

const completion = (content: string, finish = "stop") =>
  Response.json({ model: "m", choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } });

type Step = Response | "hang";

function harness(steps: Step[], variant: "primary" | "fallback" = "primary", key: string | null = "nvapi-test") {
  const apiKey = key ?? undefined;
  const requests: Array<{ url: string; body: Record<string, unknown> | null; headers: Record<string, string> }> = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> });
    const step = steps.shift();
    if (step === "hang") {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    if (!step) throw new Error("unexpected extra request");
    clock += 250;
    return step;
  }) as typeof fetch;
  const provider = new NvidiaVisionProvider({
    baseUrl: "https://integrate.example/v1", apiKey, model: variant === "primary" ? "primary-model" : "fallback-model", variant,
    fetch: fetchImpl, sleep: async (ms) => void sleeps.push(ms), now: () => clock, timeoutMs: 20,
    statusUrl: (id) => `https://nvcf.example/status/${id}`,
  });
  return { provider, requests, sleeps };
}

const userText = (body: Record<string, unknown> | null | undefined) => {
  const messages = body?.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === "user")?.content;
  return typeof user === "string" ? user : (user as Array<{ type: string; text?: string }>).filter((p) => p.type === "text").map((p) => p.text).join("");
};

describe("NvidiaVisionProvider (ARCHITECTURE §8.3)", () => {
  it("200 OK → validated page, primary request shape, call recorded", async () => {
    const h = harness([completion(JSON.stringify(PAGE))]);
    expect(await h.provider.extractPage(INPUT)).toEqual({ ok: true, data: PAGE });
    const req = h.requests[0];
    expect(req?.url).toBe("https://integrate.example/v1/chat/completions");
    expect(req?.headers.Authorization).toBe("Bearer nvapi-test");
    expect(req?.body).toMatchObject({ model: "primary-model", reasoning_effort: "none", temperature: 0, seed: 7, max_tokens: 4096, stream: false, response_format: { type: "json_schema", json_schema: { name: "commercial_invoice_page" } } });
    expect(JSON.stringify(req?.body)).toContain("data:image/jpeg;base64,AAAA");
    expect(h.provider.calls).toEqual([{ model: "primary-model", pageNo: 1, attempt: 1, latencyMs: 250, promptTokens: 1200, completionTokens: 300, outcome: "OK" }]);
  });

  it("429 → honours Retry-After → retries → OK", async () => {
    const h = harness([new Response("slow down", { status: 429, headers: { "retry-after": "3" } }), completion(JSON.stringify(PAGE))]);
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
    expect(h.sleeps).toEqual([3000]);
    expect(h.provider.calls.map((c) => c.outcome)).toEqual(["AI_RATE_LIMITED", "OK"]);
  });

  it("429 three times → AI_RATE_LIMITED after 2 s and 4 s backoff", async () => {
    const h = harness([429, 429, 429].map((status) => new Response("", { status })));
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_RATE_LIMITED", retryable: true } });
    expect(h.sleeps).toEqual([2000, 4000]);
  });

  it("5xx three times → AI_UNAVAILABLE", async () => {
    const h = harness([502, 503, 500].map((status) => new Response("", { status })));
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_UNAVAILABLE", retryable: true } });
  });

  it("a 4xx other than 429 is not retried", async () => {
    const h = harness([new Response("bad request", { status: 400 })]);
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_UNAVAILABLE", retryable: false } });
    expect(h.requests).toHaveLength(1);
  });

  it("202 → polls the NVCF status endpoint → 200", async () => {
    const h = harness([
      new Response(null, { status: 202, headers: { "nvcf-reqid": "req-123" } }),
      new Response(null, { status: 202, headers: { "nvcf-reqid": "req-123" } }),
      completion(JSON.stringify(PAGE)),
    ]);
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
    expect(h.requests.slice(1).map((r) => r.url)).toEqual(["https://nvcf.example/status/req-123", "https://nvcf.example/status/req-123"]);
    expect(h.sleeps).toEqual([2000, 2000]);
  });

  it("invalid JSON → one text-only repair → OK", async () => {
    const h = harness([completion("Here is the data: {oops"), completion(JSON.stringify(PAGE))]);
    expect(await h.provider.extractPage(INPUT)).toEqual({ ok: true, data: PAGE });
    const repair = h.requests[1]?.body;
    expect(userText(repair)).toContain("did not match the schema");
    expect(userText(repair)).toContain("(root): Not valid JSON");
    expect(JSON.stringify(repair)).not.toContain("image_url");
  });

  it("schema problems are listed in the repair prompt", async () => {
    const broken = { ...PAGE, fields: { ...PAGE.fields, invoiceTotal: { text: 16320, confidence: 2, bbox: null } } };
    const h = harness([completion(JSON.stringify(broken)), completion(JSON.stringify(PAGE))]);
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
    expect(userText(h.requests[1]?.body)).toMatch(/- fields\.invoiceTotal\.text: /);
  });

  it("repair that still fails → AI_INVALID_OUTPUT", async () => {
    const h = harness([completion("{}"), completion("not json either")]);
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_INVALID_OUTPUT" } });
  });

  it("strips a ```json fence and a <think> block", async () => {
    const h = harness([completion(`<think>reasoning</think>\n\`\`\`json\n${JSON.stringify(PAGE)}\n\`\`\``)]);
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
  });

  it("finish_reason length → one retry with doubled max_tokens", async () => {
    const h = harness([completion('{"detectedDocumentType":', "length"), completion(JSON.stringify(PAGE))]);
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
    expect(h.requests.map((r) => r.body?.max_tokens)).toEqual([4096, 8192]);
  });

  it("a call that outlives the timeout is aborted → AI_TIMEOUT", async () => {
    const h = harness(["hang"]);
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_TIMEOUT" } });
    expect(h.provider.calls.map((c) => c.outcome)).toEqual(["AI_TIMEOUT"]);
  });

  it("fallback request: /no_think, schema in the prompt, no response_format or reasoning_effort", async () => {
    const h = harness([completion(JSON.stringify(PAGE))], "fallback");
    expect((await h.provider.extractPage(INPUT)).ok).toBe(true);
    const body = h.requests[0]?.body ?? {};
    const system = (body.messages as Array<{ role: string; content: string }>)[0];
    expect(system?.content.startsWith("/no_think\n")).toBe(true);
    expect(userText(body)).toContain("Return only one JSON object, no prose, matching this JSON Schema:");
    expect(userText(body)).toContain('"additionalProperties":false');
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).toMatchObject({ model: "fallback-model", max_tokens: 4096, stream: false });
  });

  it("without a key → AI_NOT_CONFIGURED and no request", async () => {
    const h = harness([], "primary", null);
    expect(await h.provider.extractPage(INPUT)).toMatchObject({ ok: false, error: { code: "AI_NOT_CONFIGURED", retryable: false } });
    expect(h.requests).toHaveLength(0);
  });
});

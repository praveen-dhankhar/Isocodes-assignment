import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AiErrorCode } from "./nvidia";
import { extractWithChain, selectProviders, type ExtractionProvider, type PageInput } from "./provider";
import { hasFixture, RecordedSampleProvider } from "./sample";

const manifest = JSON.parse(await readFile("fixtures/samples/manifest.json", "utf8")) as {
  samples: Array<{ ref: string; documents: Array<{ docType: string; sha256: string }> }>;
};
const shaOf = (ref: string, docType: string) => manifest.samples.find((s) => s.ref === ref)?.documents.find((d) => d.docType === docType)?.sha256 ?? "";
const INVOICE_24811 = shaOf("SHP-24811", "INVOICE");
const PL_24818 = shaOf("SHP-24818", "PACKING_LIST");
const UNKNOWN = "0".repeat(64);

const env = (mode: "auto" | "live" | "sample", key: boolean) => ({
  EXTRACTION_MODE: mode,
  NVIDIA_API_KEY: key ? "nvapi-test" : undefined,
  NVIDIA_BASE_URL: "https://integrate.example/v1",
  NVIDIA_VLM_MODEL: "primary-model",
  NVIDIA_VLM_FALLBACK_MODEL: "fallback-model",
});
const describeChain = (chain: ExtractionProvider[]) => chain.map((p) => (p.mode === "SAMPLE" ? "sample" : p.modelId));

describe("selectProviders (ARCHITECTURE §8.2)", () => {
  it.each<["auto" | "live" | "sample", boolean, boolean, string[]]>([
    // mode, key present, known sample, chain
    ["auto", true, true, ["primary-model", "fallback-model", "sample"]],
    ["auto", true, false, ["primary-model", "fallback-model"]],
    ["auto", false, true, ["sample"]],
    ["auto", false, false, []],
    ["live", true, true, ["primary-model", "fallback-model"]],
    ["live", false, true, []],
    ["sample", true, true, ["sample"]],
    ["sample", true, false, []],
  ])("%s, key %s, known sample %s → %j", (mode, key, known, chain) => {
    expect(describeChain(selectProviders(env(mode, key), known ? INVOICE_24811 : UNKNOWN))).toEqual(chain);
  });

  it("knows which files have fixtures", () => {
    expect([hasFixture(INVOICE_24811), hasFixture(UNKNOWN), hasFixture("../../etc/passwd")]).toEqual([true, false, false]);
  });
});

const INPUT: PageInput = { slot: "INVOICE", pageNo: 1, pageCount: 1, jpegBase64: "" };
const fake = (modelId: string, mode: "LIVE" | "SAMPLE", outcome: "ok" | AiErrorCode, retryable = true): ExtractionProvider & { tried: number } => ({
  mode, modelId, tried: 0,
  async extractPage() {
    this.tried++;
    return outcome === "ok"
      ? { ok: true, data: { detectedDocumentType: "COMMERCIAL_INVOICE", pageReadable: true, pageIssues: [], fields: {}, lineItems: [] } as never }
      : { ok: false, error: { code: outcome, retryable, message: outcome } };
  },
});

describe("extractWithChain (live failure)", () => {
  it.each<[string, () => ExtractionProvider[], string | null, string]>([
    ["primary answers", () => [fake("p", "LIVE", "ok"), fake("f", "LIVE", "ok"), fake("s", "SAMPLE", "ok")], "p", ""],
    ["primary rate-limited → fallback", () => [fake("p", "LIVE", "AI_RATE_LIMITED"), fake("f", "LIVE", "ok")], "f", "p"],
    ["primary invalid output → fallback", () => [fake("p", "LIVE", "AI_INVALID_OUTPUT", false), fake("f", "LIVE", "ok")], "f", "p"],
    ["primary refused (not retryable) → skip fallback → sample", () => [fake("p", "LIVE", "AI_UNAVAILABLE", false), fake("f", "LIVE", "ok"), fake("s", "SAMPLE", "ok")], "s", "p"],
    ["both live fail → sample", () => [fake("p", "LIVE", "AI_TIMEOUT"), fake("f", "LIVE", "AI_UNAVAILABLE"), fake("s", "SAMPLE", "ok")], "s", "p,f"],
    ["live mode, both fail → last error", () => [fake("p", "LIVE", "AI_TIMEOUT"), fake("f", "LIVE", "AI_RATE_LIMITED")], null, "p,f"],
    ["nothing available → AI_NOT_CONFIGURED", () => [], null, ""],
  ])("%s", async (_, build, answeredBy, failed) => {
    const chain = await extractWithChain(build(), INPUT);
    expect(chain.provider?.modelId ?? null).toBe(answeredBy);
    expect(chain.failed.map((f) => f.modelId).join(",")).toBe(failed);
    if (!answeredBy) expect(chain.result.ok).toBe(false);
  });

  it("reports AI_NOT_CONFIGURED when nothing can serve the file", async () => {
    expect((await extractWithChain([], INPUT)).result).toMatchObject({ ok: false, error: { code: "AI_NOT_CONFIGURED" } });
  });
});

describe("RecordedSampleProvider (API_SPECS §7.4)", () => {
  it("serves the fixture's page output, labelled with its source", async () => {
    const provider = new RecordedSampleProvider(INVOICE_24811);
    const result = await provider.extractPage(INPUT);
    expect(result.ok && "invoiceNumber" in result.data.fields && result.data.fields.invoiceNumber.text).toBe("CB-2026-1187");
    expect(provider.mode).toBe("SAMPLE");
    expect(["recorded", "hand-authored"]).toContain(provider.source); // labelled with where it came from
    expect(provider.modelId).toMatch(/^(hand-authored|nvidia\/)/);
  });

  it("serves an unreadable page as unreadable", async () => {
    const result = await new RecordedSampleProvider(PL_24818).extractPage({ slot: "PACKING_LIST", pageNo: 2, pageCount: 2, jpegBase64: "" });
    expect(result.ok && result.data.pageReadable).toBe(false);
    expect(result.ok && result.data.pageIssues.length).toBeGreaterThan(0); // the model names the problem (BLURRY, BLANK…)
  });

  it("has nothing for a page the file does not have", async () => {
    expect(await new RecordedSampleProvider(INVOICE_24811).extractPage({ ...INPUT, pageNo: 3 })).toMatchObject({ ok: false, error: { code: "AI_INVALID_OUTPUT" } });
  });
});

import { HEADER_FIELDS, LINE_FIELDS, type FieldDef } from "@/domain/fields";
import { normalizeField } from "@/domain/normalize/field";
import { detectDecimalSeparator } from "@/domain/normalize/number";
import { RecordedSampleProvider } from "@/server/ai/sample";
import type { PageExtraction } from "@/server/ai/schemas";
import { SAMPLES } from "./sample-data";
import { liveModel, parseArgs, readSample, sampleFiles, type PageRun, type SampleFile } from "./model-run";

// `pnpm eval:extraction --model primary|fallback|recorded [--ref SHP-24811]` (PLAN M6.2, ARCHITECTURE §8.4): per-field
// accuracy against the manifest truth (values compared after the same normalisation the app applies), JSON-validity
// rate and p50/p95 page latency. Fields printed on a deliberately unreadable page are left out of accuracy.
// `recorded` scores the stored fixtures without a network call (hand-authored ones should score 100%).

type AiValue = { text: string | null; confidence: number };
const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;
const tally = new Map<string, { right: number; total: number }>();
const count = (key: string, right: boolean) => {
  const t = tally.get(key) ?? { right: 0, total: 0 };
  tally.set(key, { right: t.right + (right ? 1 : 0), total: t.total + 1 });
};

function score(file: SampleFile, runs: PageRun[]) {
  const outputs = runs.flatMap((r) => (r.result.ok ? [r.result.data] : []));
  const fieldsOf = (o: PageExtraction) => o.fields as Record<string, AiValue>;
  const linesOf = (o: PageExtraction) => ("lineItems" in o ? (o.lineItems as Array<Record<string, AiValue>>) : []);
  const printed = outputs.flatMap((o) => [...Object.values(fieldsOf(o)), ...linesOf(o).flatMap((l) => Object.values(l))].map((v) => v.text));
  const separator = detectDecimalSeparator(printed.filter((t): t is string => t !== null));
  const sample = SAMPLES.find((s) => s.ref === file.ref);
  const read = (def: FieldDef | undefined, ai: AiValue | undefined) =>
    ai?.text == null ? null : normalizeField(def?.kind ?? "TEXT", ai.text, { separator, supplierCountry: sample?.supplier.country ?? null }).value;

  const skipped = new Set<string>(file.variant === "scan-unreadable-page" ? (sample?.documents.find((d) => d.docType === file.docType)?.page2 ?? []) : []);
  for (const key of Object.keys(HEADER).filter((k) => HEADER[k]?.on[file.docType] && !skipped.has(k))) {
    const best = outputs.map((o) => fieldsOf(o)[key]).filter((v) => v?.text != null).sort((a, b) => (b?.confidence ?? 0) - (a?.confidence ?? 0))[0];
    count(`${file.docType}.${key}`, read(HEADER[key], best) === (file.truth.header[key] ?? null));
  }
  const lines = outputs.flatMap(linesOf);
  for (let i = 0; i < Math.max(lines.length, file.truth.lines.length); i++) {
    for (const key of Object.keys(LINE).filter((k) => LINE[k]?.on[file.docType])) {
      count(`${file.docType}.line.${key}`, read(LINE[key], lines[i]?.[key]) === (file.truth.lines[i]?.[key] ?? null));
    }
  }
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);

async function main() {
  const { variant, refs } = parseArgs(process.argv.slice(2), ["primary", "fallback", "recorded"]);
  const live = variant === "recorded" ? null : liveModel(variant);
  let modelId = live?.modelId ?? "stored fixtures";
  const latencies: number[] = [];
  let pages = 0;
  let pagesOk = 0;
  let validCalls = 0;
  let parsedCalls = 0;

  for (const file of await sampleFiles(refs)) {
    const stored = new RecordedSampleProvider(file.sha256);
    const runs = await readSample(live ?? stored, file);
    if (!live) modelId = `stored fixtures (${stored.source})`;
    for (const r of runs) {
      pages++;
      if (r.result.ok) pagesOk++;
      latencies.push(r.calls.reduce((sum, c) => sum + c.latencyMs, 0));
      // JSON validity: of the calls that returned a body, how many parsed and matched the schema first time.
      const answered = r.calls.filter((c) => c.outcome === "OK" || c.outcome === "AI_INVALID_OUTPUT");
      parsedCalls += answered.length;
      validCalls += answered.filter((c) => c.outcome === "OK").length;
    }
    score(file, runs);
    console.log(`read ${file.ref} ${file.docType}: ${runs.map((r) => (r.result.ok ? "ok" : r.result.error.code)).join(", ")}`);
  }

  const right = [...tally.values()].reduce((s, t) => s + t.right, 0);
  const total = [...tally.values()].reduce((s, t) => s + t.total, 0);
  latencies.sort((a, b) => a - b);
  console.log(`\nModel ${modelId} (${variant}) · ${pages} pages`);
  console.log(`Field accuracy ${pct(right, total)} (${right}/${total}) · pages read ${pct(pagesOk, pages)} · JSON valid ${pct(validCalls, parsedCalls)}`);
  console.log(`Latency per page p50 ${(percentile(latencies, 50) / 1000).toFixed(1)} s · p95 ${(percentile(latencies, 95) / 1000).toFixed(1)} s\n`);
  console.log("| Field | Accuracy | n |\n|---|---|---|");
  for (const [key, t] of [...tally.entries()].sort(([a], [b]) => a.localeCompare(b))) console.log(`| ${key} | ${pct(t.right, t.total)} | ${t.total} |`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

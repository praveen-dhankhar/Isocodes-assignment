import { writeFile } from "node:fs/promises";
import path from "node:path";
import { liveModel, parseArgs, readSample, sampleFiles } from "./model-run";

// `pnpm fixtures:record [--model primary|fallback] [--ref SHP-24811]` (PLAN M6.2, ARCHITECTURE §8.4): the live model
// reads every bundled sample and its output replaces the hand-authored fixture with `source: "recorded"`. A file the
// model fails on keeps its previous fixture. Recorded output is kept even where it differs from the truth.

async function main() {
  const { variant, refs } = parseArgs(process.argv.slice(2), ["primary", "fallback"]);
  const model = liveModel(variant);
  let recorded = 0;
  const failed: string[] = [];

  for (const file of await sampleFiles(refs)) {
    const runs = await readSample(model, file);
    const pages = runs.flatMap((r) => (r.result.ok ? [{ pageNo: r.pageNo, output: r.result.data }] : []));
    const error = runs.find((r) => !r.result.ok)?.result;
    if (error && !error.ok) {
      failed.push(`${file.ref} ${file.docType}: ${error.error.code}`);
      continue;
    }
    const fixture = { sha256: file.sha256, source: "recorded", modelId: model.modelId, recordedAt: new Date().toISOString(), pages };
    await writeFile(path.join("fixtures/extractions", `${file.sha256}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    recorded++;
    console.log(`recorded ${file.ref} ${file.docType} (${pages.length} page${pages.length === 1 ? "" : "s"})`);
  }

  console.log(`fixtures:record: ${recorded} recorded with ${model.modelId}; ${failed.length} kept as before`);
  for (const f of failed) console.log(`  failed ${f}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

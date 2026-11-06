import { chromium, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SCENARIOS } from "@/domain/checks/__fixtures__/snapshots";
import { HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { normalizeField } from "@/domain/normalize/field";
import { detectDecimalSeparator } from "@/domain/normalize/number";
import { SAMPLES, type SampleDocument, type SampleShipment, type Variant } from "./sample-data";
import { imagesToHtml, renderDocument } from "./sample-templates";

// `pnpm samples:generate` (PLAN M4.1): sample-data → HTML → PDF (Playwright) or scan variants (sharp) under
// fixtures/samples, a manifest with sha256 + ground truth, and hand-authored extraction fixtures per file.

const SAMPLES_DIR = "fixtures/samples";
const EXTRACTIONS_DIR = "fixtures/extractions";
const FILE: Record<DocType, string> = { INVOICE: "invoice", PACKING_LIST: "packing-list", BILL_OF_LADING: "bill-of-lading" };
const EXT: Record<Variant, string> = { digital: "pdf", bilingual: "pdf", "scan-unreadable-page": "pdf", scan: "png", "scan-skewed": "jpg" };
const DETECTED: Record<DocType, string> = { INVOICE: "COMMERCIAL_INVOICE", PACKING_LIST: "PACKING_LIST", BILL_OF_LADING: "BILL_OF_LADING" };
const MAX_BYTES = 4 * 1024 * 1024; // A-02
// Fixed timestamp for PDF metadata and hand-authored fixtures: regenerating gives identical bytes, so sha256 keys —
// and any recorded fixtures keyed by them — survive a rerun.
const STAMP = { pdf: "D:20261101000000+00'00'", iso: "2026-11-01T00:00:00.000Z" };

/** Chromium writes the current time into /CreationDate and /ModDate; replace it in place (same length keeps xref offsets). */
function stampPdf(pdf: Buffer): Buffer {
  const text = pdf.toString("latin1");
  const fixed = text.replace(/\/(CreationDate|ModDate) \(D:\d{14}[^)]*\)/g, (match, key: string) => {
    const replacement = `/${key} (${STAMP.pdf})`;
    if (replacement.length !== match.length) throw new Error(`unexpected PDF date format: ${match}`);
    return replacement;
  });
  return Buffer.from(fixed, "latin1");
}

const printPdf = async (page: Page) =>
  stampPdf(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;

// ── Ground truth: the printed text read by the domain normalisers ────────────────────────────────────────────────

interface Truth { header: Record<string, string | null>; lines: Array<Record<string, string | null>> }

function truthOf(doc: SampleDocument, country: string): Truth {
  const printed = [...Object.values(doc.header), ...doc.lines.flatMap((l) => Object.values(l))].filter((v): v is string => v !== undefined);
  const sep = detectDecimalSeparator(printed);
  const read = (registry: Record<string, FieldDef>, cells: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v === undefined ? null : normalizeField(registry[k]?.kind ?? "TEXT", v, { separator: sep, supplierCountry: country }).value]));
  return { header: read(HEADER, doc.header), lines: doc.lines.map((l) => read(LINE, l)) };
}

/** SHP-24811…24816 also exist as domain fixtures; refuse to write samples that disagree with them. */
function assertMatchesDomainFixture(ship: SampleShipment, truths: Map<DocType, Truth>) {
  const build = (SCENARIOS as Record<string, (() => ReturnType<(typeof SCENARIOS)["SHP-24811"]>) | undefined>)[ship.ref];
  if (!build) return;
  const snap = build();
  const problems: string[] = [];
  for (const [docType, d] of Object.entries(snap.documents)) {
    const truth = truths.get(docType as DocType);
    for (const [key, ref] of Object.entries(d.header)) {
      const actual = truth?.header[key] ?? null;
      if (actual !== ref.value) problems.push(`${docType}.${key}: sample ${actual} vs fixture ${ref.value}`);
    }
    d.lines.forEach((line, i) => {
      for (const [key, ref] of Object.entries(line.cells)) {
        const actual = truth?.lines[i]?.[key] ?? null;
        if (actual !== ref.value) problems.push(`${docType} line ${i + 1}.${key}: sample ${actual} vs fixture ${ref.value}`);
      }
    });
  }
  if (problems.length > 0) throw new Error(`${ship.ref} disagrees with the domain fixture:\n  ${problems.join("\n  ")}`);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Placed { field: string; line: number | null; pageNo: number; box: { x: number; y: number; w: number; h: number } }

async function layout(page: Page, html: string): Promise<{ placed: Placed[]; pageCount: number }> {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // Runs in the browser: no named helpers inside (tsx wraps them in a __name() the page does not have).
  const raw = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll<HTMLElement>(".sheet")];
    const placed = [...document.querySelectorAll<HTMLElement>("[data-field]")].map((el) => {
      const sheet = el.closest<HTMLElement>(".sheet");
      const s = (sheet ?? document.body).getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        field: el.dataset.field ?? "",
        line: el.dataset.line ? Number(el.dataset.line) : null,
        pageNo: sheet ? sheets.indexOf(sheet) + 1 : 1,
        box: { x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height },
      };
    });
    return { placed, pageCount: sheets.length };
  });
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  const placed = raw.placed.map((p) => ({ ...p, box: { x: r4(p.box.x), y: r4(p.box.y), w: r4(p.box.w), h: r4(p.box.h) } }));
  return { placed, pageCount: raw.pageCount };
}

const sheetShots = async (page: Page, count: number) =>
  Promise.all(Array.from({ length: count }, (_, i) => page.locator(".sheet").nth(i).screenshot({ type: "png" })));

/** Deterministic speckle noise (mulberry32) so regenerating gives the same bytes. */
function speckle(width: number, height: number, seed: number): Buffer {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const v = rand() < 0.05 ? 150 + Math.floor(rand() * 80) : 255 - Math.floor(rand() * 14);
    buf[i * 3] = buf[i * 3 + 1] = buf[i * 3 + 2] = v;
  }
  return buf;
}

async function renderFile(page: Page, doc: SampleDocument, html: string, pageCount: number, seed: number): Promise<Buffer> {
  switch (doc.variant) {
    case "digital":
    case "bilingual":
      return printPdf(page);
    case "scan": {
      const [shot] = await sheetShots(page, 1);
      return sharp(shot).grayscale().png({ compressionLevel: 9, palette: true, colours: 32 }).toBuffer();
    }
    case "scan-skewed": {
      const [shot] = await sheetShots(page, 1);
      const turned = await sharp(shot).rotate(3, { background: "#ffffff" }).grayscale().blur(0.7).toColourspace("srgb").png().toBuffer({ resolveWithObject: true });
      const { width, height } = turned.info;
      return sharp(turned.data)
        .composite([{ input: speckle(width, height, seed), raw: { width, height, channels: 3 }, blend: "multiply" }])
        .jpeg({ quality: 70 })
        .toBuffer();
    }
    case "scan-unreadable-page": {
      const shots = await sheetShots(page, pageCount);
      const pages = await Promise.all(
        shots.map((s, i) => sharp(s).grayscale().blur(i === 1 ? 14 : 0.5).jpeg({ quality: 72 }).toBuffer()), // page 2: unreadable (F7)
      );
      await page.setContent(imagesToHtml(pages), { waitUntil: "load" });
      return printPdf(page);
    }
  }
}

// ── Hand-authored extraction fixtures (API_SPECS §7.4) ──────────────────────────────────────────────────────────

const BASE: Record<Variant, [number, number]> = {
  digital: [0.95, 0.99], bilingual: [0.92, 0.98], scan: [0.9, 0.95], "scan-skewed": [0.86, 0.93], "scan-unreadable-page": [0.88, 0.94],
};

function confidenceFor(ship: SampleShipment, doc: SampleDocument, key: string): number {
  const fixed = doc.confidence?.[key];
  if (fixed !== undefined) return fixed;
  const [lo, hi] = BASE[doc.variant];
  const h = createHash("sha256").update(`${ship.ref}|${doc.docType}|${key}`).digest().readUInt32BE(0) / 0xffffffff;
  return Math.round((lo + (hi - lo) * h) * 100) / 100;
}

function extractionFixture(ship: SampleShipment, doc: SampleDocument, sha256: string, placed: Placed[], pageCount: number) {
  const unreadable = (pageNo: number) => doc.variant === "scan-unreadable-page" && pageNo === 2;
  const where = (field: string, line: number | null) => placed.find((p) => p.field === field && p.line === line);
  const aiValue = (pageNo: number, field: string, line: number | null, text: string | undefined, key: string) => {
    const at = where(field, line);
    if (text === undefined || !at || at.pageNo !== pageNo || unreadable(pageNo)) return { text: null, confidence: 0, bbox: null }; // prompt rule 2
    return { text: doc.misread?.[key] ?? text, confidence: confidenceFor(ship, doc, key), bbox: at.box };
  };
  const slotKeys = (registry: Record<string, FieldDef>) => Object.keys(registry).filter((k) => registry[k]?.on[doc.docType]);

  const pages = Array.from({ length: pageCount }, (_, i) => {
    const pageNo = i + 1;
    const fields = Object.fromEntries(slotKeys(HEADER).map((k) => [k, aiValue(pageNo, k, null, doc.header[k as keyof typeof doc.header], k)]));
    const output: Record<string, unknown> = {
      detectedDocumentType: DETECTED[doc.docType],
      pageReadable: !unreadable(pageNo),
      pageIssues: unreadable(pageNo) ? ["BLURRY"] : doc.variant === "scan-skewed" ? ["SKEWED"] : [],
      fields,
    };
    if (doc.docType !== "BILL_OF_LADING") {
      output.lineItems =
        pageNo === 1
          ? doc.lines.map((line, li) =>
              Object.fromEntries(slotKeys(LINE).map((k) => [k, aiValue(pageNo, k, li + 1, line[k as keyof typeof line], `line${li + 1}.${k}`)])),
            )
          : [];
    }
    return { pageNo, output };
  });
  return { sha256, source: "hand-authored", modelId: "hand-authored", recordedAt: STAMP.iso, pages };
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const font = await readFile("scripts/fonts/noto-sans-sc-subset.woff2");
  const fontDataUri = `data:font/woff2;base64,${font.toString("base64")}`;
  const allowedCjk = new Set([...(await readFile("scripts/fonts/noto-sans-sc-subset.chars.txt", "utf8")).trim()]);

  // Truth first: a mismatch with the domain fixtures stops everything before any file is touched.
  const truths = new Map(SAMPLES.map((ship) => [ship.ref, new Map(ship.documents.map((d) => [d.docType, truthOf(d, ship.supplier.country)]))]));
  for (const ship of SAMPLES) assertMatchesDomainFixture(ship, truths.get(ship.ref) ?? new Map());
  for (const ship of SAMPLES) {
    for (const d of ship.documents) {
      const missing = [...JSON.stringify(d)].filter((c) => /\p{Script=Han}/u.test(c) && !allowedCjk.has(c));
      if (missing.length > 0) throw new Error(`${ship.ref} ${d.docType}: add ${[...new Set(missing)].join("")} to the font subset`);
    }
  }

  await rm(SAMPLES_DIR, { recursive: true, force: true });
  for (const f of await readdir(EXTRACTIONS_DIR).catch(() => [] as string[])) {
    const p = path.join(EXTRACTIONS_DIR, f);
    if (f.endsWith(".json") && JSON.parse(await readFile(p, "utf8")).source === "hand-authored") await rm(p);
  }
  await mkdir(EXTRACTIONS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  const manifest = { version: 1, samples: [] as unknown[] };
  let files = 0;
  try {
    for (const [si, ship] of SAMPLES.entries()) {
      await mkdir(path.join(SAMPLES_DIR, ship.ref), { recursive: true });
      const documents = [];
      for (const [di, doc] of ship.documents.entries()) {
        const { placed, pageCount } = await layout(page, renderDocument(ship, doc, fontDataUri));
        const bytes = await renderFile(page, doc, renderDocument(ship, doc, fontDataUri), pageCount, 1000 * si + di);
        if (bytes.length > MAX_BYTES) throw new Error(`${ship.ref} ${doc.docType} is ${bytes.length} bytes, over the 4 MB upload limit`);
        const file = `${ship.ref}/${FILE[doc.docType]}.${EXT[doc.variant]}`;
        await writeFile(path.join(SAMPLES_DIR, file), bytes);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const fixture = extractionFixture(ship, doc, sha256, placed, pageCount);
        await writeFile(path.join(EXTRACTIONS_DIR, `${sha256}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
        documents.push({ docType: doc.docType, file, sha256, variant: doc.variant, truth: truths.get(ship.ref)?.get(doc.docType) });
        files++;
        console.log(`${file.padEnd(36)} ${String(pageCount).padStart(1)} page(s) ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${doc.variant}`);
      }
      manifest.samples.push({ ref: ship.ref, title: ship.title, documents });
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(SAMPLES_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`samples:generate: ${files} files + manifest.json; ${files} hand-authored extraction fixtures`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

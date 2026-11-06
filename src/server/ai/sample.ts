import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DocType } from "@/domain/fields";
import type { PageInput, PageResult } from "./nvidia";
import { PAGE_SCHEMAS } from "./schemas";

// API_SPECS §7.4: fixtures/extractions/<sha256>.json — recorded model output, or hand-authored from sample truth.
const FIXTURE_DIR = path.join(process.cwd(), "fixtures/extractions");

const Fixture = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.enum(["recorded", "hand-authored"]),
  modelId: z.string(),
  recordedAt: z.string(),
  pages: z.array(z.object({ pageNo: z.number().int().positive(), output: z.unknown() })),
});

const fixturePath = (sha256: string) => path.join(FIXTURE_DIR, `${sha256}.json`);

export const hasFixture = (sha256: string) => /^[0-9a-f]{64}$/.test(sha256) && existsSync(fixturePath(sha256));

/**
 * Replays a bundled file's stored per-page output (ARCHITECTURE §8.2). Only files whose sha256 has a fixture can be
 * served — an unknown file never gets invented values (contributor guide, rule 7). Documents it fills are labelled SAMPLE.
 */
export class RecordedSampleProvider {
  readonly mode = "SAMPLE" as const;
  modelId = "sample";
  source: "recorded" | "hand-authored" = "hand-authored";
  recordedAt = "";
  private fixture: Promise<z.infer<typeof Fixture>> | undefined;

  constructor(private readonly sha256: string) {}

  private load() {
    this.fixture ??= readFile(fixturePath(this.sha256), "utf8").then((text) => {
      const fixture = Fixture.parse(JSON.parse(text));
      this.modelId = fixture.modelId;
      this.source = fixture.source;
      this.recordedAt = fixture.recordedAt;
      return fixture;
    });
    return this.fixture;
  }

  async extractPage(input: PageInput): Promise<PageResult> {
    const invalid = (message: string): PageResult => ({ ok: false, error: { code: "AI_INVALID_OUTPUT", retryable: false, message } });
    let fixture: z.infer<typeof Fixture>;
    try {
      fixture = await this.load();
    } catch {
      return invalid("Recorded sample could not be read");
    }
    const page = fixture.pages.find((p) => p.pageNo === input.pageNo);
    if (!page) return invalid(`Recorded sample has no page ${input.pageNo}`);
    const parsed = PAGE_SCHEMAS[input.slot as DocType].safeParse(page.output);
    return parsed.success ? { ok: true, data: parsed.data } : invalid("Recorded sample does not match the page schema");
  }
}

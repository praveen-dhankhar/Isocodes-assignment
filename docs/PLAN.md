# PLAN — Build order

> Version 1.0 · 2026-11-05. Ten milestones, built in order. Each milestone is split into **steps**; a step touches **at most 5 source files** (colocated `*.test.ts` files and generated files — shadcn components, Drizzle migrations, lockfile, `fixtures/**` outputs — don't count). One step = one commit.

## How to work through this plan

1. Do **one step at a time**, in order. Read the doc sections the step links before writing code.
2. A step is done only when its **Verify** command passes and `pnpm typecheck && pnpm lint` are clean.
3. Commit with Conventional Commits and the step id: `feat(domain): CC-03 gross weight check [M2.4]`. Keep history granular — reviewers read it.
4. If a step reveals a doc is wrong, fix the doc in the same commit (`docs: … [M5.2]`).
5. Never mark a step done with skipped or `.only` tests.

## Timeline (7 days)

| Day | Milestones |
|---|---|
| 1 | M1 · M2.1–M2.3 |
| 2 | M2.4–M2.6 · M3 |
| 3 | M4 · M5.1–M5.2 |
| 4 | M5.3–M5.5 · M6 |
| 5 | M7 · M8.1 |
| 6 | M8.2–M8.4 · M9 |
| 7 | M10 · buffer |

**If behind, cut in this order** (and say so in the TDD): calibration table (M10.1) → audit history page (M10.2) → fallback model (keep primary + samples) → fine-rotate in the viewer → line add/remove for manual entry.
**Never cut:** the domain engine and its tests (M2), the export gate and its tests (M9), sample data, failure/empty/loading states, deployment.

---

## M1 — Scaffold, tooling, deploy skeleton

**Goal:** an empty but strict app that builds, tests, lints and deploys to Mumbai on day 1.

| Step | Files | Notes |
|---|---|---|
| 1.1 | `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.env.example` | `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*"`, then: exact version pins; `engines.node >=22`; scripts from `CLAUDE.md`; TS `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`; ESLint: `@typescript-eslint/no-explicit-any: error`, `no-restricted-imports` for layering (ARCHITECTURE §3), `max-lines: 250` on `src/components/**` and `src/app/**/*.tsx`; Vitest projects `unit` (`src/**/*.test.ts`) and `integration` (`src/**/*.int.test.ts`), alias `server-only` → empty stub. |
| 1.2 | `src/lib/env.ts`, `src/lib/errors.ts`, `src/lib/result.ts`, `docker-compose.yml` | Env schema = API_SPECS §8; error codes = API_SPECS §1.2; compose: `postgres:16` with `customs` and `customs_test` DBs. |
| 1.3 | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/num.tsx`, `src/components/ui/mono.tsx`, `src/components/ui/state-badge.tsx` | `pnpm dlx shadcn@latest init`. Tokens: zinc neutrals; `--state-low` (amber), `--state-mismatch` (crimson), `--state-ok` (emerald). Geist Sans/Mono. `StateBadge` always renders icon + text. |
| 1.4 | `vercel.json`, `.github/workflows/ci.yml`, `README.md` | `{"regions":["bom1"]}`. CI: install, typecheck, lint, unit tests, integration tests (postgres service), gitleaks. Create Supabase project in **South Asia (Mumbai) ap-south-1**; link the GitHub repo to Vercel. |

**Verify:** `pnpm typecheck && pnpm lint && pnpm test --passWithNoTests && pnpm build` · CI green · Vercel preview URL renders the empty shell.

---

## M2 — Domain core (no UI, no DB)

**Goal:** every rule that decides whether data is right exists as pure, tested code before any screen. Read PRD §6–§10 and ARCHITECTURE §5–§6.

| Step | Files | Notes |
|---|---|---|
| 2.1 | `src/domain/money.ts`, `src/domain/normalize/number.ts`, `src/domain/normalize/weight.ts` | `detectDecimalSeparator(texts)`, `parseDecimal(text, sep)`, `parseWeightKg(text, sep)`. |
| 2.2 | `src/domain/normalize/date.ts`, `currency.ts`, `incoterm.ts`, `codes.ts`, `text.ts` | `codes.ts`: HS code + ISO 6346 (`iso6346Valid`, `parseContainerList`). |
| 2.3 | `src/domain/fields.ts`, `src/domain/snapshot.ts`, `src/domain/checks/config.ts`, `src/domain/checks/types.ts`, `src/domain/checks/__fixtures__/snapshots.ts` | Field registry = PRD §6 exactly. Snapshot builders for SHP-24811…SHP-24816 scenarios (API_SPECS §7.2). |
| 2.4 | `src/domain/checks/rules/amounts.ts`, `src/domain/checks/rules/quantities.ts`, `src/domain/checks/fingerprint.ts`, `src/domain/checks/run-checks.ts` | CC-01 … CC-05; `compareAcrossDocs` helper; `ENGINE_VERSION`. |
| 2.5 | `src/domain/checks/rules/items.ts`, `src/domain/checks/rules/references.ts` | CC-06 matcher, CC-07, CC-08. |
| 2.6 | `src/domain/confidence.ts`, `src/domain/evidence.ts`, `src/domain/issues.ts`, `src/domain/status.ts` | PRD §8, §10; `canExport`. |

**Must-pass normaliser cases (2.1–2.2):**

| Input | Context | Expected |
|---|---|---|
| `3,120.00 KGS` | dot-decimal doc | `3120.000` kg |
| `1.460,00 kg` | comma-decimal doc | `1460.000` kg |
| `2,204.62 LBS` | dot-decimal doc | `1000.000` kg (±0.001) |
| `7.650,00` | comma-decimal doc | `7650.00` |
| `1,460` | comma-decimal doc | ambiguous → flag |
| `3165` | no unit | `3165.000` kg + `unitAssumed` |
| `14/10/2026` | CN supplier | `2026-10-14` |
| `03/04/2026` | US supplier | `2026-03-04` + `ambiguousDate` |
| `US$` · `€` · `RMB` | — | `USD` · `EUR` · `CNY` |
| `C&F` | — | `CFR` |
| `9405.42.90` | — | `94054290` (valid) |
| `XZQU4821171` / `XZQU4821254` | — | valid / invalid check digit |

**Acceptance test — write it exactly like this (2.4):**
```ts
describe('SHP-24811 — gross weight mismatch (brief)', () => {
  const snap = shp24811();                          // __fixtures__/snapshots.ts
  const results = runCrossChecks(snap, CHECK_CONFIG);
  const cc03 = results.find((r) => r.ruleId === 'CC-03' && r.scope === 'shipment')!;

  it('fails CC-03 with a 45 kg delta', () => {
    expect(cc03.status).toBe('FAIL');
    expect(cc03.severity).toBe('CRITICAL');
    expect(cc03.delta).toBe('45.000');
    expect(cc03.observed.map((o) => [o.docType, o.value])).toEqual([
      ['INVOICE', '3120.000'], ['PACKING_LIST', '3165.000'], ['BILL_OF_LADING', '3165.000'],
    ]);
  });
  it('passes the invoice maths (2400 × 6.80 = 16,320.00)', () => {
    expect(results.find((r) => r.ruleId === 'CC-01')!.status).toBe('PASS');
    expect(results.find((r) => r.ruleId === 'CC-02')!.status).toBe('PASS');
  });
  it('blocks export', () => {                       // completed in 2.6
    const issues = computeBlockingIssues(snap, results);
    expect(issues.some((i) => i.type === 'CHECK_FAILED')).toBe(true);
    expect(canExport(snap, issues, { approvedAt: null }).ok).toBe(false);
  });
  it('keeps an accepted discrepancy when re-run unchanged, re-opens it when PL weight changes', () => { /* … */ });
});
```
Also: SHP-24812 European decimals → every check `PASS`/`NOT_APPLICABLE`; LBS scenario passes CC-03; CC-06 fails on `line:2` for SHP-24814; CC-07 fails for SHP-24815.

**Verify:** `pnpm test src/domain` · `pnpm test -t "SHP-24811"` · `pnpm test --coverage src/domain` (≥ 95% lines on `src/domain`).

---

## M3 — Database, auth, recompute

**Goal:** schema, sign-in with roles, and the one function that keeps checks/issues/status consistent.

| Step | Files | Notes |
|---|---|---|
| 3.1 | `src/server/db/schema.ts`, `src/server/db/client.ts`, `drizzle.config.ts` | ARCHITECTURE §4.2 verbatim; add `shipment_ref_seq START 24820`. `pnpm db:generate && pnpm db:migrate`. postgres.js with `prepare: false` (Supabase pooler). |
| 3.2 | `src/server/auth.ts`, `src/app/api/auth/[...all]/route.ts`, `src/server/session.ts`, `src/proxy.ts` | Better Auth: email/password, `disableSignUp: true`, `user.additionalFields.role` with `input: false`. `requireUser()`, `requireRole()`. `proxy.ts` redirects to `/login` when no session cookie. Generate Better Auth tables with its CLI, then migrate. |
| 3.3 | `src/app/(auth)/login/page.tsx`, `src/components/auth/login-form.tsx`, `src/app/(app)/layout.tsx` | App shell: nav (Shipments, Accuracy for managers), user menu with role. Login error and loading states. |
| 3.4 | `src/server/services/snapshot.ts`, `src/server/services/recompute.ts`, `src/server/services/audit.ts` | ARCHITECTURE §7.5. Integration test seeds rows directly: SHP-24811 snapshot → status `NEEDS_REVIEW`, `failed_check_count = 1`. |
| 3.5 | `src/server/db/seed.ts`, `scripts/db-reset.ts` | This step seeds **users and masters only** (API_SPECS §7.2). Users are created with Better Auth's own password hasher (verify the API at build time) so sign-in works. `db-reset` refuses any non-localhost URL. |

**Verify:** `pnpm db:reset && pnpm test:int src/server/session src/server/services/recompute` · sign in as `meera@demo.test` locally; an executive gets 403 from a manager-only stub route.

---

## M4 — Sample documents and uploads

**Goal:** realistic sample files exist, and any PDF/scan can be uploaded, stored and rendered to page images — proven on Vercel.

| Step | Files | Notes |
|---|---|---|
| 4.1 | `scripts/sample-data.ts`, `scripts/sample-templates.ts`, `scripts/generate-samples.ts` | API_SPECS §7. HTML templates → PDF via Playwright `page.pdf()`; scan variants: screenshot → `sharp` rotate 2–4°, grayscale, blur, noise, JPEG q70; unreadable page = heavy blur; bilingual uses a bundled Noto Sans SC font. Writes `fixtures/samples/**`, `manifest.json` (with sha256 + truth) and hand-authored `fixtures/extractions/*.json` derived from truth (`source: "hand-authored"`, varied confidences so some fields are amber). |
| 4.2 | `src/server/storage/index.ts`, `src/server/storage/local.ts`, `src/server/storage/supabase.ts` | `BlobStore { put, get, stream, delete }`; keys are server-generated. |
| 4.3 | `src/server/pdf/render.ts`, `src/server/pdf/text-layer.ts`, `src/server/uploads/validate.ts` | Tests use generated samples: page counts, text layer contains `3,120.00`, magic-byte rejection of a `.pdf` that is really a PNG, 6-page PDF → `PAGE_LIMIT_EXCEEDED`. |
| 4.4 | `src/server/services/documents.ts`, `src/app/api/shipments/[id]/documents/route.ts`, `src/app/api/documents/[docId]/pages/[page]/route.ts`, `src/app/api/documents/[docId]/original/route.ts`, `src/server/actions/shipments.ts` | API_SPECS §4.1, §4.4, §4.5, §5.1. Supersede on re-upload (A-23). |

**Verify:** `pnpm samples:generate` (27 files + manifest) · `pnpm test src/server/storage src/server/pdf src/server/uploads` · `pnpm test:int src/server/services/documents` · **on the Vercel preview:** upload `fixtures/samples/SHP-24811/invoice.pdf` and open its page image (proves `@napi-rs/canvas` and `sharp` work in `bom1`).

---

## M5 — AI extraction (live + recorded samples)

**Goal:** a real vision-model call turns a document into normalised, scored fields — and fails safely.

| Step | Files | Notes |
|---|---|---|
| 5.1 | `src/server/ai/schemas.ts`, `src/server/ai/prompts.ts` | API_SPECS §2.2–§2.3 verbatim. Snapshot test of `toModelJsonSchema()` per slot. |
| 5.2 | `src/server/ai/images.ts`, `src/server/ai/nvidia.ts` | Injected `fetch`. Tests: 200 OK · 429 → retry → OK · 429 ×3 → `AI_RATE_LIMITED` · 202 → poll → 200 · invalid JSON → repair → OK · repair fails → `AI_INVALID_OUTPUT` · `finish_reason: length` → retry with more tokens · abort → `AI_TIMEOUT` · fallback request has `/no_think` + schema and no `response_format` · image ≤ 180 KB base64. |
| 5.3 | `src/server/ai/provider.ts`, `src/server/ai/sample.ts` | `selectProviders(env, sha256)` returns the ordered chain (ARCHITECTURE §8.2). Table test over `EXTRACTION_MODE × key present × known sample × live failure`. |
| 5.4 | `src/server/services/extraction.ts`, `src/app/api/shipments/[id]/documents/[docId]/extract/route.ts`, `src/app/api/shipments/[id]/status/route.ts` | ARCHITECTURE §7.2: claim, per-page calls, merge, normalise, evidence, confidence, persist, recompute. Integration test with a fake provider: SHP-24811 → CC-03 `FAIL`; provider error → document `FAILED` + error code; re-extract with human edits → `HUMAN_EDITS_EXIST`; stale `EXTRACTING` (> 5 min) is reclaimable. |
| 5.5 | `src/server/services/manual-entry.ts` | `markPageUnreadable`, empty required fields for manual entry, wrong-type detection flagging. |

**Verify:** `pnpm test src/server/ai` · `pnpm test:int src/server/services/extraction src/server/services/manual-entry` · live smoke with a key in `.env.local`: upload + extract SHP-24811 invoice via the routes → document `EXTRACTED`, `mode = LIVE`, `modelId` set.

---

## M6 — Seed through the real pipeline, record fixtures, evaluate models

**Goal:** the app is never empty, fixtures are genuine model output, and the model choice is backed by numbers.

| Step | Files | Notes |
|---|---|---|
| 6.1 | `src/server/db/seed.ts`, `src/server/db/seed-scenarios.ts` | For each sample shipment: create via services, upload bundled files via `documents` service, extract with `EXTRACTION_MODE=sample`. SHP-24819 gets only its invoice. At this step scenarios reach **derived** states only (DRAFT / NEEDS_REVIEW / EXTRACTED); human states come in M8.4 and M9.4. |
| 6.2 | `scripts/record-fixtures.ts`, `scripts/eval-extraction.ts` | `fixtures:record` overwrites hand-authored fixtures with `source: "recorded"`. `eval:extraction --model primary|fallback [--ref SHP-24811]` prints per-field accuracy vs manifest truth, JSON-validity rate, p50/p95 latency. Paste results into `docs/TDD.md` → "Model evaluation" and set the defaults in `env.ts` accordingly. |

If recorded output differs from the truth, keep it — that is the honest demo. Scenarios later confirm/correct those fields through the review service, which also fills the accuracy report with real corrections.

**Verify:** `pnpm db:reset` (seed completes; `seed.int.test.ts`: SHP-24811 has CC-03 `FAIL`, SHP-24819 has 1 document, SHP-24814 has CC-06 `FAIL`) · with a key: `pnpm fixtures:record && pnpm eval:extraction --model primary && pnpm eval:extraction --model fallback`.

---

## M7 — Shipment list, new shipment, review workstation (read)

**Goal:** the screens look finished and show real data before any mutation is wired. Read PRD §5, ARCHITECTURE §11; load the `frontend-design` guidance for visual decisions.

| Step | Files | Notes |
|---|---|---|
| 7.1 | `src/server/queries/shipments.ts`, `src/app/(app)/shipments/page.tsx`, `src/components/shipments/shipment-table.tsx`, `src/components/shipments/shipment-filters.tsx` | S2: filters in URL search params; columns ref · supplier · importer · docs (n/3) · unresolved · mismatches · status · updated; empty state with "New shipment" and "Load a sample set"; skeleton; error boundary. Table collapses to cards < 768 px. |
| 7.2 | `src/app/(app)/shipments/new/page.tsx`, `src/components/shipments/new-shipment-form.tsx`, `src/components/shipments/upload-slot.tsx` | S3: three slots with drag/drop, progress, per-slot errors (size, type, pages), sample-set picker. After upload, start extraction per document and route to S4. |
| 7.3 | `src/server/queries/review-model.ts`, `src/app/(app)/shipments/[id]/page.tsx`, `src/components/review/workstation.tsx`, `src/components/review/document-viewer.tsx` | S4 layout; viewer tabs INV/PL/BL, page list, zoom, rotate 90°, fine rotate, bbox overlay; `firstOpenedAt`. |
| 7.4 | `src/components/review/field-panel.tsx`, `src/components/review/field-row.tsx`, `src/components/review/issues-panel.tsx`, `src/components/review/extraction-progress.tsx`, `e2e/review.spec.ts` | Issues first (crimson, then amber); field rows with confidence pill + "why" tooltip, source chip (`PL · p1`), mode badge (Live / Recorded sample / Manual). Polling while `EXTRACTING`. |

**Verify:** `pnpm typecheck && pnpm lint` · `pnpm test:e2e e2e/review.spec.ts` — signs in as Asha, opens SHP-24811, sees the CC-03 card with 3,120.000 / 3,165.000 / 3,165.000 kg and Δ 45.000 kg; clicking it switches to the PL tab and draws the box; at 390 px width the Document · Fields · Issues tabs work.

---

## M8 — Review actions

**Goal:** an executive can take SHP-24811 from 1+ issues to submitted, entirely by keyboard if they want.

| Step | Files | Notes |
|---|---|---|
| 8.1 | `src/server/services/review.ts`, `src/server/actions/review.ts` | `confirmField`, `setFieldValue`, `addLineItem`, `removeLineItem`, `markPageUnreadable` (wraps manual-entry), `dismissWrongType`, `submitForApproval` — API_SPECS §5.2. Versioned writes, `field_edits`, recompute, approval invalidation. |
| 8.2 | `src/server/services/resolutions.ts`, `src/components/review/resolve-check-dialog.tsx`, `src/components/review/query-importer-dialog.tsx` | `acceptDiscrepancy`, `acknowledgeMissing`, `clearResolution`, `raiseImporterQuery`, `resumeFromHold`. Dialogs show observed values side by side; declared value prefilled from export precedence (A-05). |
| 8.3 | `src/components/review/use-review-shortcuts.ts`, `src/components/review/shortcut-help.tsx`, `src/components/review/submit-bar.tsx`, `e2e/resolve.spec.ts` | Shortcuts per ARCHITECTURE §11; submit bar shows "N issues left" and disables with reason. |
| 8.4 | `src/server/db/seed-scenarios.ts` | Drive SHP-24812 → `EXTRACTED`, SHP-24817 → `READY_FOR_APPROVAL`, SHP-24818 → `ON_HOLD` (manual entry + importer query) through the services; include a few realistic corrections. |

**Required integration tests:** confirm on stale version → `VERSION_CONFLICT`; correcting a field that fixes a CC-03 mismatch turns the check `PASS`; accepted discrepancy survives recompute but re-opens when the value changes; edit while `READY_FOR_APPROVAL` → status re-derived + `APPROVAL_INVALIDATED`; `setFieldValue` with "3.120,0O" → `VALIDATION_FAILED`; edits on `EXPORTED` → `INVALID_STATE`.

**Verify:** `pnpm test:int src/server/services/review src/server/services/resolutions` · `pnpm test:e2e e2e/resolve.spec.ts` (accept CC-03 declaring 3,165 kg, confirm amber fields with `J`/`Enter`, unresolved → 0, submit).

---

## M9 — Approval and export

**Goal:** the hard gate holds on the server, and the CSV is byte-exact.

| Step | Files | Notes |
|---|---|---|
| 9.1 | `src/domain/export/csv.ts`, `src/domain/export/__fixtures__/SHP-24811.cf1.csv` | API_SPECS §6. Golden test compares bytes (BOM + CRLF). Injection test: description `=HYPERLINK("x")` → `'=HYPERLINK(""x"")` quoted. JPY 0-dp test (SHP-24818). |
| 9.2 | `src/server/services/approval.ts`, `src/server/actions/approval.ts`, `src/app/(app)/shipments/[id]/approval/page.tsx`, `src/components/approval/approval-summary.tsx` | S5: corrections (AI → human), manual entries, accepted discrepancies with acknowledgement ticks, mode badges, approve / send back. |
| 9.3 | `src/server/services/export.ts`, `src/app/api/shipments/[id]/export/route.ts`, `src/app/api/shipments/[id]/exports/[exportId]/route.ts`, `src/app/(app)/shipments/[id]/export/page.tsx`, `src/components/export/export-preview.tsx` | S6: preview table of CF-1 rows, column source hints, download, history; blocked state lists reasons with links to S4/S5. |
| 9.4 | `src/server/db/seed-scenarios.ts`, `e2e/approve-export.spec.ts` | Drive SHP-24813 → `APPROVED`, SHP-24816 → `EXPORTED` (Meera approves submissions by Asha/Vikram). |

**Required tests:** SHP-24811 before review → export `409 EXPORT_BLOCKED` (`UNRESOLVED_ISSUES`, `NOT_APPROVED`); executive calls `approveShipment` → `FORBIDDEN`; manager approving own submission → `SELF_APPROVAL_FORBIDDEN`; approve without acknowledging every accepted discrepancy → `VALIDATION_FAILED`; data change after approval → export blocked; `lastDataChangeAt > approvedAt` alone → `CHANGED_AFTER_APPROVAL` (defence in depth); re-download writes `EXPORT_DOWNLOADED`.

**Verify:** `pnpm test src/domain/export` · `pnpm test:int src/server/services/approval src/server/services/export` · `pnpm test:e2e e2e/approve-export.spec.ts`.

---

## M10 — Reports, history, hardening, submission docs

**Goal:** extra depth, nothing rough at the edges, and the two submission files written from real numbers.

| Step | Files | Notes |
|---|---|---|
| 10.1 | `src/server/queries/accuracy.ts`, `src/app/(app)/reports/accuracy/page.tsx`, `src/components/reports/accuracy-table.tsx`, `src/components/reports/calibration-table.tsx` | S7 (manager): accuracy by field and supplier (PRD §8.3), calibration by confidence bucket (≥ 0.95, 0.85–0.95, 0.5–0.85, < 0.5 → correction rate), median review time (A-22), checks caught before export; filter by mode; edit log. |
| 10.2 | `src/server/queries/history.ts`, `src/app/(app)/shipments/[id]/history/page.tsx`, `src/lib/pii.ts`, `src/server/actions/importers.ts` | S8 merges `audit_logs` + `field_edits`. Masking + reveal with `PII_REVEALED` audit. |
| 10.3 | `next.config.ts`, `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/(app)/loading.tsx`, `e2e/smoke-mobile.spec.ts` | Security headers/CSP (ARCHITECTURE §9), `serverExternalPackages`. Sweep every screen for loading / empty / error states and disabled-with-reason buttons. Mobile smoke at 390 px for S2, S5, S6, S7. |
| 10.4 | `docs/TDD.md`, `docs/deployment.md`, `README.md` | TDD: GitHub + live URL at top, architecture and why, data model, flows, how the AI works and fails, UI decisions per screen, model evaluation numbers, assumptions (link PRD §14), what was cut, what's next. deployment.md: local run, deploy steps, env var **names**, demo logins. Deploy production; seed production with `pnpm db:seed --allow-remote`. |

**Verify:** `pnpm verify && pnpm test:int && pnpm test:e2e` · walk the demo script on the production URL as Asha then Meera: SHP-24811 resolve → submit → approve → export; SHP-24815 low-confidence container; SHP-24818 manual entry; accuracy report populated.

---

## Final submission checklist

- [ ] Public GitHub repo, granular commit history, no secrets (gitleaks clean), no real personal data.
- [ ] Live URL on Vercel (`bom1`) with seeded data; demo logins in `deployment.md`.
- [ ] `docs/TDD.md` (export to PDF/Word for the ZIP) with GitHub URL and live URL at the top; every assumption labelled (A-xx).
- [ ] `docs/deployment.md`.
- [ ] ZIP contains exactly those two files, < 25 MB.

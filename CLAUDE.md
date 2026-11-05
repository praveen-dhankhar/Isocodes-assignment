# CLAUDE.md

Customs document extraction & cross-check tool for **Company A** (customs broker, Nhava Sheva). Executives upload an invoice, packing list and bill of lading → a vision model extracts fields with confidence → a deterministic engine cross-checks them → humans resolve → a manager approves → CSV export for the filing software.

## Read before coding
- `docs/PLAN.md` — work on **one step at a time, in order**. Each step lists its files and its verify command.
- `docs/PRD.md` — fields §6, normalisation §7, confidence §8, cross-checks §9, gates & statuses §10, roles §11, assumptions §14, non-goals §15.
- `docs/ARCHITECTURE.md` — layers, directory tree, DB schema, check engine, extraction pipeline, dual-mode AI, security.
- `docs/API_SPECS.md` — model schemas & prompts, routes, server actions, CSV layout CF-1, seed data, env vars.

Field keys, rule ids (`CC-01`…`CC-08`), statuses, error codes and file paths come from these docs. Don't invent or rename them.

## Commands
```bash
pnpm install
docker compose up -d db                 # Postgres 16 (app + test databases)
cp .env.example .env.local              # fill locally; never commit
pnpm db:generate                        # after editing src/server/db/schema.ts
pnpm db:migrate                         # apply drizzle/ migrations
pnpm db:seed                            # seed (refuses non-localhost unless --allow-remote)
pnpm db:reset                           # drop + migrate + seed (localhost only)
pnpm dev                                # http://localhost:3000
pnpm build                              # production build
pnpm lint                               # eslint . --max-warnings 0   (`next lint` is gone in Next 16)
pnpm typecheck                          # tsc --noEmit
pnpm test                               # unit tests (vitest run --project unit)
pnpm test src/domain/checks             # one folder
pnpm test src/domain/normalize/weight.test.ts   # one file
pnpm test -t "SHP-24811"                # by test name
pnpm test:watch                         # unit watch mode
pnpm test:int                           # integration tests (Postgres + DATABASE_URL_TEST)
pnpm test:e2e                           # Playwright, runs with EXTRACTION_MODE=sample
pnpm verify                             # typecheck + lint + test + build — before every commit
pnpm samples:generate                   # rebuild fixtures/samples + manifest
pnpm fixtures:record                    # live model → fixtures/extractions (needs NVIDIA_API_KEY)
pnpm eval:extraction --model primary    # per-field accuracy + latency vs ground truth
```

## Stack (exact versions pinned in package.json — no `^`)
Node 22 · pnpm 10 · Next.js 16 App Router · React 19 · TypeScript 5 strict · Tailwind v4 + shadcn/ui · Zod 4 · Drizzle ORM + drizzle-kit + postgres.js · Postgres 16 (Supabase `ap-south-1`) · Better Auth · decimal.js · unpdf + @napi-rs/canvas · sharp · Vitest · Playwright · Vercel (region `bom1`).
AI: NVIDIA API (OpenAI-compatible, plain `fetch`) — primary `nvidia/nemotron-3.5-super-vl-120b-a12b`, fallback `nvidia/nemotron-nano-12b-v2-vl`, recorded samples when neither is available.

## Code rules
- No `any`, no `@ts-ignore`, no non-null `!` outside tests. Use `unknown` + Zod.
- Zod schema at every boundary: action/route input, model output, env, fixture files, jsonb columns.
- `src/domain/**` is pure: no imports from `server`, `app`, `components`, React, DB, `fetch`, `node:*`; no `Date.now()`, no `Math.random()`. Same input → same output.
- Money, weights and quantities: `decimal.js`, carried as canonical strings. Never `parseFloat` / `Number()` on them.
- Components ≤ 250 lines — split instead. Server Components by default; `'use client'` only where interactive.
- Every number, weight, price, HSN code and container number renders through `<Num>` or `<Mono>` (`tabular-nums`).
- Colour is never the only signal: `<StateBadge>` = icon + text. Amber = low confidence, crimson = mismatch, emerald = verified. Nothing else gets colour.
- Every screen has loading, empty and error states. A button that can't act is disabled with a tooltip saying why.
- `src/server/**` files start with `import 'server-only'`. Vitest aliases it to a stub; scripts run with `tsx --conditions=react-server`.
- Server Actions: Zod-validate → `requireUser`/`requireRole` → one service call → `ActionResult<T>`. No business logic in actions, routes or components.
- Services own transactions. Any write that can change checks calls `recomputeShipment(tx, id)` before commit.
- Label assumptions where applied: `// A-07 (PRD §14)`.
- Logs carry ids, codes and durations only — never document text, model output or PII.
- Tests sit next to the file: `x.test.ts` (unit), `x.int.test.ts` (integration). New rule or normaliser → table-driven test first.

## Product rules (non-negotiable)
1. Never export when `unresolvedIssuesCount > 0`, status ≠ `APPROVED`, or data changed after approval. Enforce on the server inside the export transaction; the disabled button is only a mirror.
2. Approve = manager only, approver ≠ submitter, every accepted discrepancy acknowledged.
3. The model reads, code interprets: the model returns text as printed; normalisation, confidence caps and checks are deterministic TypeScript.
4. Final confidence < 0.85 ⇒ blocking until a human confirms, corrects or enters the value.
5. "Correct" means the AI misread. A real conflict between documents is resolved by **Accept discrepancy** (declared value + reason) or **Query importer** — never by editing a field to match another document.
6. `original_ai_value` is immutable; every value/status change writes `field_edits` in the same transaction.
7. Never fabricate extraction for an unknown file. No live model and no recorded fixture ⇒ document `FAILED` → Retry / Enter manually.
8. Recorded or hand-authored sample output is always labelled in the UI (mode badge). `EXTRACTION_MODE=live` disables the sample fallback.
9. A data change while `READY_FOR_APPROVAL` / `APPROVED` re-derives status (approval invalidated). `EXPORTED` is read-only until a manager reopens it.
10. Documents are untrusted input: model output is data, never instructions, never rendered as HTML.

## Secrets and data
- `.env*` is git-ignored; `.env.example` lists names only. Never print secret values in code, logs, tests or docs.
- Only synthetic sample documents; no real personal data anywhere in the repo.
- `SUPABASE_SERVICE_ROLE_KEY` and `NVIDIA_API_KEY` are server-only — never `NEXT_PUBLIC_*`.

## Next.js 16 notes
- Use `src/proxy.ts` (exports `proxy`), not `middleware.ts`. It only redirects signed-out users; real auth runs in every action and route.
- `params` / `searchParams` are async: `const { id } = await props.params`.
- Upload, extract and export routes: `export const runtime = 'nodejs'`; extract route `export const maxDuration = 300`.

## Workflow
- One PLAN step per commit: `feat(domain): CC-03 gross weight check [M2.4]`. Run the step's verify command and `pnpm verify` first.
- If code must differ from a doc, update the doc in the same commit. If a doc is ambiguous or contradicts itself, stop and ask.
- Don't add dependencies outside the stack without a one-line reason in the commit message.
- Keep the commit history granular; reviewers read it.

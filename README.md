# Customs document cross-check

Extraction and cross-check tool for a customs broker at Nhava Sheva. Executives upload an invoice, packing list and bill of lading; a vision model (NVIDIA API) reads the fields; a deterministic engine cross-checks them; people resolve what doesn't match; a manager approves; the result exports as CSV for the filing software.

**Live:** https://aidocextractor.vercel.app · **Design document:** [docs/TDD.md](docs/TDD.md) · **Deploy and demo guide:** [docs/deployment.md](docs/deployment.md)

All milestones of [docs/PLAN.md](docs/PLAN.md) are built: upload, extraction with confidence, cross-checks CC-01…CC-08, review and resolution, four-eyes approval, a server-enforced export gate with CF-1 CSV, the accuracy report and per-shipment history.

## Docs

| Doc | What it covers |
|---|---|
| [PRD](docs/PRD.md) | Users, fields, normalisation, confidence, cross-checks, statuses, assumptions |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, directory tree, DB schema, check engine, extraction pipeline, security |
| [API_SPECS](docs/API_SPECS.md) | Model schemas, routes, server actions, CSV layout, seed data, env vars |
| [PLAN](docs/PLAN.md) | Milestones and steps, each with its verify command |
| [TDD](docs/TDD.md) | Design document: architecture and why, AI behaviour, evaluation, UI decisions, tests, what's next |
| [deployment](docs/deployment.md) | Demo logins and script, local run, env var names, deploy and seed steps |

## Stack

Node 22 · pnpm 10 · Next.js 16 (App Router) · React 19 · TypeScript 5 strict · Tailwind v4 + shadcn/ui · Zod 4 · Drizzle + Postgres 16 · Better Auth · Vitest · Playwright. AI: NVIDIA vision models (primary `nemotron-3.5-super-vl`, fallback `nemotron-nano-12b-v2-vl`), recorded samples when neither is available. Hosting: Vercel `bom1` (Mumbai) and Supabase `ap-south-1` (Mumbai).

## Run locally

Needs Node 22 (`.nvmrc`), Corepack (ships with Node) and Docker.

```bash
corepack enable                  # uses the pnpm version pinned in package.json
pnpm install
docker compose up -d db          # Postgres 16 on localhost:5433: databases customs and customs_test
cp .env.example .env.local       # then fill it in (below)
pnpm db:reset                    # migrate and seed demo users, masters and the 9 sample shipments (local only)
pnpm dev                         # http://localhost:3000
```

Local values for `.env.local` (the compose database uses local-only credentials):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/customs
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5433/customs_test
BETTER_AUTH_SECRET=              # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
STORAGE_DRIVER=local
SEED_DEMO_PASSWORD=              # any 8+ characters; the demo accounts below use it
```

Demo accounts (password = `SEED_DEMO_PASSWORD`): `asha@demo.test` and `vikram@demo.test` (documentation executives), `meera@demo.test` (documentation manager).

Leave `NVIDIA_API_KEY` empty to run without the live model. Every variable is described in [API_SPECS §8](docs/API_SPECS.md#8-environment-variables-names-only--values-never-in-the-repo).

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server, production build, production server |
| `pnpm typecheck` | Generates route types, then `tsc --noEmit` |
| `pnpm lint` | ESLint with zero warnings allowed (includes layering rules) |
| `pnpm test` / `pnpm test:watch` | Unit tests (`*.test.ts`) |
| `pnpm test:int` | Integration tests (`*.int.test.ts`) against `DATABASE_URL_TEST` |
| `pnpm test:e2e` | Playwright against a dev server on port 3100 with `EXTRACTION_MODE=sample`; needs the seeded local database (`pnpm db:reset`) and no other `next dev` running |
| `pnpm db:generate` / `pnpm db:migrate` | New migration from `src/server/db/schema.ts` / apply migrations |
| `pnpm db:seed` | Demo users, importers, suppliers and the sample shipments SHP-24811…24819 (uploaded and extracted from recorded samples); refuses a non-local database unless `--allow-remote` |
| `pnpm db:reset` | Drop, migrate and seed; local databases only |
| `pnpm verify` | typecheck + lint + unit tests + build; run before every commit |
| `pnpm samples:generate` | Rebuild the synthetic sample PDFs/scans, the manifest and the hand-authored fixtures (byte-stable) |
| `pnpm fixtures:record` / `pnpm eval:extraction --model primary\|fallback\|recorded` | Record live model output / measure per-field accuracy, JSON validity and latency |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit and integration tests against a Postgres 16 service, a build, and a gitleaks secret scan.

## Deploy

1. **Supabase:** create a project in region **South Asia (Mumbai) `ap-south-1`**. Its transaction-pooler connection string becomes `DATABASE_URL`. Run `pnpm db:migrate` against it and create a **private** Storage bucket `documents`.
2. **Vercel:** import this GitHub repository. `vercel.json` pins functions to **`bom1`** (Mumbai).
3. **Environment variables** go in Vercel → Project → Settings → Environment Variables, never in the repo. The names are in [API_SPECS §8](docs/API_SPECS.md#8-environment-variables-names-only--values-never-in-the-repo); `SUPABASE_SERVICE_ROLE_KEY` and `NVIDIA_API_KEY` are server-only and must never get a `NEXT_PUBLIC_` prefix.

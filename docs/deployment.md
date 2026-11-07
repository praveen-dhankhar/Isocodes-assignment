# Deployment and demo guide

- **Live:** https://aidocextractor.vercel.app (Vercel, functions in `bom1` Mumbai)
- **Database and files:** Supabase Postgres 16 and a private Storage bucket, region `ap-south-1` (Mumbai)
- **Code:** https://github.com/praveen-dhankhar/Isocodes-assignment
- **Demo video (75 s, captioned):** https://aidocextractor.vercel.app/demo.webm

## Demo logins

| Email | Role | Use it for |
|---|---|---|
| `asha@demo.test` | Documentation executive | upload, review, resolve, submit |
| `vikram@demo.test` | Documentation executive | the second executive (seeded submissions) |
| `meera@demo.test` | Documentation manager | approve, send back, reopen, export, accuracy report |

The password is the `SEED_DEMO_PASSWORD` the database was seeded with. It is deliberately not in the repository; the copy of this file in the submission ZIP states it. All companies, people, numbers and documents are synthetic.

Tip: the seeded shipments are shared by everyone who tries the demo. For a fresh copy, use **New shipment → Load a sample set**.

## Demo script (about 10 minutes)

1. **As Asha, open SHP-24811.** CC-03 says the gross weight differs: INV 3,120 kg, PL 3,165 kg, B/L 3,165 kg, Δ 45 kg. Click the card: the viewer opens the packing list with the box drawn. Choose **Accept discrepancy**: the value to file is prefilled from the bill of lading (A-05); give a reason. Press **J**, then **Enter**, to confirm the low-confidence net weight. Press **Ctrl/⌘ + Enter** to submit.
2. **SHP-24815:** the phone-scanned bill of lading has a container number with a wrong check digit. It shows as low confidence and as CC-07 mismatch.
3. **SHP-24818:** packing-list page 2 is unreadable. The weights were entered by hand (Manual), and an importer query about cartons keeps the shipment **On hold**.
4. **As Meera, open SHP-24811 → Approval.** See the accepted discrepancy, tick it, approve. Then **Export**: the CF-1 preview shows where every column comes from; export as Excel (or CSV — both files are kept and can be downloaded again).
5. **Accuracy** (top navigation): turn on "Include recorded samples". The recorded model output had no errors on these documents, so field accuracy starts at 100%; correct any value on a shipment, get it approved, and the correction is counted against that field and supplier. The calibration table and edit log fill the same way. **History** on any shipment shows the full timeline.
6. **Your own document:** create a shipment and upload a PDF, JPEG or PNG. The vision model reads it live (badge "Live"; about 5 s a page) and the same checks run. Bundled samples are read live too and fall back to their recordings only if the model is unavailable. If no model can read a file, it fails honestly ("No live model or recorded sample for this file") and offers **Retry** and **Enter manually**.

## Run locally

```bash
corepack enable && pnpm install
docker compose up -d db              # Postgres 16 on localhost:5433 (customs, customs_test)
cp .env.example .env.local           # fill in the names below
pnpm db:reset                        # migrate + seed users, masters and the 9 sample shipments
pnpm dev                             # http://localhost:3000
```

Local `.env.local` uses `STORAGE_DRIVER=local`, the two `localhost:5433` database URLs, `BETTER_AUTH_URL=http://localhost:3000`, a random `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and any `SEED_DEMO_PASSWORD`. Checks: `pnpm verify`, `pnpm test:int`, `pnpm test:e2e`.

## Environment variables (names only)

| Name | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Vercel, scripts | Supabase **transaction pooler** (port 6543) for Vercel; the **session pooler** (port 5432) for migrations and seeding from a laptop. URL-encode special characters in the password. |
| `BETTER_AUTH_SECRET` | Vercel | 32+ random characters |
| `BETTER_AUTH_URL` | Vercel | `https://aidocextractor.vercel.app` |
| `STORAGE_DRIVER` | Vercel, seeding | `supabase` in production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel, seeding | server-only, never `NEXT_PUBLIC_*` |
| `SUPABASE_STORAGE_BUCKET` | optional | default `documents` (private) |
| `NVIDIA_API_KEY` | optional | turns on the live model; server-only |
| `NVIDIA_BASE_URL`, `NVIDIA_VLM_MODEL`, `NVIDIA_VLM_FALLBACK_MODEL` | optional | defaults in `src/lib/env.ts` |
| `EXTRACTION_MODE` | optional | `auto` (default) · `live` · `sample` |
| `SEED_DEMO_PASSWORD` | seeding only | password of the demo users |

Values live only in Vercel and Supabase settings and in your own `.env.local`; `.env*` is git-ignored.

## Deploy

1. **Supabase**
   1. Create a project in **South Asia (Mumbai)**.
   2. Create a **private** Storage bucket named `documents`.
   3. Apply the migrations from a laptop. RLS is enabled on every table by migration 0002.
      ```bash
      DATABASE_URL='<session-pooler URI>' pnpm db:migrate
      ```
2. **Vercel**
   1. Import the GitHub repository; `vercel.json` pins functions to `bom1`.
   2. Add the variables above for Production.
   3. Every push to `main` deploys. `GET /api/health` confirms that PDF rendering works in the region.
3. **Seed production.** This uploads the bundled files to Storage and extracts them from the recorded samples, so the storage variables must be set too:
   ```bash
   DATABASE_URL='<session-pooler URI>' STORAGE_DRIVER=supabase SUPABASE_URL='<project URL>' \
   SUPABASE_SERVICE_ROLE_KEY='<secret key>' SEED_DEMO_PASSWORD='<demo password>' \
   pnpm db:seed --allow-remote
   ```
   The seed is idempotent: it adds only what is missing.

## Optional: the live model

1. Put `NVIDIA_API_KEY` in `.env.local` and in Vercel.
2. Record real fixtures and measure both models:
   ```bash
   pnpm fixtures:record && pnpm eval:extraction --model primary && pnpm eval:extraction --model fallback
   ```
3. Commit the recorded fixtures and paste the numbers into `docs/TDD.md` §6.

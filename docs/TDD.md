# Customs document cross-check — Technical Design Document

- **Code:** https://github.com/praveen-dhankhar/Isocodes-assignment
- **Live:** https://aidocextractor.vercel.app (Vercel `bom1`, Mumbai; demo logins in [`deployment.md`](deployment.md))
- **Product spec:** [`PRD.md`](PRD.md) · **Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · **Contracts:** [`API_SPECS.md`](API_SPECS.md) · **Build plan:** [`PLAN.md`](PLAN.md)

## 1. The problem and the slice built

Company A, a customs broker at Nhava Sheva, re-keys every shipment's commercial invoice, packing list and bill of lading into its filing software. Typing errors and documents that quietly disagree lead to amended Bills of Entry. The brief's example: the invoice says 3,120 kg gross, the packing list 3,165 kg.

This slice does the following:

1. An executive uploads the three documents, or loads a bundled sample set.
2. A vision model reads every field and gives a confidence for each.
3. Deterministic code normalises the values, caps the confidence and cross-checks the documents against each other.
4. The executive confirms, corrects or enters values, and resolves each mismatch (accepts it with a declared value, or queries the importer).
5. A different person, the manager, approves.
6. Only then can a CSV be exported for the filing software. The server enforces this gate.

Everything a person changes is recorded. The manager's accuracy report shows where the AI can be trusted.

### 1.1 How the build answers the brief

| Brief item | Where it is | Status |
|---|---|---|
| Shipment record with upload of invoice, packing list and bill of lading | S2 list, S3 upload (three slots, drag and drop, sample sets) | Built |
| AI extraction: parties, invoice no. and date, currency, Incoterm, line items with HSN, packages, weights, containers | Field registry (PRD §6), vision model per page, confidence per field | Built |
| Review screen, document beside the fields, low-confidence fields highlighted | S4: document 55% / fields 45%, amber for uncertain values, the source box drawn on the page | Built |
| Cross-checks: invoice total vs line sum; packages and weights across all three documents | CC-02 (total), CC-01 (each line), CC-03 gross, CC-04 net, CC-05 packages; plus CC-06 lines, CC-07 containers, CC-08 invoice reference | Built |
| Export in the filing software's import layout | CF-1 CSV, one row per invoice line (A-06: the real layout was not provided; the core build asks for CSV; XLSX is next) | CSV built |
| Shipment status list | S2 with status, supplier and search filters | Built |
| Edit history and accuracy report per field and supplier | S8 history, S7 accuracy, calibration and edit log | Built |
| When the AI is wrong: low-confidence fields and failed cross-checks must be confirmed by a person; nothing exports until cleared | Confidence < 0.85 and every failed check are blocking issues; the export gate re-checks on the server | Built |
| Corrections logged to show accuracy per field and supplier | `field_edits`; only corrections of AI-read values count as errors (PRD §8.3) | Built |
| Unreadable pages go to manual entry | Model-reported or user-marked unreadable pages clear their values; typed values are recorded as manual entries | Built |
| Roles: documentation executive and manager | Better Auth roles; approve, send back, reopen and the report are manager-only; approver ≠ submitter (A-14) | Built |
| Importers send documents and answer queries | Executives upload on their behalf (A-18); "Query importer" is a stored mock notification | Mocked, as the brief allows |
| Host in India; role-based access | Vercel `bom1` and Supabase `ap-south-1` (Mumbai); checks in every action and route | Built |
| An AI provider that does not train on client data | See §5: production runs the model self-hosted; the hosted demo API only ever sees synthetic documents (A-16) | Design + demo constraint |
| Importer contacts are personal data (DPDP Act 2023) | Not extracted (A-07); masked in the UI; revealing one is logged | Built |
| Scans are often skewed or bilingual | Samples include a skewed phone scan and a Chinese/English invoice; viewer rotates 90° and ±0.5° | Built |
| Minimal design; uncertain fields obvious; every action one click away | Restrained palette with three state colours; Confirm and Correct sit on every uncertain value and issue card | Built |

### 1.2 The client's numbers and how the product measures them

The brief puts the cost at ₹70.29 lakh a year: ₹34.65 lakh of data entry (1,100 shipments a month × 45 min × ₹350/hour) and ₹35.64 lakh of amendments and delays (396 cases × ₹9,000). Taking entry from 45 to 15 minutes, as the brief targets, would save two thirds of the entry cost, about ₹23.1 lakh a year, by the brief's own figures. Halving amendments would save about ₹17.8 lakh more.

| Success measure | How the product shows it |
|---|---|
| Entry time 45 → under 15 minutes | Median review time on S7: first open of the review screen to submit (A-22) |
| 95% field accuracy on 200 past shipments | Field accuracy on S7 by field and supplier; `pnpm eval:extraction` measures it offline against labelled documents |
| Amended Bills of Entry halved in 3 months | Not measurable inside the product (it needs filing outcomes); S7 shows a proxy: misreads corrected plus discrepancies declared before export |

## 2. Architecture and why

```
Browser (React 19, Server Components by default)
   │  Server Actions (Zod → requireUser/requireRole → one service call → ActionResult)
   │  Route Handlers (upload, extract, page images, export, status poll)
   ▼
src/server/services  ── transactions, locking, audit, recompute after every write
   │        │
   │        └── src/server/ai (NVIDIA vision client, recorded-sample provider, provider chain)
   ▼
src/domain  ── pure TypeScript: normalisers, confidence policy, cross-check engine CC-01…CC-08,
               blocking issues, status machine, export gate, CF-1 CSV. No I/O, no clock, no randomness.
   ▼
Postgres 16 (Supabase ap-south-1, RLS on, Data API sees nothing) + private Storage bucket
```

**Why this shape**

- **The model reads; code interprets.** The model returns text exactly as printed, a 0–1 confidence and a box. Everything that decides an outcome is plain TypeScript with table-driven tests, so the same input always gives the same result: turning "3.120,00 KGS" into kilograms, judging whether a date is ambiguous, capping confidence, comparing documents, deciding status and whether export may run. A model upgrade cannot quietly change a business rule.
- **One recompute path.** Every write that could change a check goes through the same steps inside its transaction: upload, extraction, edit, resolution, approval invalidation. The steps are lock the shipment row, rebuild the snapshot, run the engine, store results, derive issues and status, bump the version, and audit. Issue counts, statuses and check results therefore cannot drift apart.
- **Optimistic concurrency.** Every mutation carries the version it was based on. A stale write gets `409 VERSION_CONFLICT` with the current state, and the UI shows a toast and reloads.
- **A hard export gate on the server.** Export re-runs `canExport` inside the export transaction, with the shipment row locked. The disabled button in the UI only mirrors that check. The gate fails closed: if an approval exists but the time of the last data change is unknown, the data counts as changed after approval.
- **Next.js 16 on Vercel Mumbai, Postgres and Storage in Supabase Mumbai.** One deployable unit, with data in India (DPDP Act). Native PDF rendering (`unpdf` + `@napi-rs/canvas`, `sharp`) runs inside the Node functions; `/api/health` renders a PDF in production to prove it.

## 3. Data model (short)

The full Drizzle schema is in ARCHITECTURE §4.2 and `src/server/db/schema.ts`.

| Table | Holds |
|---|---|
| `shipments` | ref, importer, supplier, status, `version`, unresolved issues and mismatch counts, submitted/approved by and at, `last_data_change_at`, `first_opened_at` |
| `documents`, `document_pages` | one current document per slot (`superseded_at` keeps replaced ones); mode `LIVE`/`SAMPLE`/`MANUAL`; model id, latency and usage; page images, size and readability |
| `extracted_fields`, `line_items` | raw text as printed, canonical value, the AI's original value (never changed), model and final confidence with the reasons for any cap, page and box, status, field `version` |
| `field_edits` | append-only: every confirm, correct and manual entry with before, after, the AI value, user and time |
| `cross_check_results` | one row per rule and scope: observed values, delta, fingerprint, resolution (accepted, acknowledged or queried) and acknowledgement |
| `exports`, `audit_logs` | stored CSV files with SHA-256; every event, with ids and codes only (no document text, no PII) |

A resolution is stored with the **fingerprint** of the values it was made on. If a value changes, the fingerprint changes and the check re-opens by itself. An accepted discrepancy can never cover a different mismatch than the one the person saw.

## 4. Flows

| Flow | What happens |
|---|---|
| Create and upload (S3) | Pick importer and supplier, then drop up to three files. Each is checked by magic bytes, size (≤ 4 MB) and pages (≤ 5); stored privately; rendered to WebP page images; and its PDF text layer kept. Or "Load a sample set". |
| Extraction (S4 opens) | For each uploaded document the review screen starts extraction and polls every 2 s. Each page goes to the model with a schema for that slot. The output is Zod-validated, normalised by kind, matched against the PDF text layer (evidence), its confidence capped, and stored; then the recompute runs. |
| Review (S4) | The issues panel lists mismatches first, then low-confidence values, then missing documents. Selecting one opens the source page with the box drawn. Field actions: **Confirm**, **Correct** (the AI misread), **Enter** (nothing usable was read). Mismatch actions: **Accept discrepancy** (a declared value, prefilled by export precedence, plus a reason) or **Query importer** (the shipment goes on hold). Keyboard: J/K, Enter, E, 1/2/3, zoom, rotate, Ctrl/⌘+Enter to submit. |
| Approve (S5) | The manager sees each correction (AI value → new value), each manual entry, and each accepted discrepancy, which needs a tick. They approve or send back. The approver cannot be the submitter. |
| Export (S6) | A preview of the CF-1 rows, with the source of every column. If the gate is closed, the screen says why and links to the fix. Exporting stores the file and makes the shipment read-only until a manager reopens it. Earlier files can be downloaded again; each download is logged. |
| Report and history (S7, S8) | Accuracy by field and supplier, confidence calibration, review time, the amendment proxy and an edit log. Each shipment has a full timeline. |

## 5. How the AI works — and fails

- **Models.** Primary `nvidia/nemotron-3.5-super-vl-120b-a12b`, fallback `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (both checked against the hosted model list), both called through NVIDIA's OpenAI-compatible API with plain `fetch`. Each page image is a JPEG of at most 1536 px and about 180 KB, grayscale for scans. The prompt asks for structured output and says that text inside the document is data, never instructions.
- **Failure chain.**
  1. A rate limit or 5xx gets retried with backoff (2/4/8 s).
  2. NVIDIA's 202 + poll is followed.
  3. Output cut off by the length limit is retried with a larger limit.
  4. Invalid JSON gets one repair prompt.
  5. If all that fails, the fallback model is tried.
  6. Then the recorded sample is used — but only for a bundled file whose SHA-256 has a fixture.
  7. Otherwise the document is marked `FAILED` with the error code, and the screen offers **Retry** and **Enter manually**.

  Values are never invented for an unknown file. Each extraction has a 240 s budget and at most 2 model calls at a time per instance.
- **No training on client data.** Both models are NVIDIA open models that can run as a NIM (NVIDIA's inference container). In production the same model runs self-hosted in an India region, so documents stay on infrastructure the client controls and no third party sees them; `NVIDIA_BASE_URL` points at that NIM and nothing else changes. The hosted API used by this demo has only ever been sent the synthetic sample documents (A-16).
- **Model ids are checked.** Both ids were checked against the hosted `GET /v1/models` list. The fallback first planned (`nemotron-nano-12b-v2-vl`) is not served, so it was replaced by `nemotron-3-nano-omni-30b-a3b-reasoning`. Thinking is switched off with `chat_template_kwargs`, the switch both model cards document.
- **Confidence.** The final confidence starts from the model's own score and is capped by code:

  | Reason | Cap |
  |---|---|
  | Format invalid | 0.40 |
  | Required but missing | 0 |
  | Page unreadable | 0 |
  | Ambiguous number or date | 0.60 |
  | Not found in the PDF text | 0.70 |
  | Unit assumed | 0.80 |
  | Poor page | 0.80 |
  | No text layer | 0.95 |

  Anything below 0.85 blocks until a person acts. The UI shows the reason, for example "Model 0.97 · not found in the PDF text → 0.70".
- **Honesty in the demo.** A badge marks every recorded or hand-authored output ("Recorded sample"), next to "Live" and "Manual". The seeded hand-authored fixtures contain four declared misreads (`misread` in `scripts/sample-data.ts`), so that the seeded corrections are real `CORRECT` edits made through the review service.

## 6. Model evaluation

`pnpm eval:extraction --model primary|fallback` runs a model over the 27 bundled files. It reports per-field accuracy against the manifest's ground truth (compared after the app's own normalisation), the JSON-validity rate and the p50/p95 latency per page. `pnpm fixtures:record` replaces the hand-authored fixtures with real model output (`source: "recorded"`).

**Status: the live evaluation has not been run yet.** No NVIDIA API key was available while this was built. The only number so far is offline, and it measures the scorer, not a model:

| Run | Result |
|---|---|
| `--model recorded` on the hand-authored fixtures | 98.8% field accuracy (343/347). The 4 misses are exactly the 4 declared misreads, which shows that the scorer and the app's normalisation agree. |

To fill this section, add `NVIDIA_API_KEY` to `.env.local` and run `pnpm eval:extraction --model primary`, `pnpm eval:extraction --model fallback` and `pnpm fixtures:record`. Then paste the two tables here and keep or swap the defaults in `src/lib/env.ts` based on accuracy and latency. In production, S7's calibration table keeps measuring the same thing on real corrections.

## 7. UI decisions per screen

| Screen | Decision |
|---|---|
| All | Zinc neutrals. Amber only for low confidence, crimson only for mismatches, emerald only for verified; each badge is icon + text, never colour alone. Numbers, weights, codes and containers use tabular figures. Every screen has a skeleton, an empty state that says what to do next, and an error state. A button that can't act is disabled with a tooltip saying why. |
| S2 list | Filters (status, supplier, ref or invoice-number search) live in the URL so a view can be shared. Below 768 px the table becomes cards. Workflow statuses are neutral. |
| S3 new | One form: the shipment is created once, a failed upload is retried into the same shipment, and a missing document can be added later. Sample sets sit below the form. |
| S4 review | The document on the left (55%), issues then fields on the right (45%); below 1024 px, tabs Document · Fields · Issues. Selecting a check jumps to the first value that disagrees (CC-03 → the packing list) and draws the box. Keyboard focus follows the selection so J then Enter is safe. The Correct editor repeats the rule: *Correct = the AI misread; if the document is wrong, accept the discrepancy or query the importer.* |
| S5 approval | A diff, not a form: AI → new values, manual entries, accepted discrepancies with ticks. Executives see it read-only. |
| S6 export | A preview of exactly what will be filed, with where each column comes from (A-05). When the gate is closed, the reasons link to the screen that fixes them. |
| S7 report | Live extractions by default; recorded samples are a labelled toggle, never mixed in silently. Calibration shows whether the confidence numbers can be believed. |
| S8 history | One timeline merging events and field edits; notes appear as written. |

## 8. Security and privacy

- Better Auth email + password: no sign-up, `role` is server-only, login is rate-limited in Postgres.
- `requireUser`/`requireRole` runs in every action and route; `proxy.ts` only redirects.
- Zod validates every input.
- Uploads are checked by magic bytes; storage keys are generated by the server; the bucket is private and files are streamed only through authorised routes.
- The CSP uses a nonce per request (`strict-dynamic`, no framing). Other headers: nosniff, `Referrer-Policy: same-origin`, `Permissions-Policy`, HSTS.
- CSV cells are guarded against formula injection; model output is never rendered as HTML.
- Importer contacts are masked; revealing one is logged (`PII_REVEALED`). Logs carry ids and codes only.
- RLS is on for every table; gitleaks scans the full history in CI.

## 9. Testing

| Layer | Count | What it pins down |
|---|---|---|
| Unit (Vitest) | 620 tests, 37 files | normalisers and the typed-input gate, confidence caps, the CC-01…CC-08 engine on named scenarios SHP-24811…24816 (and property tests), blocking issues, the status machine, the export gate, CF-1 against a byte-exact golden file (BOM, CRLF, injection guard, JPY with no decimals), NVIDIA client retries and repair |
| Integration (Postgres) | 69 tests, 14 files | extraction (including three documents extracted at once — this found and fixed a lock-order deadlock), manual entry, review and resolutions, approval rules (`FORBIDDEN`, `SELF_APPROVAL_FORBIDDEN`, unacknowledged discrepancy), the export gate (`EXPORT_BLOCKED` reasons, `CHANGED_AFTER_APPROVAL` defence in depth, re-download audit), seed scenarios, report and history queries |
| e2e (Playwright, recorded samples) | 9 tests, 5 specs | SHP-24811 CC-03 traced to the packing list; resolving by keyboard and submitting; approve → export download; unknown file → FAILED → manual entry; 390 px smoke over S2/S5/S6/S7; CSP headers. The whole suite also passes against a production build. |

CI runs typecheck, lint, unit, integration and build on every push, plus gitleaks. `pnpm verify` gates every commit.

## 10. Assumptions

The brief leaves these open; each is labelled in code where it is applied (`// A-xx`) and kept in [PRD §14](https://github.com/praveen-dhankhar/Isocodes-assignment/blob/main/docs/PRD.md#14-assumptions-register).

| Id | Assumption |
|---|---|
| A-01 | A shipment has exactly one commercial invoice, one packing list and one bill of lading. |
| A-02 | Uploads: PDF, JPEG, PNG; ≤ 4 MB per file (under Vercel's 4.5 MB body limit); ≤ 5 pages per document. |
| A-03 | Review threshold 0.85 on final confidence. |
| A-04 | Tolerances: money 0.01 in invoice currency; weight 0.5 kg absolute; packages and quantities exact. |
| A-05 | Export precedence: gross weight and packages B/L > PL > INV; net weight PL > INV > B/L; containers B/L > PL > INV; invoice-level fields from INV. A declared value from an accepted discrepancy overrides. |
| A-06 | The filing software's import layout was not provided; CF-1 (CSV) is invented and must be swapped for the client's template. The brief's must-have says Excel; the core build says CSV, which this slice delivers. |
| A-07 | Only party names are extracted; addresses, contact persons, phones and emails are not (data minimisation). |
| A-08 | Importer contact details are entered by staff in the importer master (seeded with fake data) and masked by default. |
| A-09 | Number format is detected per document; anything ambiguous goes to review. |
| A-10 | Dates default to DD/MM; MM/DD only for US suppliers; ambiguous dates go to review. |
| A-11 | HS code is optional on supplier invoices and only format-validated (6–10 digits). |
| A-12 | Line items match when description token similarity ≥ 0.5 (an HS code match adds 0.2 when both sides carry one). |
| A-13 | Sample data: only SHP-24811 (invoice line, invoice gross 3,120 kg, packing-list gross 3,165 kg) and SHP-24812 (invoice line, invoice gross 1,460 kg) come from the brief. Everything else is invented: B/L weight 3,165 kg, SHP-24812's PL/BL values, packages, net weights, containers, invoice numbers, dates, importers and shipments SHP-24813…24819. |
| A-14 | Four-eyes: the manager who approves cannot be the user who submitted. |
| A-15 | Display: en-IN number grouping; times in Asia/Kolkata; storage in UTC. Values typed on screen use "." as the decimal mark. |
| A-16 | The demo uses NVIDIA's hosted API (trial terms: prototyping only) with synthetic documents only. Production self-hosts the same model as a NIM in an India region, so client data never reaches a provider that could train on it. |
| A-17 | Retention: documents purged 180 days after export (policy documented; purge job not built in this slice). |
| A-18 | Executives upload on behalf of importers (no email intake, no importer portal). |
| A-19 | Supplier is chosen at shipment creation from a master list; the extracted supplier name is shown, not matched. |
| A-20 | One currency per invoice. |
| A-21 | Unit → UQC mapping covers common units only; unknown units are exported as printed. |
| A-22 | Review time = first open of the review screen → submit. |
| A-23 | Re-uploading a slot supersedes the previous document (kept for audit, hidden from review). |
| A-24 | Demo users are seeded; no self sign-up; password reset out of scope. |
| A-25 | ≤ 100 line items per invoice. |

## 11. What was cut or simplified

- **Live model numbers** (§6): blocked on an API key; the scripts are ready.
- **Model concurrency** is limited in-process per function instance; real load needs a queue.
- **Pagination:** the shipment list shows the 200 most recent.
- **No CI e2e job:** e2e runs locally against a seeded database.
- **Orphaned blobs:** a blob written before a failed transaction is left behind, and there is no sweep.
- **Retention purge (A-17)** is documented, not built.
- **Evidence matching** needs a PDF text layer; scans rely on confidence plus the cross-checks.

## 12. What's next

1. Record fixtures and evaluate both models with a key; choose the defaults from the numbers.
2. Replace CF-1 with the client's real import template (one mapping file) and add XLSX output.
3. Move extraction onto a job queue with retries, and add an e2e job to CI against a seeded Postgres service.
4. Email intake of documents; a self-hosted NIM in an India region for production (A-16).
5. Per-supplier learned hints (common misreads) fed back from the S7 data.

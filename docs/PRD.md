# PRD — Customs Document Extraction & Cross-Check (Core Slice)

> Version 1.0 · 2026-11-05 · Builder: Parveen Kumar
> Client: **Company A**, Navi Mumbai — freight forwarder and customs broker at Nhava Sheva (JNPT). 85 staff, documentation team of 14.
> This file is the source of truth for *what* to build. Every number or rule not taken from the client brief is listed in §14 as an assumption (`A-xx`). If code and this file disagree, fix the file first.

---

## 1. Problem

Importers email invoices, packing lists and bills of lading as PDFs, scans or photos. Executives retype the data into an Excel checklist and then into the customs filing software. Seniors raise doubts in a WhatsApp group.

| Cost driver (from brief) | Maths | ₹ / year |
|---|---|---|
| Data entry | 1,100 shipments/month × 0.75 h × 12 = 9,900 h × ₹350/h | 34.65 lakh |
| Errors → amended Bill of Entry or port delay | 13,200 shipments × 3% = 396 × ₹9,000 | 35.64 lakh |
| **Total** | | **70.29 lakh** |

Client's ask, in their words: drop in a shipment's documents, get the data out ready to check, catch mismatches like weights that differ across documents, and don't change the filing software.

## 2. Goal and how the product measures it

| Success target (brief) | How this product measures it |
|---|---|
| Entry time per shipment 45 → under 15 minutes | **Review time** = `submittedAt − firstOpenedAt` per shipment; median shown on the accuracy report (S7). |
| 95% field accuracy on 200 past shipments | **Field accuracy** = 1 − (AI values corrected by a human ÷ AI values) per field and per supplier (S7). `pnpm eval:extraction` measures it offline against labelled samples. |
| Amended Bills of Entry halved in 3 months | Not measurable inside this slice (needs filing outcomes). Proxy shown on S7: what review caught before export on approved/exported shipments — misreads corrected plus discrepancies declared (a FAIL check can only remain on such a shipment as an accepted discrepancy). |

## 3. Users

### 3.1 Documentation Executive — role `DOCUMENTATION_EXECUTIVE`
- 14-person team handles ~1,100 shipments/month → ~79 shipments per person per month (derived).
- Works at a desktop all day on one screen; fast with the keyboard; does not want to re-read a document the AI got right.
- Needs: see the document and the extracted fields side by side, know at a glance which fields to distrust, fix them in one click, get a clean file for the filing software.
- Can: create shipments, upload documents, run extraction, confirm/correct/enter fields, resolve cross-checks, raise importer queries, submit for approval, export approved shipments.

### 3.2 Documentation Manager — role `DOCUMENTATION_MANAGER`
- Approves shipments before data goes to filing. Wants to see only what changed or was overridden, not re-review everything.
- Watches accuracy by field and supplier to know where the AI can be trusted.
- Can: everything an executive can, plus approve / send back, reopen exported shipments, view the accuracy report.

### 3.3 Importer — not a user in this slice
Sends documents and answers queries. Represented only by a **mock** "Query importer" notification (stored, never sent).

## 4. Scope

**Core build (from brief, must work end to end):** shipment list → document upload → AI extraction with confidence scores → side-by-side review with cross-checks → CSV export. Roles: executive and manager. Hard part: reliable cross-checks across three documents.

**Extra depth (from brief's MUST HAVE, optional but planned):** edit history and accuracy report per field and supplier; manager approval screen.

## 5. Screens and flows

### 5.1 Screens (8)

| # | Route | Screen | Roles | Purpose |
|---|---|---|---|---|
| S1 | `/login` | Sign in | public | Email + password. No sign-up. |
| S2 | `/shipments` | Shipment list | both | Status list with filters (status, supplier, search by ref/invoice no.), counts of unresolved issues and mismatches, quick actions. |
| S3 | `/shipments/new` | New shipment & upload | both | Pick importer + supplier, upload 3 slots (Invoice, Packing list, Bill of lading), or **Load sample set**. Starts extraction. |
| S4 | `/shipments/[id]` | Review workstation (hero) | both | Document viewer left, fields + issues right. Confirm, correct, enter manually, resolve checks, submit. |
| S5 | `/shipments/[id]/approval` | Approval | manager (read-only for exec) | Summary of what humans changed, accepted discrepancies needing acknowledgement, approve / send back. |
| S6 | `/shipments/[id]/export` | Export | both | Preview of CSV rows (layout CF-1), download, export history. Gate explained when blocked. |
| S7 | `/reports/accuracy` | Accuracy & edit history | manager | Accuracy by field and supplier, confidence calibration, review time, edit log. |
| S8 | `/shipments/[id]/history` | Audit trail | both | Timeline of every event and field edit on the shipment. |

Every screen has designed **loading** (skeleton), **empty** and **error** states. No dead buttons: an action that can't run is disabled with a tooltip that says why (e.g. "3 issues left — export unlocks after manager approval").

### 5.2 Flows

**F1 — Create shipment and upload (S3)**
1. Executive picks importer and supplier from master lists; system assigns ref `SHP-<next>`.
2. Drops files into the three slots. Each slot accepts PDF, JPEG or PNG, ≤ 4 MB, ≤ 5 pages (A-02).
3. On upload the server validates type by magic bytes, stores the original, renders each page to an image, extracts the PDF text layer if any.
4. Alternative: **Load sample set** → choose a bundled set (e.g. "SHP-24811 — weight mismatch") → files are attached as if uploaded.
5. When a slot finishes uploading, extraction starts for that document (F2). The user is taken to S4, which shows per-document progress.

**F2 — Extraction**
1. Each page image is sent to the vision model with a slot-specific schema (`API_SPECS §2`).
2. Output is validated (Zod), normalised by code (§7), scored (§8), stored, then the cross-check engine runs (§9) and shipment status is re-derived (§10).
3. Failure paths: rate limit → retry with backoff → fallback model → recorded sample (only for bundled sample files) → document `FAILED` with **Retry** and **Enter manually**. A page the model reports unreadable sends the document to manual entry for that page's fields.
4. Wrong document in a slot (model says it looks like a packing list in the invoice slot) → blocking issue `WRONG_DOCUMENT_TYPE`; user replaces the file or confirms "Keep as Invoice".

**F3 — Review and resolve (S4)**
1. Issues panel lists blocking items first: failed checks (crimson), low-confidence fields (amber), missing required fields, incomplete checks.
2. Selecting a field or issue highlights its source on the document (page + box) and switches the viewer tab.
3. Field actions: **Confirm** (AI value is right) · **Correct** (AI misread — type what the document actually says) · **Enter** (value missing / unreadable).
4. Check actions for a `FAIL`, when the documents genuinely disagree:
   - **Accept discrepancy** — choose the value to declare for filing + reason (≥ 10 chars). Manager must acknowledge it at approval.
   - **Query importer** — write a message; a mock notification is stored; shipment goes `ON_HOLD`.
5. Check action for `INCOMPLETE`: enter the missing value, or **Acknowledge not on document** + note.
6. When the unresolved count reaches 0, **Submit for approval** enables.

> Rule of thumb shown in the UI: *Correct = the AI misread the document. If the document itself is wrong, use Accept discrepancy or Query importer.* This keeps AI accuracy numbers honest (§8.3).

**F4 — Approve (S5)** Manager sees: unresolved count (must be 0), list of corrected fields (AI value → human value), manual entries, accepted discrepancies with declared values and reasons (each needs a tick), mode badges (Live / Recorded sample / Manual). Approve or Send back (note required). Approver ≠ submitter (A-14).

**F5 — Export (S6)** Only `APPROVED` shipments with 0 unresolved issues. Server re-checks the gate inside a transaction, builds CSV layout CF-1, stores it, logs it, status → `EXPORTED`. Re-download of a past export file is allowed; a new export needs reopen + re-approval.

**F6 — Hold and resume** `Query importer` → `ON_HOLD`. Edits are allowed while on hold. **Resume** (note required) re-derives status.

**F7 — Unreadable page → manual entry** Model reports `pageReadable=false`, or user clicks **Mark page unreadable**. Fields sourced from that page are cleared (confidence 0) and become blocking; whatever the user types is recorded as a manual entry, not an AI correction. If a table was on that page, the user adds line rows by hand. Document mode becomes `MANUAL` if no AI values remain.

**F8 — Reopen** Manager reopens an `APPROVED` or `EXPORTED` shipment with a reason (e.g. amendment). Status is re-derived; previous exports stay in history.

## 6. Field catalogue

`R` required · `O` optional · `—` not extracted for that document. Keys are identical in the AI schema, the DB (`field_key`) and the engine.

### 6.1 Header fields

| Key | Label | Kind | INV | PL | BL | Notes |
|---|---|---|---|---|---|---|
| `supplierName` | Supplier / Shipper | TEXT | R | O | R | BL label: "Shipper" |
| `importerName` | Buyer / Importer | TEXT | R | — | — | |
| `consigneeName` | Consignee | TEXT | O | O | R | |
| `invoiceNumber` | Invoice no. | IDENTIFIER | R | O | — | PL value is a reference (CC-08) |
| `invoiceDate` | Invoice date | DATE | R | — | — | |
| `currency` | Currency | CURRENCY | R | — | — | ISO 4217 |
| `incoterm` | Incoterm | INCOTERM | R | — | — | Incoterms 2020 |
| `invoiceTotal` | Invoice total | MONEY | R | — | — | |
| `totalPackages` | Total packages | INTEGER | O | R | R | |
| `grossWeight` | Gross weight (kg) | WEIGHT | O | R | R | normalised to kg |
| `netWeight` | Net weight (kg) | WEIGHT | O | R | O | normalised to kg |
| `containerNumbers` | Container no(s). | CONTAINER_LIST | O | O | R | ISO 6346 |
| `blNumber` | B/L no. | IDENTIFIER | — | — | R | |
| `portOfLoading` | Port of loading | TEXT | — | — | O | display only |
| `portOfDischarge` | Port of discharge | TEXT | — | — | O | display only |

### 6.2 Line-item fields (per row)

| Key | Label | Kind | INV | PL |
|---|---|---|---|---|
| `description` | Description | TEXT | R | R |
| `hsCode` | HSN / HS code | HS_CODE | O (A-11) | — |
| `quantity` | Quantity | DECIMAL | R | R |
| `unit` | Unit | UNIT | O | O |
| `unitPrice` | Unit price | MONEY | R | — |
| `lineTotal` | Line total | MONEY | R | — |

An invoice must have ≥ 1 line item. If none were extracted, CC-02 is `INCOMPLETE` ("No line items") and can only be cleared by adding lines by hand — it cannot be acknowledged, because the export needs at least one row.

## 7. Normalisation — "the model reads, code interprets"

The model returns text **exactly as printed**. All conversion happens in pure, unit-tested TypeScript (`src/domain/normalize/*`). The stored `value` is canonical; `rawText` keeps what was printed.

| Kind | Canonical form | Rules |
|---|---|---|
| MONEY, DECIMAL | `"16320.00"` (dot decimal, no grouping, printed precision kept) | Decimal separator detected **per document** from all numeric texts (A-09). `1.460,00` → `1460.00`. A lone `1,460` on a comma-decimal document is ambiguous → flag. If no number on the document settles the separator (only integers and lone `1,460`/`1.460` shapes, or a tied vote), the document has none: every lone separator + 3 digits on it is ambiguous → flag (read dot-decimal). A value whose own punctuation contradicts its document (`6.80` on a comma-decimal document) → flag. Spaces and apostrophes group thousands. Currency symbols/codes stripped. Never JS floats — `decimal.js`. |
| WEIGHT | kg, 3 dp: `"3120.000"` | Units (whole words, any case, plurals and long forms accepted): KG/KGS/KGM/K.G./KILOS/KILOGRAMS ×1; LB/LBS/POUNDS ×0.45359237; MT/TON/TONNE ×1000; rounded half-up to 3 dp. No unit found → assume kg + flag `unitAssumed`. |
| INTEGER | `"240"` | First integer in text (`240 CTNS` → 240). A count has no fraction, so a lone `1,200`/`1.200` groups thousands on any document; `240.00` → 240; `12.5` or a negative → invalid. |
| DATE | ISO `"2026-10-14"` | DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, `14 Oct 2026`, `Oct 14, 2026`. Also `.` separators, `YYYY/MM/DD`, full month names and ordinals (`14th October 2026`). Both parts ≤ 12 → DD/MM unless supplier country is US (MM/DD); flag `ambiguousDate` (A-10) only when both readings are real, different days (`05/05/2026` is not ambiguous). |
| CURRENCY | ISO 4217 | `US$`/`$`→USD, `€`→EUR, `RMB`/`¥` on a CN supplier→CNY, `¥` on JP supplier→JPY; `RMB`→CNY on any supplier; `£`→GBP, `₹`→INR; `HK$`/`S$`/`A$`/`C$`/`NZ$` → their dollars; words `US Dollars`/`Euro`; active ISO 4217 codes as printed (fund, metal and test codes excluded); unknown → invalid. |
| INCOTERM | 3-letter code | One of EXW FCA CPT CIP DAP DPU DDP FAS FOB CFR CIF; `C&F`/`CNF`→CFR. Named place kept in `rawText`. |
| HS_CODE | digits only | Strip dots/spaces; valid if 6–10 digits. No classification (non-goal). |
| CONTAINER_LIST | `"XZQU4821171\|KQZU2073199"` sorted, uppercase | Each must match `^[A-Z]{3}[UJZ]\d{7}$` **and** pass the ISO 6346 check digit. Spaces/dashes inside a number are removed; duplicates dropped. Invalid numbers stay in the list, flagged, so CC-07 can show them. |
| IDENTIFIER | trimmed, inner spaces collapsed, uppercase for comparison | |
| TEXT | trimmed, whitespace collapsed; spaces between two Chinese or Japanese characters removed (those scripts don't space words; Korean does and is left alone) | A model reading a bilingual invoice may insert such a space |
| UNIT | uppercase; mapped to UQC where known (PCS, NOS, SET, KGS, MTR, PRS) | Unknown kept as printed (A-21). |

## 8. Confidence policy

### 8.1 Final confidence
`final = min(modelConfidence, every cap that applies)`, rounded to 3 dp. Deterministic; constants live in `src/domain/confidence.ts`.

| Signal | Cap |
|---|---|
| Value fails its format validator (bad date, unknown currency, container check digit wrong, HS not 6–10 digits) | 0.40 |
| Required field missing (`text` null) | 0.00 |
| Source page marked unreadable (by the model or a user) — value is cleared | 0.00 |
| Ambiguous parse (number separator or date order) | 0.60 |
| Digital PDF and the value is **not found** in the page's text layer | 0.70 |
| Unit assumed (weight printed without a unit) | 0.80 |
| Page flagged `BLURRY`, `CUT_OFF` or `LOW_CONTRAST` by the model | 0.80 |
| Scan / image (no text layer to verify against) | 0.95 |

Each field stores its `confidenceSignals` so the UI can say *why*: "Model 0.97 · not found in PDF text → 0.70".

### 8.2 Review threshold
`needsReview = final < 0.85` (A-03). Fields below threshold are **amber** and blocking until a human confirms, corrects or enters them. Fields ≥ 0.85 are not blocking but still editable.

### 8.3 What counts against AI accuracy
Only `CORRECT` edits on AI-extracted fields (the AI misread). Manual entries, accepted discrepancies and confirmations do not count as errors. Accuracy is computed on `APPROVED`/`EXPORTED` shipments with `LIVE` extraction (recorded samples can be toggled in).

## 9. Cross-check rules (deterministic engine)

Pure functions over a shipment snapshot (`ARCHITECTURE §6`). Tolerances are in `src/domain/checks/config.ts` (A-04).

| ID | Name | Compares | Pass when | Scope |
|---|---|---|---|---|
| CC-01 | LINE_TOTALS | each INV line: `quantity × unitPrice` vs `lineTotal` | \|Δ\| ≤ 0.01 | one result per line (`line:<n>`) |
| CC-02 | INVOICE_TOTAL | Σ round₂(`quantity × unitPrice`) vs INV `invoiceTotal` | \|Δ\| ≤ 0.01 | shipment |
| CC-03 | GROSS_WEIGHT | `grossWeight` on INV, PL, BL (kg) | max − min ≤ 0.5 kg | shipment |
| CC-04 | NET_WEIGHT | `netWeight` on INV, PL, BL (kg) | max − min ≤ 0.5 kg | shipment |
| CC-05 | PACKAGE_COUNT | `totalPackages` on INV, PL, BL | all equal | shipment |
| CC-06 | LINE_ITEM_MATCH | INV lines ↔ PL lines | every line matched; quantities equal; units equal when both present | per INV line + one per unmatched PL line |
| CC-07 | CONTAINER_NUMBERS | `containerNumbers` PL vs BL (and INV if present) | same set; every number passes ISO 6346 (checked even when only one document states containers) | shipment |
| CC-08 | INVOICE_REFERENCE | PL `invoiceNumber` vs INV `invoiceNumber` | equal after normalisation | shipment |

CC-01…CC-06 are the brief's required checks. CC-07 and CC-08 are cheap extra depth.

**Result statuses**

| Status | Meaning | Blocking? | Severity |
|---|---|---|---|
| `PASS` | Values agree within tolerance | no | INFO |
| `FAIL` | Values disagree | **yes**, until `DISCREPANCY_ACCEPTED` (or values corrected) | CRITICAL (crimson) |
| `INCOMPLETE` | A value **required** on a document (§6) is missing, so the check cannot run fully | **yes**, until value entered or `ACKNOWLEDGED_MISSING` | WARNING |
| `NOT_APPLICABLE` | Fewer than two documents carry an **optional** value | no | INFO (greyed) |

Rules run on the values present; e.g. CC-03 with no invoice gross weight compares PL vs BL and notes "Invoice: not stated".

**CC-06 matching algorithm.** Normalise descriptions (uppercase, punctuation to spaces, collapse spaces) → token Jaccard similarity, computed as an exact decimal; HS code equality adds +0.2 when both lines carry an HS code — packing-list lines don't extract one (§6.2), so today the bonus never applies. Greedy pairing by highest similarity ≥ 0.5 (A-12), ties broken by invoice line then packing-list line order. If no pair reaches 0.5 and both sides have the same number of lines, pair by position and add a WARNING note "matched by position". Unmatched lines on either side → `FAIL`.

**Resolution memory.** Each result has a fingerprint = hash(rule, scope, observed canonical values). A resolution survives a re-run only if the fingerprint is unchanged; if a value later changes, the check re-opens.

**Worked example — SHP-24811.** INV gross 3,120 kg; PL 3,165 kg; BL 3,165 kg (BL value is A-13). CC-03 → `FAIL`, Δ = 45.000 kg, message "Gross weight differs: Invoice 3,120.000 kg vs Packing list 3,165.000 kg, Bill of lading 3,165.000 kg". Export is blocked.

## 10. Blocking issues, gates and statuses

### 10.1 Blocking issues
`unresolvedIssuesCount` = number of items from `computeBlockingIssues(snapshot)`:

| Type | Raised when |
|---|---|
| `DOCUMENT_MISSING` | one of the three slots has no current document |
| `DOCUMENT_NOT_READY` | document is `UPLOADED`, `EXTRACTING` or `FAILED` |
| `WRONG_DOCUMENT_TYPE` | model's detected type ≠ slot type and not dismissed |
| `FIELD_NEEDS_REVIEW` | field `UNREVIEWED` with final confidence < 0.85 (includes required-but-missing; an optional field the document does not print never blocks) |
| `CHECK_FAILED` | check `FAIL` without `DISCREPANCY_ACCEPTED` |
| `CHECK_INCOMPLETE` | check `INCOMPLETE` without `ACKNOWLEDGED_MISSING` |
| `IMPORTER_QUERY_OPEN` | shipment `ON_HOLD` |

### 10.2 Status machine

```
            upload/extract                      all 3 docs ready
  DRAFT ──────────────────► EXTRACTING ─────────────┬──► NEEDS_REVIEW (issues > 0)
    ▲                                               └──► EXTRACTED    (issues = 0)
    │ (derived)                                             │ submit (issues = 0)
    │                                                       ▼
    │                                            READY_FOR_APPROVAL
    │     any data change ◄──────────────────────────┤  │ approve (manager, ≠ submitter, issues = 0)
    │     (approval invalidated, re-derive)           │  ▼
    │                                                 │ APPROVED ──export (gate)──► EXPORTED
    │                                                 │    ▲                          │
    │  send back (note) ◄─────────────────────────────┘    └──── reopen (manager) ────┘
    │
 ON_HOLD ◄── query importer (from NEEDS_REVIEW / EXTRACTED) ── resume (note) ──► re-derive
```

- **Derived states** (`DRAFT`, `EXTRACTING`, `NEEDS_REVIEW`, `EXTRACTED`) are always computed by `deriveReviewStatus()`; never set by hand.
- **Human states** (`READY_FOR_APPROVAL`, `APPROVED`, `EXPORTED`, `ON_HOLD`) change only through the named actions.
- Any data change (field edit, check resolution, upload, re-extract) while `READY_FOR_APPROVAL` or `APPROVED` re-derives status and logs `APPROVAL_INVALIDATED`.
- `EXPORTED` shipments are read-only until reopened. Reopen (manager, from `APPROVED` or `EXPORTED`, F8) re-derives the status; a new export then needs submit and approval again.

### 10.3 Hard gates (enforced on the server, mirrored in the UI)
1. **Submit** requires `unresolvedIssuesCount = 0` and status `EXTRACTED`.
2. **Approve** requires manager role, status `READY_FOR_APPROVAL`, `unresolvedIssuesCount = 0`, approver ≠ submitter, every accepted discrepancy acknowledged.
3. **Export** requires status `APPROVED`, `unresolvedIssuesCount = 0` recomputed inside the export transaction, and an approval newer than the last data change. Otherwise `409 EXPORT_BLOCKED` with the list of reasons. Re-downloading an earlier export file is always allowed (files are immutable).

## 11. Roles and permissions

| Action | Executive | Manager |
|---|---|---|
| View shipments, documents, history | ✓ | ✓ |
| Create shipment, upload, run/re-run extraction | ✓ | ✓ |
| Confirm / correct / enter fields, resolve checks, query importer, resume | ✓ | ✓ |
| Submit for approval | ✓ | ✓ |
| Approve / send back | — | ✓ (not own submission) |
| Export approved shipment, re-download | ✓ | ✓ |
| Reopen approved/exported shipment | — | ✓ |
| Accuracy report (S7) | — | ✓ |
| Reveal importer contact (masked by default; every reveal logged) | ✓ | ✓ |

## 12. Export (summary)
Layout **CF-1** (invented, A-06): one CSV row per invoice line, header values repeated; UTF-8 with BOM, CRLF, RFC 4180 quoting, formula-injection guard. Value sources follow precedence A-05 unless a check resolution declared a value. Full spec: `API_SPECS §6`.

## 13. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | Money/weights use `decimal.js`; the engine is pure and deterministic (same snapshot → same results); engine version stored with results. |
| Performance | List: < 1 s for 500 shipments (25/page). Extraction target p50 < 60 s for a 1-page document on the hosted API (measured, not promised). Review actions feel instant (optimistic UI, < 200 ms). |
| Reliability | No lost edits: versioned writes, `409 VERSION_CONFLICT` with the current value. Extraction retries; a document stuck `EXTRACTING` > 5 min is treated as failed and can be retried. |
| Security | Role checks in every server action/route; Zod on every input; file magic-byte checks; no secrets in the repo; security headers; documents treated as untrusted input to the model (prompt-injection safe: model output is only ever data). |
| Privacy (DPDP Act 2023) | Data minimisation (no contact persons/phones/emails extracted); importer contacts masked; reveal logged; India hosting (Vercel `bom1`, Supabase `ap-south-1`); no PII or document text in logs; retention policy A-17. |
| Accessibility | WCAG 2.2 AA contrast; colour is never the only signal (icon + text label on every badge); full keyboard operation of S4; visible focus. |
| Responsive | Desktop-first (brief: desktop use). At ≥ 360 px: S2, S5, S6, S7, S8 fully usable; S4 collapses into tabs Document / Fields / Issues. |
| Design | Minimal, restrained palette (zinc neutrals); colour only for state: amber = low confidence, crimson = mismatch, emerald = verified. `tabular-nums` on every number, code and weight. |

## 14. Assumptions register

Each is labelled in code comments as `// A-xx` where it is applied.

| ID | Assumption |
|---|---|
| A-01 | A shipment has exactly one commercial invoice, one packing list and one bill of lading. |
| A-02 | Uploads: PDF, JPEG, PNG; ≤ 4 MB per file (stays under Vercel's 4.5 MB body limit); ≤ 5 pages per document. |
| A-03 | Review threshold 0.85 on final confidence. |
| A-04 | Tolerances: money 0.01 in invoice currency; weight 0.5 kg absolute; packages and quantities exact. |
| A-05 | Export precedence: gross weight & packages BL > PL > INV; net weight PL > INV > BL; containers BL > PL > INV; invoice-level fields from INV. A declared value from an accepted discrepancy overrides. |
| A-06 | The filing software's import layout was not provided; CF-1 (CSV) is invented and must be swapped for the client's template. The brief's must-have says Excel; the core build says CSV, which this slice delivers. |
| A-07 | Only party names are extracted; addresses, contact persons, phones and emails are not (data minimisation). |
| A-08 | Importer contact details are entered by staff in the importer master (seeded with fake data) and masked by default. |
| A-09 | Number format is detected per document; anything ambiguous goes to review. |
| A-10 | Dates default to DD/MM; MM/DD only for US suppliers; ambiguous dates go to review. |
| A-11 | HS code is optional on supplier invoices and only format-validated (6–10 digits). |
| A-12 | Line items match when description token similarity ≥ 0.5 (HS code match adds 0.2 when both sides carry one; packing lists currently don't). |
| A-13 | Seed data: from the brief come only SHP-24811 (invoice line, invoice gross 3,120 kg, packing-list gross 3,165 kg) and SHP-24812 (invoice line, invoice gross 1,460 kg). Everything else — BL weight 3,165 kg, SHP-24812's PL/BL values, packages, net weights, container numbers, invoice numbers, dates, importers and shipments SHP-24813…SHP-24819 — is invented. |
| A-14 | Four-eyes: the manager who approves cannot be the user who submitted. |
| A-15 | Display: en-IN number grouping; times in Asia/Kolkata; storage in UTC. Values typed on screen use "." as the decimal mark. |
| A-16 | The demo uses NVIDIA's hosted API (trial terms: prototyping only, not production). Only synthetic documents are processed. Production self-hosts the same model as an NVIDIA NIM in an India region, so client data never reaches a provider that could train on it. |
| A-17 | Retention: documents purged 180 days after export (policy documented; purge job not built in this slice). |
| A-18 | Executives upload on behalf of importers (no email intake, no importer portal). |
| A-19 | Supplier is chosen at shipment creation from a master list; the extracted supplier name is shown, not matched. |
| A-20 | One currency per invoice. |
| A-21 | Unit → UQC mapping covers common units only; unknown units are exported as printed. |
| A-22 | Review time = first open of S4 → submit. |
| A-23 | Re-uploading a slot supersedes the previous document (kept for audit, hidden from review). |
| A-24 | Demo users are seeded; no self sign-up; password reset out of scope. |
| A-25 | ≤ 100 line items per invoice. |

## 15. Non-goals (explicitly out of scope)

- Filing on the customs portal (ICEGATE) or generating a Bill of Entry.
- HSN classification or duty calculation.
- Customer/importer tracking portal; importer log-in.
- Live WhatsApp, SMS or email; payments. (Importer query is a stored mock notification.)
- Email intake of documents; multi-invoice or consolidated shipments.
- Model training or fine-tuning.
- XLSX export (CSV only in this slice — next step).
- Multi-tenant / multi-branch setup; native mobile app; offline mode.

## 16. Open questions for the client

1. Exact import template of the filing software (columns, formats) — replaces CF-1.
2. Weight tolerance policy: is any difference a query, or is rounding allowed?
3. Which document wins when values differ and the importer can't be reached?
4. Document retention period and who may delete.
5. Share of scans vs digital PDFs; languages other than English/Chinese.
6. Should supplier HS codes be carried into filing or always re-entered?

## 17. Decisions that differ from the starting brief

| Starting brief said | Decision | Why |
|---|---|---|
| Next.js 15 | Next.js 16 | Current major; 15 is behind. |
| Gemini / Claude vision | NVIDIA API (Nemotron vision models) | Builder's available key. Compliance caveat A-16. |
| "Zero-data-retention API headers" | Provider terms + self-hosted NIM path | No such standard header exists; retention is a contract/deployment property. |
| Statuses DRAFT, EXTRACTED, NEEDS_REVIEW, READY_FOR_APPROVAL, APPROVED, EXPORTED | Added `EXTRACTING` and `ON_HOLD`; `EXTRACTED` means "clean, awaiting submission" | Progress needs a state; importer queries need a hold. |
| Mismatches fixed by editing fields | Field edits fix misreads; discrepancies are accepted or queried | Editing a field to hide a real document conflict would falsify the record and the accuracy report. |
| `react-pdf` viewer | Server-rendered page images for every format | One viewer for PDFs and scans; boxes share one coordinate space. |
| CSV/Excel export | CSV only | Core build names CSV; XLSX is next. |

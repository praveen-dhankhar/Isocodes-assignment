# ARCHITECTURE — Customs Document Extraction & Cross-Check

> Version 1.0 · 2026-11-05. Companion to `PRD.md` (what) and `API_SPECS.md` (contracts). This file is *how*.

---

## 1. Shape of the system

```
 Browser (desktop-first, responsive)
   │  React Server Components + client islands (review workstation)
   ▼
 Next.js 16 app on Vercel — functions pinned to bom1 (Mumbai)
   ├── proxy.ts ............ redirects signed-out users to /login (convenience, NOT the security boundary)
   ├── Server Actions ...... small mutations (confirm field, resolve check, approve) → services
   ├── Route Handlers ...... upload (multipart), extraction (long-running, maxDuration 300),
   │                         status polling, page images, CSV export
   ├── src/server/services . business logic, transactions, audit — the only code that writes the DB
   ├── src/domain .......... PURE TypeScript: normalisation, confidence, cross-checks, issues,
   │                         status machine, CSV layout. No I/O. 100% unit-tested.
   └── src/server/ai ....... ExtractionProvider port → NvidiaVisionProvider | RecordedSampleProvider
          │                                     │
          ▼                                     ▼
 Supabase (ap-south-1 Mumbai)            NVIDIA API (integrate.api.nvidia.com/v1)
   ├── Postgres 16 (Drizzle ORM)           nvidia/nemotron-3.5-super-vl-120b-a12b  (primary)
   └── Storage: private bucket `documents` nvidia/nemotron-nano-12b-v2-vl          (fallback)
```

### Why this shape
- **One deployable (Next.js full-stack).** A solo 7-day build can't afford two services, two deploys and a typed client between them. Server Actions and Route Handlers keep the API in the same type system as the UI.
- **Pure domain core.** The client's risk is a wrong number reaching the filing software. Everything that decides "is this right?" (parsing, tolerances, matching, gates) lives in `src/domain`, has no dependencies on DB/React/network, and is tested table-driven. The UI and DB are adapters around it.
- **Ports for AI and storage.** The extraction provider and blob store are interfaces, so tests use fakes, demos use recorded samples, and production can point at a self-hosted model without touching business logic.
- **Postgres, not SQLite.** Vercel functions have no persistent disk. Supabase Mumbai gives Postgres + private object storage in India (DPDP data-location requirement) on a free tier.
- **Page images instead of an in-browser PDF renderer.** Every document — PDF or phone photo — is rendered to page images on upload. The viewer, the vision model and the highlight boxes all use the same image and the same normalised coordinates.

## 2. Pinned stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS, pnpm 10 |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 `strict` + `noUncheckedIndexedAccess` |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide-react icons, Geist Sans + Geist Mono |
| Validation | Zod 4 (`z.toJSONSchema` generates the model's response schema) |
| DB | Postgres 16 · Drizzle ORM + drizzle-kit migrations · `postgres` (postgres.js) driver |
| Auth | Better Auth (email + password, sign-up disabled, `role` additional field) |
| Numbers | `decimal.js` — never JS floats for money, weights or quantities |
| PDF | `unpdf` (PDF.js) + `@napi-rs/canvas` for page rendering and text layer |
| Images | `sharp` (EXIF auto-orient, WebP for viewer, JPEG for the model) |
| Storage | Supabase Storage (prod) / local filesystem (dev, tests) behind `BlobStore` |
| AI | NVIDIA API, OpenAI-compatible chat completions, called with plain `fetch` |
| Tests | Vitest (projects: `unit`, `integration`), Playwright (e2e + sample-document generation) |
| Hosting | Vercel (Hobby, Fluid compute, region `bom1`), Supabase (`ap-south-1`) |

Exact versions are pinned (no `^`) in `package.json` at scaffold time.

## 3. Directory structure

```
.
├── CLAUDE.md                     # agent rules (read first)
├── README.md
├── docs/
│   ├── PRD.md  ARCHITECTURE.md  API_SPECS.md  PLAN.md
│   ├── TDD.md                    # submission document (written in M10)
│   └── deployment.md             # submission document (written in M10)
├── .github/workflows/ci.yml      # typecheck, lint, unit, integration (postgres service)
├── docker-compose.yml            # postgres:16 with app + test databases
├── drizzle/                      # generated SQL migrations (committed)
├── drizzle.config.ts
├── next.config.ts                # security headers, serverExternalPackages
├── vercel.json                   # { "regions": ["bom1"] }
├── vitest.config.ts              # projects: unit (src/**/*.test.ts), integration (*.int.test.ts)
├── vitest.integration-setup.ts   # migrates DATABASE_URL_TEST before integration tests
├── playwright.config.ts
├── eslint.config.mjs
├── .env.example                  # names only, no values
├── e2e/                          # Playwright: review, resolve, approve-export, smoke-mobile
├── fixtures/
│   ├── samples/
│   │   ├── manifest.json         # sha256 → { ref, docType, file } + ground-truth values
│   │   └── SHP-24811/ invoice.pdf  packing-list.pdf  bill-of-lading.pdf   (… one folder per sample)
│   └── extractions/<sha256>.json # recorded model outputs: { source, modelId, recordedAt, pages[] }
├── scripts/
│   ├── sample-data.ts            # single source of sample content + ground truth
│   ├── sample-templates.ts       # HTML templates for invoice / packing list / B/L
│   ├── generate-samples.ts       # templates → PDF (Playwright) → scan variants (sharp)
│   ├── record-fixtures.ts        # live model → fixtures/extractions
│   ├── eval-extraction.ts        # accuracy/latency of a model against manifest ground truth
│   └── db-reset.ts               # drop, migrate, seed — refuses non-localhost URLs
└── src/
    ├── proxy.ts
    ├── app/
    │   ├── layout.tsx  globals.css  error.tsx  not-found.tsx
    │   ├── (auth)/login/page.tsx
    │   ├── (app)/layout.tsx  loading.tsx
    │   ├── (app)/shipments/page.tsx                    # S2
    │   ├── (app)/shipments/new/page.tsx                # S3
    │   ├── (app)/shipments/[id]/page.tsx               # S4
    │   ├── (app)/shipments/[id]/approval/page.tsx      # S5
    │   ├── (app)/shipments/[id]/export/page.tsx        # S6
    │   ├── (app)/shipments/[id]/history/page.tsx       # S8
    │   ├── (app)/reports/accuracy/page.tsx             # S7
    │   └── api/
    │       ├── auth/[...all]/route.ts
    │       ├── shipments/[id]/documents/route.ts                 # POST upload
    │       ├── shipments/[id]/documents/[docId]/extract/route.ts # POST extract
    │       ├── shipments/[id]/status/route.ts                    # GET poll
    │       ├── shipments/[id]/export/route.ts                    # POST export (gate)
    │       ├── shipments/[id]/exports/[exportId]/route.ts        # GET re-download
    │       ├── documents/[docId]/original/route.ts               # GET original file
    │       ├── health/route.ts                                   # GET deploy smoke check (no auth, no data)
    │       └── documents/[docId]/pages/[page]/route.ts           # GET page image
    ├── components/
    │   ├── ui/                   # shadcn primitives + num.tsx, mono.tsx, state-badge.tsx
    │   ├── auth/       login-form.tsx
    │   ├── shipments/  shipment-table.tsx shipment-filters.tsx new-shipment-form.tsx upload-slot.tsx
    │   ├── review/     workstation.tsx document-viewer.tsx field-panel.tsx field-row.tsx issues-panel.tsx
    │   │               extraction-progress.tsx resolve-check-dialog.tsx query-importer-dialog.tsx
    │   │               submit-bar.tsx shortcut-help.tsx use-review-shortcuts.ts
    │   ├── approval/   approval-summary.tsx
    │   ├── export/     export-preview.tsx
    │   └── reports/    accuracy-table.tsx calibration-table.tsx
    ├── domain/                   # PURE — no I/O, no React, no DB, no Date.now(), no Math.random()
    │   ├── money.ts
    │   ├── normalize/ number.ts weight.ts date.ts currency.ts incoterm.ts codes.ts text.ts
    │   ├── fields.ts             # field registry = PRD §6
    │   ├── snapshot.ts           # ShipmentSnapshot types + Zod
    │   ├── evidence.ts           # value ↔ PDF text-layer matching
    │   ├── confidence.ts         # PRD §8 caps
    │   ├── checks/ config.ts types.ts fingerprint.ts run-checks.ts __fixtures__/snapshots.ts
    │   ├── checks/rules/ amounts.ts (CC-01,02) quantities.ts (CC-03,04,05) items.ts (CC-06) references.ts (CC-07,08)
    │   ├── issues.ts             # computeBlockingIssues
    │   ├── status.ts             # deriveReviewStatus, transitions, export gate
    │   └── export/ csv.ts (layout CF-1)  __fixtures__/SHP-24811.cf1.csv (golden file)
    ├── server/                   # every file starts with `import 'server-only'`
    │   ├── auth.ts  session.ts
    │   ├── db/ client.ts schema.ts seed.ts seed-scenarios.ts
    │   ├── storage/ index.ts local.ts supabase.ts
    │   ├── pdf/ render.ts text-layer.ts
    │   ├── uploads/validate.ts
    │   ├── ai/ provider.ts schemas.ts prompts.ts images.ts nvidia.ts sample.ts
    │   ├── services/ snapshot.ts recompute.ts shipments.ts documents.ts extraction.ts manual-entry.ts
    │   │             review.ts resolutions.ts approval.ts export.ts audit.ts
    │   ├── queries/ shipments.ts review-model.ts accuracy.ts history.ts
    │   └── actions/ shipments.ts review.ts approval.ts importers.ts
    └── lib/ env.ts errors.ts result.ts format.ts pii.ts cn.ts
```

**Layering rule:** `app` → `components` / `server/actions` → `server/services` → `domain` + `server/db`. `domain` imports nothing from the project except `domain`. ESLint `no-restricted-imports` enforces it.

## 4. Data model

### 4.1 Entity overview

```
user (Better Auth) ──< audit_logs
importers ──< shipments >── suppliers
shipments ──< documents ──< document_pages
                   └──< line_items
shipments ──< extracted_fields >── documents, line_items (nullable)
extracted_fields ──< field_edits
shipments ──< cross_check_results
shipments ──< exports
```

### 4.2 Drizzle schema (`src/server/db/schema.ts`)

Better Auth owns `user`, `session`, `account`, `verification` (generated with its CLI); we add `role` to `user`. All other tables are ours. snake_case in SQL, camelCase in TS. Timestamps are `timestamptz` in UTC.

```ts
import { pgTable, pgEnum, uuid, text, integer, boolean, numeric, jsonb, timestamp,
         bigserial, unique, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const shipmentStatus = pgEnum('shipment_status', ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW',
  'EXTRACTED', 'READY_FOR_APPROVAL', 'APPROVED', 'EXPORTED', 'ON_HOLD']);
export const docType        = pgEnum('doc_type', ['INVOICE', 'PACKING_LIST', 'BILL_OF_LADING']);
export const docStatus      = pgEnum('doc_status', ['UPLOADED', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'MANUAL']);
export const extractionMode = pgEnum('extraction_mode', ['LIVE', 'SAMPLE', 'MANUAL']);
export const fieldStatus    = pgEnum('field_status', ['UNREVIEWED', 'CONFIRMED', 'CORRECTED', 'MANUAL']);
export const editAction     = pgEnum('edit_action', ['CONFIRM', 'CORRECT', 'MANUAL_ENTRY']);
export const checkStatus    = pgEnum('check_status', ['PASS', 'FAIL', 'INCOMPLETE', 'NOT_APPLICABLE']);
export const checkSeverity  = pgEnum('check_severity', ['CRITICAL', 'WARNING', 'INFO']);
export const checkResolution = pgEnum('check_resolution', ['DISCREPANCY_ACCEPTED', 'QUERY_RAISED', 'ACKNOWLEDGED_MISSING']);

// Better Auth `user` table gets: role text NOT NULL CHECK (role IN ('DOCUMENTATION_EXECUTIVE','DOCUMENTATION_MANAGER'))

export const importers = pgTable('importers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  iec: text('iec').notNull(),                       // Importer-Exporter Code (fake in seed)
  contactName: text('contact_name'),                // PII — masked in UI
  contactEmail: text('contact_email'),              // PII — masked in UI
  contactPhone: text('contact_phone'),              // PII — masked in UI
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  countryCode: text('country_code').notNull(),      // ISO 3166-1 alpha-2
  normalizedName: text('normalized_name').notNull().unique(),
});

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: text('ref').notNull().unique(),              // SHP-24811
  importerId: uuid('importer_id').notNull().references(() => importers.id),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  status: shipmentStatus('status').notNull().default('DRAFT'),
  unresolvedIssuesCount: integer('unresolved_issues_count').notNull().default(0), // cache, rewritten by recompute
  failedCheckCount: integer('failed_check_count').notNull().default(0),           // cache for S2
  holdReason: text('hold_reason'),
  firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),            // A-22
  submittedBy: text('submitted_by'),  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedBy: text('approved_by'),    approvedAt: timestamp('approved_at', { withTimezone: true }),
  lastDataChangeAt: timestamp('last_data_change_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),                               // optimistic lock
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('shipments_status_idx').on(t.status, t.updatedAt)]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id),
  docType: docType('doc_type').notNull(),
  status: docStatus('status').notNull().default('UPLOADED'),
  mode: extractionMode('mode'),                     // null until extracted
  storageKey: text('storage_key').notNull(),        // server-generated, never user input
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),                 // also the sample-fixture key
  pageCount: integer('page_count').notNull(),
  hasTextLayer: boolean('has_text_layer').notNull(),
  detectedDocType: text('detected_doc_type'),       // from model
  wrongTypeDismissed: boolean('wrong_type_dismissed').notNull().default(false),
  modelId: text('model_id'),
  aiLatencyMs: integer('ai_latency_ms'),
  aiUsage: jsonb('ai_usage'),                       // token counts per call
  rawAiOutput: jsonb('raw_ai_output'),              // validated per-page outputs (audit); never logged
  extractionStartedAt: timestamp('extraction_started_at', { withTimezone: true }),
  extractedAt: timestamp('extracted_at', { withTimezone: true }),
  errorCode: text('error_code'),  errorMessage: text('error_message'),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),   // A-23
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // one CURRENT document per slot (superseded rows are kept for audit)
  uniqueIndex('documents_current_slot').on(t.shipmentId, t.docType).where(sql`superseded_at IS NULL`),
]);

export const documentPages = pgTable('document_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  pageNo: integer('page_no').notNull(),             // 1-based
  imageKey: text('image_key').notNull(),            // WebP for the viewer
  width: integer('width').notNull(),  height: integer('height').notNull(),
  readable: boolean('readable'),                    // null until extracted
  issues: jsonb('issues').$type<string[]>().notNull().default([]),
  textItems: jsonb('text_items'),                   // [{ str, box:{x,y,w,h} }] normalised; null for scans
}, (t) => [unique().on(t.documentId, t.pageNo)]);

export const lineItems = pgTable('line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),             // 1-based, printed order
}, (t) => [unique().on(t.documentId, t.lineNo)]);

export const extractedFields = pgTable('extracted_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  lineItemId: uuid('line_item_id').references(() => lineItems.id, { onDelete: 'cascade' }),
  fieldKey: text('field_key').notNull(),            // validated against domain/fields.ts
  rawText: text('raw_text'),                        // as printed
  value: text('value'),                             // canonical (PRD §7); null = absent
  originalAiValue: text('original_ai_value'),       // canonical AI value, immutable; null for manual
  modelConfidence: numeric('model_confidence', { precision: 4, scale: 3 }),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),  // final, after caps
  confidenceSignals: jsonb('confidence_signals'),   // { model, caps: [{ reason, cap }] }
  pageNo: integer('page_no'),
  bbox: jsonb('bbox'),                              // { x, y, w, h } normalised, or null
  status: fieldStatus('status').notNull().default('UNREVIEWED'),
  confirmedBy: text('confirmed_by'),  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
}, (t) => [
  unique('fields_slot').on(t.documentId, t.lineItemId, t.fieldKey).nullsNotDistinct(),
  index('fields_shipment_idx').on(t.shipmentId),
]);

export const fieldEdits = pgTable('field_edits', {         // append-only; powers S7 + S8
  id: uuid('id').primaryKey().defaultRandom(),
  fieldId: uuid('field_id').notNull().references(() => extractedFields.id),
  shipmentId: uuid('shipment_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),        // denormalised for per-supplier accuracy
  docType: docType('doc_type').notNull(),
  fieldKey: text('field_key').notNull(),
  action: editAction('action').notNull(),
  previousValue: text('previous_value'),  newValue: text('new_value'),
  originalAiValue: text('original_ai_value'),
  aiConfidence: numeric('ai_confidence', { precision: 4, scale: 3 }),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('edits_field_key_idx').on(t.fieldKey), index('edits_supplier_idx').on(t.supplierId)]);

export const crossCheckResults = pgTable('cross_check_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id),
  ruleId: text('rule_id').notNull(),                // 'CC-03'
  scope: text('scope').notNull(),                   // 'shipment' | 'line:2' | 'pl-line:4'
  status: checkStatus('status').notNull(),
  severity: checkSeverity('severity').notNull(),
  observed: jsonb('observed').notNull(),            // [{ docType, fieldId, value, display }]
  delta: text('delta'),                             // canonical decimal, e.g. '45.000'
  message: text('message').notNull(),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  fingerprint: text('fingerprint').notNull(),
  resolution: checkResolution('resolution'),
  declaredValue: text('declared_value'),            // DISCREPANCY_ACCEPTED only
  resolutionNote: text('resolution_note'),
  resolvedBy: text('resolved_by'),  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  acknowledgedBy: text('acknowledged_by'),          // manager tick at approval
  engineVersion: text('engine_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.shipmentId, t.ruleId, t.scope)]);

export const shipmentExports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id),
  layoutVersion: text('layout_version').notNull(),  // 'CF-1'
  storageKey: text('storage_key').notNull(),
  fileSha256: text('file_sha256').notNull(),
  rowCount: integer('row_count').notNull(),
  exportedBy: text('exported_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {           // append-only
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: text('actor_id'),                        // null = system
  action: text('action').notNull(),                 // see §4.4
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  shipmentId: uuid('shipment_id'),
  metadata: jsonb('metadata').notNull().default({}),// ids, codes, counts — never document text or PII
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_shipment_idx').on(t.shipmentId, t.createdAt)]);
```

Also: a Postgres sequence `shipment_ref_seq START 24820` for new refs (seeds use explicit refs ≤ 24819).

### 4.3 Invariants (enforced in services, covered by integration tests)
1. One current document per (shipment, slot) — DB unique constraint.
2. `extracted_fields.original_ai_value` never changes after insert.
3. Every change to `extracted_fields.value` or `status` writes one `field_edits` row in the same transaction.
4. Every write that can change checks calls `recomputeShipment(tx, shipmentId)` before commit — results, `unresolved_issues_count`, `failed_check_count`, `status`, `version` move together.
5. `audit_logs` and `field_edits` are append-only (no update/delete code paths; in production, revoke UPDATE/DELETE grants).
6. `shipments.version` increments on every mutation; mutating actions take `expectedVersion` and fail with `VERSION_CONFLICT` if stale.

### 4.4 Audit actions
`SHIPMENT_CREATED, DOCUMENT_UPLOADED, DOCUMENT_SUPERSEDED, EXTRACTION_STARTED, EXTRACTION_SUCCEEDED, EXTRACTION_FAILED, EXTRACTION_FALLBACK_USED, PAGE_MARKED_UNREADABLE, WRONG_TYPE_DISMISSED, CHECK_RESOLVED, CHECK_REOPENED, IMPORTER_QUERY_SENT (mock), HOLD_CLEARED, SUBMITTED, APPROVED, SENT_BACK, APPROVAL_INVALIDATED, EXPORTED, EXPORT_DOWNLOADED, REOPENED, PII_REVEALED, STATUS_CHANGED`. Field-level edits live in `field_edits`; S8 merges both streams.

## 5. Status machine (`src/domain/status.ts`)

```ts
type Derived = 'DRAFT' | 'EXTRACTING' | 'NEEDS_REVIEW' | 'EXTRACTED';
type Human   = 'READY_FOR_APPROVAL' | 'APPROVED' | 'EXPORTED' | 'ON_HOLD';

function deriveReviewStatus(s: ShipmentSnapshot, unresolved: number): Derived {
  const docs = SLOT_TYPES.map((t) => s.documents[t]);
  if (docs.some((d) => d?.status === 'EXTRACTING')) return 'EXTRACTING';
  if (docs.some((d) => !d || !['EXTRACTED', 'MANUAL'].includes(d.status))) return 'DRAFT';
  return unresolved > 0 ? 'NEEDS_REVIEW' : 'EXTRACTED';
}
```

`nextStatusAfterDataChange(current, derived)`: `READY_FOR_APPROVAL | APPROVED → derived` (+ `APPROVAL_INVALIDATED`), `ON_HOLD → ON_HOLD`, `EXPORTED → error INVALID_STATE` (must reopen), derived → derived.
`transition(current, action, ctx)` handles `submit | approve | sendBack | export | raiseQuery | resume | reopen` per PRD §10.2 and returns `Result<Status, DomainError>` (the domain declares the same `{ ok, data } | { ok, error }` shape as `src/lib/result.ts` and uses the API error codes). `sendBack`, `resume` and `reopen` (manager, from `APPROVED` or `EXPORTED`, PRD F8) hand back the freshly derived status. `canExport(snapshot, issues, { approvedAt, lastDataChangeAt })` returns `{ ok: true } | { ok: false, reasons: ExportBlockReason[] }`; it fails closed — with an approval but no `lastDataChangeAt`, the data counts as changed after approval.

## 6. Deterministic cross-check engine

### 6.1 Contract
```
ShipmentSnapshot ──► runCrossChecks() ──► CheckOutcome[] (+ fingerprint, carried-over resolution)
                                     └──► computeBlockingIssues(snapshot, outcomes) ──► BlockingIssue[]
```
- **Input** is a plain object built by `server/services/snapshot.ts` from DB rows: per document, header fields and line cells as `FieldRef { fieldId, value (canonical string | null), status, confidence }`, plus `priorResolutions` keyed by `(ruleId, scope)` with the fingerprint they were made against.
- **Output** is plain data; the service persists it.
- **No** clock, randomness, I/O, locale-dependent formatting, or floating point. Display strings use a fixed formatter (`en-IN`, 3 dp kg) passed in, not the runtime locale.
- `ENGINE_VERSION = 'ce-1.0.0'` is stored with results; bump it when any rule changes.

### 6.2 Types (`src/domain/checks/types.ts`)
```ts
export type RuleId = 'CC-01' | 'CC-02' | 'CC-03' | 'CC-04' | 'CC-05' | 'CC-06' | 'CC-07' | 'CC-08';
export interface ObservedValue { docType: DocType; fieldId: string | null; value: string | null; display: string }
export interface PriorResolution {
  type: CheckResolution; fingerprint: string; declaredValue: string | null;
}
export interface CheckOutcome {
  ruleId: RuleId; scope: string; status: CheckStatus; severity: CheckSeverity;
  observed: ObservedValue[]; delta: string | null; message: string; notes: string[];
  fingerprint: string;                     // set when the rule builds the outcome (checks/fingerprint.ts)
  resolution: PriorResolution | null;      // carried over only if the fingerprint is unchanged
}
export interface CheckRule { id: RuleId; name: string; run(s: ShipmentSnapshot, cfg: CheckConfig): CheckOutcome[] }
export interface CheckConfig {                       // values in checks/config.ts: '0.01', '0.5', 0.5, 0.2 (A-04, A-12)
  moneyTolerance: string; weightToleranceKg: string; descriptionMatchMin: number; hsMatchBonus: number;
}
```

### 6.3 Pipeline inside `runCrossChecks`
1. For each rule in `RULES` (fixed order CC-01 → CC-08) call `rule.run(snapshot, config)`.
2. Each rule reads canonical strings, converts with `Decimal`, compares, and emits outcomes. Rules read only documents that are `EXTRACTED` or `MANUAL`; a missing or unfinished slot is skipped because it already blocks as `DOCUMENT_MISSING` / `DOCUMENT_NOT_READY`. Shared helpers:
   - `compareAcrossDocs(fieldKey, requiredOn, tolerance)` — used by CC-03/04/05: collects values from INV/PL/BL; a required value missing → `INCOMPLETE`; < 2 values present → `NOT_APPLICABLE`; `max − min > tolerance` → `FAIL` with `delta = max − min`.
   - `matchLines(invLines, plLines, cfg)` — CC-06 greedy matcher (PRD §9).
   - `iso6346Valid(code)` — CC-07.
3. `fingerprint(outcome) = sha256(ruleId | scope | sorted docType=value pairs)` (hex, first 16 chars; display text excluded). Pure: hashing uses a bundled JS SHA-256, not `node:crypto`, so the domain stays platform-free.
4. Attach `snapshot.priorResolutions[(ruleId, scope)]` when its fingerprint equals the new one; otherwise `resolution = null` (the check re-opens).
5. Outcomes are sorted by `(severityRank, ruleId, scope)` for stable UI and snapshot tests.

### 6.4 Blocking issues (`src/domain/issues.ts`)
`computeBlockingIssues(snapshot, outcomes)` returns `BlockingIssue { type, ref: { documentId? fieldId? ruleId? checkScope? }, label }[]` per PRD §10.1, ordered as the issues panel shows them (documents, failed checks, fields to review, incomplete checks, hold). A field needs review when it is `UNREVIEWED` and its final confidence is below 0.85 or unknown. A `FAIL` counts unless `outcome.resolution?.type === 'DISCREPANCY_ACCEPTED'`; an `INCOMPLETE` counts unless it is `ACKNOWLEDGED_MISSING`. Because resolutions only carry over on an unchanged fingerprint, a changed value automatically re-blocks.

### 6.5 Testing strategy
- **Table-driven unit tests** per normaliser and rule (`*.test.ts` next to the file).
- **Named scenario tests** built from `tests`-style builders in `src/domain/checks/__fixtures__/snapshots.ts`:
  - `SHP-24811`: CC-03 `FAIL`, delta `45.000`; CC-01/02 `PASS` (2400 × 6.80 = 16,320.00); `canExport` false.
  - `SHP-24812`: European decimals (`42,50`, `7.650,00`, `1.460,00 kg`) normalise correctly; all checks `PASS`/`NOT_APPLICABLE`.
  - LBS case: PL `2,204.62 LBS` vs BL `1,000 KGS` → `PASS` within 0.5 kg.
  - Container `XZQU4821254` (bad check digit) → CC-07 `FAIL`.
  - CC-06 quantity 12,000 vs 10,000 → `FAIL` on `line:2`.
  - Resolution memory: accepted CC-03 stays resolved on re-run; reopens when PL value changes.
- **Property tests** (`fast-check`) for `parseDecimal` round-trips and `iso6346Valid` against a reference implementation.
- Coverage gate for `src/domain`: 95% lines (Vitest `coverage.thresholds` on that path).

## 7. Extraction pipeline

### 7.1 Upload (Route Handler, `maxDuration = 60`)
```
POST /api/shipments/:id/documents (multipart: docType, file)
 1. requireUser → load shipment (not EXPORTED) → validate docType
 2. validateUpload: size ≤ 4 MB, magic bytes ∈ {%PDF-, PNG, JPEG}, page count ≤ 5           (A-02)
 3. sha256; store original  → shipments/{sid}/{docId}/original.{ext}
 4. render pages: PDF → unpdf/PDF.js + @napi-rs/canvas @ ~1800 px long edge; image → sharp auto-orient
    → WebP q80 → shipments/{sid}/{docId}/page-{n}.webp; PDF text layer → textItems (normalised boxes)
 5. tx: supersede current slot doc (A-23) · insert document + pages · recompute · audit DOCUMENT_UPLOADED
```

### 7.2 Extract (Route Handler, `maxDuration = 300`)
```
POST /api/shipments/:id/documents/:docId/extract  { force?, discardHumanEdits? }
 1. Claim: UPDATE documents SET status='EXTRACTING', extraction_started_at=now()
           WHERE id=$1 AND (status IN ('UPLOADED','FAILED')
                 OR (status='EXTRACTING' AND extraction_started_at < now() - interval '5 minutes')
                 OR ($force AND status IN ('EXTRACTED','MANUAL')))
           RETURNING *;          → 0 rows ⇒ 409 INVALID_STATE (already running / done)
    If re-extracting and any field has status ≠ UNREVIEWED and !discardHumanEdits ⇒ 409 HUMAN_EDITS_EXIST
 2. provider = selectProvider(env, document.sha256)                                 (§8)
 3. For each page (sequential; global in-process limit of 2 concurrent model calls):
      image = toModelJpeg(pageImage)      // ≤ 1536 px long edge, ≤ 180 KB base64, quality/scale step-down
      out   = provider.extractPage({ slot, pageNo, pageCount, image })  → validated PageExtraction (API_SPECS §2)
 4. merge pages: header field = highest-confidence non-null across pages; line items concatenated in page
    order, renumbered 1..n; detectedDocumentType = first page's
 5. normalise (domain/normalize) → evidence (domain/evidence, digital PDFs only) → confidence caps (domain/confidence)
 6. tx: delete old fields/lines for doc · insert line_items + extracted_fields · update document
        (status EXTRACTED | MANUAL, mode, modelId, latency, usage, rawAiOutput, page readability)
        · recomputeShipment · audit EXTRACTION_SUCCEEDED
    on error: document FAILED + errorCode · recompute · audit EXTRACTION_FAILED
 7. Respond with the document + shipment status summary (client also polls GET /status every 2 s)
```
The whole per-document budget is 240 s (below the 300 s function limit); exceeding it fails with `AI_TIMEOUT`.

### 7.3 Evidence matching (`src/domain/evidence.ts`)
For digital PDFs only. `findEvidence(kind, rawText, textItems, separator)` looks for the value **as printed** (`rawText`), not the canonical value, so `14/10/2026`, `US$` or `2,204.62 LBS` are found as they appear:
- numeric kinds: the printed number vs every numeric token in the text layer, both parsed with the document's separator convention; match = `Decimal.eq`.
- everything else: case- and whitespace-insensitive substring match, first within one text item, then across the page.
- containers: every container in the list must appear (spaces and dashes ignored).
Returns `FOUND (box)` | `NOT_FOUND` | `NO_TEXT_LAYER`. When `FOUND` within one item, the text-layer box replaces the model's box (more reliable for highlighting); a match spanning items keeps the model's box.

### 7.4 Confidence (`src/domain/confidence.ts`)
`applyConfidencePolicy(modelConfidence, facts) → { final, signals: { model, caps[], evidence } }` implementing PRD §8 exactly; `facts` says whether a value exists, is required, passed its format check, parsed ambiguously, had its unit assumed, its evidence result and its page's readability/issues. `CONFIDENCE_CAPS` and `REVIEW_THRESHOLD` are exported for the UI legend.

### 7.5 Recompute (`src/server/services/recompute.ts`)
```
recomputeShipment(tx, shipmentId):
  snap     = loadSnapshot(tx, shipmentId)                  // SELECT … FOR UPDATE on shipments row
  outcomes = runCrossChecks(snap, CHECK_CONFIG)            // resolutions carried over by fingerprint
  upsert outcomes by (ruleId, scope); delete results no longer emitted;
  where a stored resolution did not carry over → clear it + audit CHECK_REOPENED
  issues   = computeBlockingIssues(snap, outcomes)
  next     = nextStatusAfterDataChange(snap.status, deriveReviewStatus(snap, issues.length))
  update shipments set status, unresolved_issues_count, failed_check_count,
         last_data_change_at = now(), version = version + 1
         (+ approved_by/approved_at = null when the approval was invalidated)
  audit STATUS_CHANGED / APPROVAL_INVALIDATED when relevant
```
`failed_check_count` counts every `FAIL`, accepted or not (S2 shows mismatches). An `EXPORTED` shipment makes `nextStatusAfterDataChange` fail, so recompute throws `INVALID_STATE` and the caller's transaction rolls back — exported data stays read-only until a manager reopens it.

## 8. Dual-mode AI extraction

### 8.1 Port
```ts
interface ExtractionProvider {
  readonly mode: 'LIVE' | 'SAMPLE';
  readonly modelId: string;
  extractPage(input: PageInput): Promise<Result<PageExtraction, AiError>>;
}
type AiError = { code: 'AI_UNAVAILABLE' | 'AI_RATE_LIMITED' | 'AI_INVALID_OUTPUT' | 'AI_TIMEOUT' | 'AI_NOT_CONFIGURED'; retryable: boolean; message: string };
```

### 8.2 Providers
| Provider | When | Behaviour |
|---|---|---|
| `NvidiaVisionProvider(primary)` | `NVIDIA_API_KEY` set and mode ≠ `sample` | `nvidia/nemotron-3.5-super-vl-120b-a12b`; `response_format: json_schema`; `reasoning_effort: "none"`; `stream: false`; temperature 0. |
| `NvidiaVisionProvider(fallback)` | primary failed with a retryable error or invalid output | `nvidia/nemotron-nano-12b-v2-vl` (document-intelligence model trained on invoices); hosted API lists no `response_format`, so the JSON schema goes in the prompt with `/no_think`; output still Zod-validated. English-only per its model card — a known risk for bilingual invoices. |
| `RecordedSampleProvider` | key missing, mode `sample`, or both live models failed — **and** the file's sha256 is in `fixtures/extractions/` | Returns the recorded per-page output. Document `mode = SAMPLE`; UI shows "Recorded sample extraction" badge with model id and recording date. |
| none | unknown file and no live model | Document `FAILED` with `AI_NOT_CONFIGURED` / last error → **Retry** and **Enter manually**. Never fabricate values for unknown files. |

`EXTRACTION_MODE` env: `auto` (default; order above), `live` (no sample fallback — used to prove the AI is real), `sample` (no network; used in CI and e2e).

### 8.3 Live call resilience (`src/server/ai/nvidia.ts`)
- `fetch` with `AbortController` timeout 90 s per call.
- `429` → honour `Retry-After`, else backoff 2 s → 4 s → 8 s (max 3 attempts), then `AI_RATE_LIMITED`. Free tier is rate-limited (~40 requests/min reported, model- and traffic-dependent); one 3-document shipment is 3–6 calls.
- `5xx` / network → same backoff, then `AI_UNAVAILABLE`.
- `202 Accepted` → poll the NVCF status endpoint with the request id from the response headers every 2 s until 200 or the call deadline. Verify the exact header/URL on the model's API reference page in M5.
- `finish_reason === 'length'` → retry once with doubled `max_tokens`.
- JSON parse/Zod failure → one **repair** call (previous output + Zod issues, text only) → else `AI_INVALID_OUTPUT`.
- Every call records `{ model, latencyMs, promptTokens, completionTokens, attempt }` into `documents.ai_usage`.

### 8.4 Fixtures are real model output
`pnpm fixtures:record` runs the live provider over every bundled sample and writes `fixtures/extractions/<sha256>.json` with `source: "recorded"`, `modelId`, `recordedAt`. Until M6 the seed uses `source: "hand-authored"` files generated from `scripts/sample-data.ts`; the badge shows which. This keeps the demo working without a key while never pretending a hand-written value came from the model.

### 8.5 Model choice is measured, not assumed
`pnpm eval:extraction` runs a model over the labelled samples and prints per-field accuracy, JSON-validity rate and p50/p95 latency. Results and the final primary/fallback choice are recorded in `docs/TDD.md`.

## 9. Security and privacy architecture

| Layer | Control |
|---|---|
| Identity | Better Auth email/password; sign-up disabled; httpOnly, Secure, SameSite=Lax cookies; built-in login rate limiting with counters in Postgres (`rate_limit` table) so limits hold across serverless instances; `role` is an `input: false` field, so no auth endpoint can set it. |
| Authorisation | `requireUser()` / `requireRole(role)` at the top of every Server Action and Route Handler; resource ownership is org-wide (single tenant). `proxy.ts` only redirects; it is not trusted. |
| Supabase Data API | Every `public` table has RLS enabled with no policies (`drizzle/0002_rls.sql`), so the `anon`/`authenticated` roles read nothing through PostgREST. The app connects as `postgres` (BYPASSRLS) and is unaffected. New tables must enable RLS in their migration. |
| Input | Zod on every action/route input; uploads checked by magic bytes, size, page count; filenames never used in storage keys; route params validated as UUIDs. |
| Model output | Treated as untrusted data: Zod-validated, length-capped, normalised by code; never rendered as HTML; never used to choose code paths beyond documented fields. Prompt tells the model to ignore instructions inside documents; even if it obeys one, cross-checks and human review catch the result. |
| Output | CSV formula-injection guard; React escaping; no `dangerouslySetInnerHTML`. |
| Transport/headers | HTTPS (Vercel); CSP (`default-src 'self'; img-src 'self' blob: data:; connect-src 'self'`), `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy` minimal — in `next.config.ts`. |
| Secrets | Only in Vercel/Supabase env; `.env.example` lists names; `.env*` git-ignored; CI runs a gitleaks secret scan over the full git history (pinned release binary, checksum-verified). Supabase service-role key is server-only. |
| PII (DPDP Act 2023) | Minimisation (A-07); importer contacts masked (`r•••@example.test`, `+91 ••••• ••321`) with explicit reveal → `PII_REVEALED` audit; no document text, AI output or PII in logs (structured logs carry ids/codes only); storage bucket private, files streamed through authorised routes. |
| Residency | App functions `bom1` (Mumbai), DB + storage `ap-south-1` (Mumbai). Demo model calls go to NVIDIA's hosted API (global) with synthetic data only (A-16); production swaps `NVIDIA_BASE_URL` to a self-hosted NIM in an India region. |

## 10. Deployment topology

| Environment | App | DB / storage | AI |
|---|---|---|---|
| Local | `pnpm dev` | docker-compose Postgres; local filesystem `./.data` | live if key, else recorded samples |
| CI | Vitest + Playwright | Postgres service container | `EXTRACTION_MODE=sample` |
| Production demo | Vercel Hobby, Fluid compute, `regions: ["bom1"]` | Supabase `ap-south-1`: Postgres via the transaction pooler (postgres.js `prepare: false`), Storage bucket `documents` (private) | NVIDIA hosted API |

`next.config.ts`: `serverExternalPackages: ['@napi-rs/canvas', 'sharp']`; page-render and extract routes run on the Node.js runtime. The upload and extract routes are deployed and exercised in M4/M5 to prove native packages work on Vercel before the UI is built.

## 11. Frontend architecture (review workstation)

- `page.tsx` (server) loads `getReviewModel(shipmentId)` — documents, pages, fields grouped by section, checks, issues, user role — and marks `firstOpenedAt` once.
- `<Workstation>` (client) owns selection state: `{ docType, pageNo, focusedFieldId | focusedIssueKey, zoom, rotation }`. Selecting a field or issue sets the viewer tab/page and draws the box.
- Mutations call Server Actions with `expectedVersion`; `useOptimistic` for confirm; on `VERSION_CONFLICT` show a toast and `router.refresh()`.
- While any document is `EXTRACTING`, poll `GET /api/shipments/:id/status` every 2 s and refresh when it changes.
- Layout: ≥ 1024 px two panes (document 55% / panel 45%); < 768 px tabs **Document · Fields · Issues**.
- Keyboard: `J`/`K` next/previous item needing review · `Enter` confirm · `E` edit · `Esc` cancel · `1`/`2`/`3` document tabs · `+`/`−` zoom · `R` rotate 90° · `[`/`]` fine rotate ±0.5° · `?` shortcut sheet · `Ctrl/⌘+Enter` submit. Disabled while typing in an input.
- Visual language: zinc neutrals; amber only for low confidence, crimson (red-700 on red-50) only for mismatches, emerald only for verified; every badge = icon + text; all numbers, codes and weights through `<Num>` / `<Mono>` (`tabular-nums`).

## 12. Observability
Structured JSON logs (`requestId`, `userId`, `shipmentId`, `documentId`, `event`, `durationMs`, `errorCode`) — no payloads. Extraction metrics persist on `documents` (latency, tokens, model, attempts) and feed the TDD's measured numbers. Vercel runtime logs are the sink for the demo.

## 13. Trade-offs and limits (honest list for the TDD)
- In-process model concurrency limit is per function instance; under real load a queue (e.g. Postgres-backed job table or a workflow runtime) is needed.
- Hosted NVIDIA trial API is not for production and runs outside India; the production path is a self-hosted NIM.
- Self-reported model confidence is poorly calibrated; caps make it conservative, and S7's calibration table shows how well it actually tracks corrections.
- Evidence matching only works for digital PDFs; scans rely on model confidence + cross-checks.
- One invoice per shipment; ≤ 5 pages per document; CSV only.

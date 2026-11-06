import "server-only";
import { pgTable, pgEnum, pgSequence, uuid, text, integer, boolean, numeric, jsonb, timestamp,
         bigserial, bigint, check, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ARCHITECTURE §4.2. Better Auth owns user, session, account, verification (added with its CLI); we add `role` to user.
// snake_case in SQL, camelCase in TS; timestamps are timestamptz in UTC.

export const shipmentStatus = pgEnum("shipment_status", ["DRAFT", "EXTRACTING", "NEEDS_REVIEW",
  "EXTRACTED", "READY_FOR_APPROVAL", "APPROVED", "EXPORTED", "ON_HOLD"]);
export const docType        = pgEnum("doc_type", ["INVOICE", "PACKING_LIST", "BILL_OF_LADING"]);
export const docStatus      = pgEnum("doc_status", ["UPLOADED", "EXTRACTING", "EXTRACTED", "FAILED", "MANUAL"]);
export const extractionMode = pgEnum("extraction_mode", ["LIVE", "SAMPLE", "MANUAL"]);
export const fieldStatus    = pgEnum("field_status", ["UNREVIEWED", "CONFIRMED", "CORRECTED", "MANUAL"]);
export const editAction     = pgEnum("edit_action", ["CONFIRM", "CORRECT", "MANUAL_ENTRY"]);
export const checkStatus    = pgEnum("check_status", ["PASS", "FAIL", "INCOMPLETE", "NOT_APPLICABLE"]);
export const checkSeverity  = pgEnum("check_severity", ["CRITICAL", "WARNING", "INFO"]);
export const checkResolution = pgEnum("check_resolution", ["DISCREPANCY_ACCEPTED", "QUERY_RAISED", "ACKNOWLEDGED_MISSING"]);

// New shipment refs: SHP-24820 onwards (seeds use explicit refs ≤ 24819).
export const shipmentRefSeq = pgSequence("shipment_ref_seq", { startWith: 24820 });

export const importers = pgTable("importers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  iec: text("iec").notNull(),                       // Importer-Exporter Code (fake in seed)
  contactName: text("contact_name"),                // PII — masked in UI
  contactEmail: text("contact_email"),              // PII — masked in UI
  contactPhone: text("contact_phone"),              // PII — masked in UI
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull(),      // ISO 3166-1 alpha-2
  normalizedName: text("normalized_name").notNull().unique(),
});

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ref: text("ref").notNull().unique(),              // SHP-24811
  importerId: uuid("importer_id").notNull().references(() => importers.id),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: shipmentStatus("status").notNull().default("DRAFT"),
  unresolvedIssuesCount: integer("unresolved_issues_count").notNull().default(0), // cache, rewritten by recompute
  failedCheckCount: integer("failed_check_count").notNull().default(0),           // cache for S2
  holdReason: text("hold_reason"),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),            // A-22
  submittedBy: text("submitted_by"),  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: text("approved_by"),    approvedAt: timestamp("approved_at", { withTimezone: true }),
  lastDataChangeAt: timestamp("last_data_change_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),                               // optimistic lock
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("shipments_status_idx").on(t.status, t.updatedAt)]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  docType: docType("doc_type").notNull(),
  status: docStatus("status").notNull().default("UPLOADED"),
  mode: extractionMode("mode"),                     // null until extracted
  storageKey: text("storage_key").notNull(),        // server-generated, never user input
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),                 // also the sample-fixture key
  pageCount: integer("page_count").notNull(),
  hasTextLayer: boolean("has_text_layer").notNull(),
  detectedDocType: text("detected_doc_type"),       // from model
  wrongTypeDismissed: boolean("wrong_type_dismissed").notNull().default(false),
  modelId: text("model_id"),
  aiLatencyMs: integer("ai_latency_ms"),
  aiUsage: jsonb("ai_usage"),                       // token counts per call
  rawAiOutput: jsonb("raw_ai_output"),              // validated per-page outputs (audit); never logged
  extractionStartedAt: timestamp("extraction_started_at", { withTimezone: true }),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  errorCode: text("error_code"),  errorMessage: text("error_message"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),   // A-23
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // one CURRENT document per slot (superseded rows are kept for audit)
  uniqueIndex("documents_current_slot").on(t.shipmentId, t.docType).where(sql`superseded_at IS NULL`),
]);

export const documentPages = pgTable("document_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  pageNo: integer("page_no").notNull(),             // 1-based
  imageKey: text("image_key").notNull(),            // WebP for the viewer
  width: integer("width").notNull(),  height: integer("height").notNull(),
  readable: boolean("readable"),                    // null until extracted
  issues: jsonb("issues").$type<string[]>().notNull().default([]),
  textItems: jsonb("text_items"),                   // [{ str, box:{x,y,w,h} }] normalised; null for scans
}, (t) => [unique().on(t.documentId, t.pageNo)]);

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),             // 1-based, printed order
}, (t) => [unique().on(t.documentId, t.lineNo)]);

export const extractedFields = pgTable("extracted_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  lineItemId: uuid("line_item_id").references(() => lineItems.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),            // validated against domain/fields.ts
  rawText: text("raw_text"),                        // as printed
  value: text("value"),                             // canonical (PRD §7); null = absent
  originalAiValue: text("original_ai_value"),       // canonical AI value, immutable; null for manual
  modelConfidence: numeric("model_confidence", { precision: 4, scale: 3 }),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),  // final, after caps
  confidenceSignals: jsonb("confidence_signals"),   // { model, caps: [{ reason, cap }] }
  pageNo: integer("page_no"),
  bbox: jsonb("bbox"),                              // { x, y, w, h } normalised, or null
  status: fieldStatus("status").notNull().default("UNREVIEWED"),
  confirmedBy: text("confirmed_by"),  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
}, (t) => [
  unique("fields_slot").on(t.documentId, t.lineItemId, t.fieldKey).nullsNotDistinct(),
  index("fields_shipment_idx").on(t.shipmentId),
]);

export const fieldEdits = pgTable("field_edits", {         // append-only; powers S7 + S8
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable, set null: re-extraction with discardHumanEdits replaces the field rows; the edit history stays.
  fieldId: uuid("field_id").references(() => extractedFields.id, { onDelete: "set null" }),
  shipmentId: uuid("shipment_id").notNull(),
  supplierId: uuid("supplier_id").notNull(),        // denormalised for per-supplier accuracy
  docType: docType("doc_type").notNull(),
  fieldKey: text("field_key").notNull(),
  action: editAction("action").notNull(),
  previousValue: text("previous_value"),  newValue: text("new_value"),
  originalAiValue: text("original_ai_value"),
  aiConfidence: numeric("ai_confidence", { precision: 4, scale: 3 }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("edits_field_key_idx").on(t.fieldKey), index("edits_supplier_idx").on(t.supplierId)]);

export const crossCheckResults = pgTable("cross_check_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  ruleId: text("rule_id").notNull(),                // 'CC-03'
  scope: text("scope").notNull(),                   // 'shipment' | 'line:2' | 'pl-line:4'
  status: checkStatus("status").notNull(),
  severity: checkSeverity("severity").notNull(),
  observed: jsonb("observed").notNull(),            // [{ docType, fieldId, value, display }]
  delta: text("delta"),                             // canonical decimal, e.g. '45.000'
  message: text("message").notNull(),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  fingerprint: text("fingerprint").notNull(),
  resolution: checkResolution("resolution"),
  declaredValue: text("declared_value"),            // DISCREPANCY_ACCEPTED only
  resolutionNote: text("resolution_note"),
  resolvedBy: text("resolved_by"),  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  acknowledgedBy: text("acknowledged_by"),          // manager tick at approval
  engineVersion: text("engine_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.shipmentId, t.ruleId, t.scope)]);

export const shipmentExports = pgTable("exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  layoutVersion: text("layout_version").notNull(),  // 'CF-1'
  storageKey: text("storage_key").notNull(),
  fileSha256: text("file_sha256").notNull(),
  rowCount: integer("row_count").notNull(),
  exportedBy: text("exported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {           // append-only
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: text("actor_id"),                        // null = system
  action: text("action").notNull(),                 // see §4.4
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  shipmentId: uuid("shipment_id"),
  metadata: jsonb("metadata").notNull().default({}),// ids, codes, counts — never document text or PII
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_shipment_idx").on(t.shipmentId, t.createdAt)]);

// ── Better Auth tables ──────────────────────────────────────────────────────────────────────────────
// Generated with `npx auth@1.7.18 generate` from the options in src/server/auth.ts, then adjusted to this file's
// conventions: timestamptz, and a CHECK on role (ARCHITECTURE §4.2). Re-run the CLI after changing auth options.

const tz = { withTimezone: true } as const;

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tz).defaultNow().$onUpdate(() => new Date()).notNull(),
  role: text("role", { enum: ["DOCUMENTATION_EXECUTIVE", "DOCUMENTATION_MANAGER"] }).notNull(),
}, (t) => [check("user_role_check", sql`${t.role} IN ('DOCUMENTATION_EXECUTIVE', 'DOCUMENTATION_MANAGER')`)]);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", tz).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tz).$onUpdate(() => new Date()).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("session_userId_idx").on(t.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tz).$onUpdate(() => new Date()).notNull(),
}, (t) => [index("account_userId_idx").on(t.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", tz).notNull(),
  createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tz).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

export const rateLimit = pgTable("rate_limit", {             // login rate limiting (ARCHITECTURE §9)
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({ sessions: many(session), accounts: many(account) }));
export const sessionRelations = relations(session, ({ one }) => ({ user: one(user, { fields: [session.userId], references: [user.id] }) }));
export const accountRelations = relations(account, ({ one }) => ({ user: one(user, { fields: [account.userId], references: [user.id] }) }));

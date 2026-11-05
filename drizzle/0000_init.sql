CREATE TYPE "public"."check_resolution" AS ENUM('DISCREPANCY_ACCEPTED', 'QUERY_RAISED', 'ACKNOWLEDGED_MISSING');--> statement-breakpoint
CREATE TYPE "public"."check_severity" AS ENUM('CRITICAL', 'WARNING', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('PASS', 'FAIL', 'INCOMPLETE', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('INVOICE', 'PACKING_LIST', 'BILL_OF_LADING');--> statement-breakpoint
CREATE TYPE "public"."edit_action" AS ENUM('CONFIRM', 'CORRECT', 'MANUAL_ENTRY');--> statement-breakpoint
CREATE TYPE "public"."extraction_mode" AS ENUM('LIVE', 'SAMPLE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."field_status" AS ENUM('UNREVIEWED', 'CONFIRMED', 'CORRECTED', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'EXTRACTED', 'READY_FOR_APPROVAL', 'APPROVED', 'EXPORTED', 'ON_HOLD');--> statement-breakpoint
CREATE SEQUENCE "public"."shipment_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 24820 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"shipment_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"scope" text NOT NULL,
	"status" "check_status" NOT NULL,
	"severity" "check_severity" NOT NULL,
	"observed" jsonb NOT NULL,
	"delta" text,
	"message" text NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"resolution" "check_resolution",
	"declared_value" text,
	"resolution_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"acknowledged_by" text,
	"engine_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cross_check_results_shipment_id_rule_id_scope_unique" UNIQUE("shipment_id","rule_id","scope")
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"image_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"readable" boolean,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text_items" jsonb,
	CONSTRAINT "document_pages_document_id_page_no_unique" UNIQUE("document_id","page_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"status" "doc_status" DEFAULT 'UPLOADED' NOT NULL,
	"mode" "extraction_mode",
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer NOT NULL,
	"has_text_layer" boolean NOT NULL,
	"detected_doc_type" text,
	"wrong_type_dismissed" boolean DEFAULT false NOT NULL,
	"model_id" text,
	"ai_latency_ms" integer,
	"ai_usage" jsonb,
	"raw_ai_output" jsonb,
	"extraction_started_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"superseded_at" timestamp with time zone,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_item_id" uuid,
	"field_key" text NOT NULL,
	"raw_text" text,
	"value" text,
	"original_ai_value" text,
	"model_confidence" numeric(4, 3),
	"confidence" numeric(4, 3),
	"confidence_signals" jsonb,
	"page_no" integer,
	"bbox" jsonb,
	"status" "field_status" DEFAULT 'UNREVIEWED' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fields_slot" UNIQUE NULLS NOT DISTINCT("document_id","line_item_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "field_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"field_key" text NOT NULL,
	"action" "edit_action" NOT NULL,
	"previous_value" text,
	"new_value" text,
	"original_ai_value" text,
	"ai_confidence" numeric(4, 3),
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"iec" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	CONSTRAINT "line_items_document_id_line_no_unique" UNIQUE("document_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"layout_version" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"exported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"importer_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "shipment_status" DEFAULT 'DRAFT' NOT NULL,
	"unresolved_issues_count" integer DEFAULT 0 NOT NULL,
	"failed_check_count" integer DEFAULT 0 NOT NULL,
	"hold_reason" text,
	"first_opened_at" timestamp with time zone,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"last_data_change_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "suppliers_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
ALTER TABLE "cross_check_results" ADD CONSTRAINT "cross_check_results_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_edits" ADD CONSTRAINT "field_edits_field_id_extracted_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."extracted_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_importer_id_importers_id_fk" FOREIGN KEY ("importer_id") REFERENCES "public"."importers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_shipment_idx" ON "audit_logs" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_current_slot" ON "documents" USING btree ("shipment_id","doc_type") WHERE superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX "fields_shipment_idx" ON "extracted_fields" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "edits_field_key_idx" ON "field_edits" USING btree ("field_key");--> statement-breakpoint
CREATE INDEX "edits_supplier_idx" ON "field_edits" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","updated_at");
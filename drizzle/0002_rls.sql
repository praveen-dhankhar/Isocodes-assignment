-- Supabase exposes `public` through its Data API to the anon/authenticated roles.
-- RLS with no policies denies them every row; the app connects as `postgres` (BYPASSRLS), so it is unaffected.
-- New tables: add a line here (or in the table's migration).
ALTER TABLE "importers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "line_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extracted_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cross_check_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;

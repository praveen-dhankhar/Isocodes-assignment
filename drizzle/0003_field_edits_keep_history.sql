ALTER TABLE "field_edits" DROP CONSTRAINT "field_edits_field_id_extracted_fields_id_fk";
--> statement-breakpoint
ALTER TABLE "field_edits" ALTER COLUMN "field_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "field_edits" ADD CONSTRAINT "field_edits_field_id_extracted_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."extracted_fields"("id") ON DELETE set null ON UPDATE no action;
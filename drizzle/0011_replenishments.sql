CREATE TYPE "public"."replenishment_status" AS ENUM('design_review', 'design_changes', 'quality_review', 'art_approved', 'sent_to_print', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "replenishment_code_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishment_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"replenishment_id" uuid NOT NULL,
	"storage_item_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size" integer DEFAULT 0 NOT NULL,
	"tag" text DEFAULT 'otro' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishment_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"replenishment_id" uuid NOT NULL,
	"element" text NOT NULL,
	"description" text,
	"quantity" integer,
	"supplier_id" integer,
	"quote_status" text DEFAULT 'pending' NOT NULL,
	"quote_price" numeric(12, 4),
	"quote_notes" text,
	"quote_requested_at" timestamp with time zone,
	"quote_received_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"template" text DEFAULT 'repeticion' NOT NULL,
	"title" text NOT NULL,
	"status" "replenishment_status" DEFAULT 'design_review' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"npd_project_id" uuid,
	"product_name" text,
	"product_ref" text,
	"client_or_brand" text,
	"needed_by" date,
	"notes" text,
	"requester_id" uuid NOT NULL,
	"storage_folder_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "replenishments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"contact_name" text,
	"phone" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "replenishment_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "reply_to" text[];--> statement-breakpoint
ALTER TABLE "replenishment_files" ADD CONSTRAINT "replenishment_files_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_files" ADD CONSTRAINT "replenishment_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_items" ADD CONSTRAINT "replenishment_items_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_items" ADD CONSTRAINT "replenishment_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_npd_project_id_projects_id_fk" FOREIGN KEY ("npd_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replenishment_files_rep_idx" ON "replenishment_files" USING btree ("replenishment_id");--> statement-breakpoint
CREATE INDEX "replenishment_items_rep_idx" ON "replenishment_items" USING btree ("replenishment_id");--> statement-breakpoint
CREATE INDEX "replenishments_status_idx" ON "replenishments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_idx" ON "suppliers" USING btree (lower("name"));
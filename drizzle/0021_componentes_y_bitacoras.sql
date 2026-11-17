CREATE TABLE "component_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_id" integer NOT NULL,
	"slot" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"price" numeric(12, 4),
	"notes" text,
	"requested_at" timestamp with time zone,
	"received_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"component" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"chosen_quote_id" integer,
	"choice_comment" text,
	"chosen_at" timestamp with time zone,
	"chosen_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dept_notes" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "component_quotes" ADD CONSTRAINT "component_quotes_component_id_project_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."project_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_quotes" ADD CONSTRAINT "component_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_components" ADD CONSTRAINT "project_components_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_components" ADD CONSTRAINT "project_components_chosen_by_users_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "component_quotes_slot_idx" ON "component_quotes" USING btree ("component_id","slot");--> statement-breakpoint
CREATE INDEX "component_quotes_supplier_idx" ON "component_quotes" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "project_components_project_idx" ON "project_components" USING btree ("project_id");
CREATE TABLE "project_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"final_name" text,
	"facing" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD COLUMN "reference_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD COLUMN "reference_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sheet" ADD COLUMN "reference_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pricing_mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "packaging_mode" text DEFAULT 'common' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_dept_progress" DROP CONSTRAINT "project_dept_progress_project_id_department_id_pk";--> statement-breakpoint
ALTER TABLE "project_sheet" DROP CONSTRAINT "project_sheet_project_id_section_pk";--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD CONSTRAINT "project_dept_progress_project_id_department_id_reference_id_pk" PRIMARY KEY("project_id","department_id","reference_id");--> statement-breakpoint
ALTER TABLE "project_sheet" ADD CONSTRAINT "project_sheet_project_id_section_reference_id_pk" PRIMARY KEY("project_id","section","reference_id");--> statement-breakpoint
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_references_project_idx" ON "project_references" USING btree ("project_id");

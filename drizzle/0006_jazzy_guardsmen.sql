CREATE TABLE "project_confidential" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"formula_target_cost" numeric(12, 4),
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_confidential" ADD CONSTRAINT "project_confidential_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_confidential" ADD CONSTRAINT "project_confidential_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "dept_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"department_key" text NOT NULL,
	"reference_id" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"is_wait" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"reference_id" integer DEFAULT 0 NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"formula" text,
	"status" text DEFAULT 'evaluation' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dept_notes" ADD CONSTRAINT "dept_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dept_notes" ADD CONSTRAINT "dept_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dept_notes_project_idx" ON "dept_notes" USING btree ("project_id","department_key");--> statement-breakpoint
CREATE INDEX "lab_samples_project_idx" ON "lab_samples" USING btree ("project_id");--> statement-breakpoint
-- La referencia aprobada ya no se escribe a mano: se marca entre las muestras en evaluación
UPDATE "dept_substates" SET "prompt_fields" = '{}'::text[]
WHERE "is_final" = true AND 'formula.approvedReference' = ANY("prompt_fields") AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'idi');

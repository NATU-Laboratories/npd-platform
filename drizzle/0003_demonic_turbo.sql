CREATE TYPE "public"."sheet_status" AS ENUM('pending', 'done', 'na');--> statement-breakpoint
CREATE TABLE "project_sheet" (
	"project_id" uuid NOT NULL,
	"section" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "sheet_status" DEFAULT 'pending' NOT NULL,
	"status_by" uuid,
	"status_at" timestamp with time zone,
	"status_note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sheet_project_id_section_pk" PRIMARY KEY("project_id","section")
);
--> statement-breakpoint
ALTER TABLE "department_members" ADD COLUMN "is_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sheet" ADD CONSTRAINT "project_sheet_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sheet" ADD CONSTRAINT "project_sheet_status_by_users_id_fk" FOREIGN KEY ("status_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sheet" ADD CONSTRAINT "project_sheet_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Datos: el responsable único anterior pasa a ser responsable (is_lead) en department_members
INSERT INTO "department_members" ("department_id", "user_id", "is_lead")
SELECT "id", "lead_user_id", true FROM "departments" WHERE "lead_user_id" IS NOT NULL
ON CONFLICT ("department_id", "user_id") DO UPDATE SET "is_lead" = true;--> statement-breakpoint
-- Datos: Calidad y Regulatory pasan a ser un único departamento
UPDATE "departments" SET "name" = 'Calidad y Regulatory',
  "notify_emails" = ARRAY(SELECT DISTINCT unnest("notify_emails" || COALESCE((SELECT r."notify_emails" FROM "departments" r WHERE r."key" = 'regulatory'), '{}'::text[])))
WHERE "key" = 'calidad';--> statement-breakpoint
INSERT INTO "department_members" ("department_id", "user_id", "is_lead")
SELECT c."id", m."user_id", m."is_lead" FROM "department_members" m
JOIN "departments" r ON r."id" = m."department_id" AND r."key" = 'regulatory'
CROSS JOIN "departments" c WHERE c."key" = 'calidad'
ON CONFLICT ("department_id", "user_id") DO UPDATE SET "is_lead" = "department_members"."is_lead" OR EXCLUDED."is_lead";--> statement-breakpoint
DELETE FROM "department_members" WHERE "department_id" IN (SELECT "id" FROM "departments" WHERE "key" = 'regulatory');--> statement-breakpoint
INSERT INTO "project_departments" ("project_id", "department_id")
SELECT pd."project_id", c."id" FROM "project_departments" pd
JOIN "departments" r ON r."id" = pd."department_id" AND r."key" = 'regulatory'
CROSS JOIN "departments" c WHERE c."key" = 'calidad'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "project_departments" WHERE "department_id" IN (SELECT "id" FROM "departments" WHERE "key" = 'regulatory');--> statement-breakpoint
UPDATE "template_tasks" SET "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad')
WHERE "department_id" IN (SELECT "id" FROM "departments" WHERE "key" = 'regulatory') AND EXISTS (SELECT 1 FROM "departments" WHERE "key" = 'calidad');--> statement-breakpoint
UPDATE "tasks" SET "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad')
WHERE "department_id" IN (SELECT "id" FROM "departments" WHERE "key" = 'regulatory') AND EXISTS (SELECT 1 FROM "departments" WHERE "key" = 'calidad');--> statement-breakpoint
UPDATE "departments" SET "is_active" = false, "name" = 'Regulatory (integrado en Calidad y Regulatory)', "notify_emails" = '{}'::text[] WHERE "key" = 'regulatory';--> statement-breakpoint
-- Datos: se elimina el canal Horeca de la solicitud
UPDATE "catalog_items" SET "is_active" = false WHERE "type" = 'channel' AND "value" = 'horeca';

CREATE TABLE "dept_substates" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"can_return_to" integer[] DEFAULT '{}'::int[] NOT NULL,
	"required_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"prompt_fields" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_dept_progress" (
	"project_id" uuid NOT NULL,
	"department_id" integer NOT NULL,
	"substate_id" integer NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rounds" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "project_dept_progress_project_id_department_id_pk" PRIMARY KEY("project_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "project_dept_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"department_id" integer NOT NULL,
	"from_substate_id" integer,
	"to_substate_id" integer,
	"direction" text NOT NULL,
	"comment" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dept_substates" ADD CONSTRAINT "dept_substates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD CONSTRAINT "project_dept_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD CONSTRAINT "project_dept_progress_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD CONSTRAINT "project_dept_progress_substate_id_dept_substates_id_fk" FOREIGN KEY ("substate_id") REFERENCES "public"."dept_substates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_progress" ADD CONSTRAINT "project_dept_progress_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD CONSTRAINT "project_dept_transitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD CONSTRAINT "project_dept_transitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD CONSTRAINT "project_dept_transitions_from_substate_id_dept_substates_id_fk" FOREIGN KEY ("from_substate_id") REFERENCES "public"."dept_substates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD CONSTRAINT "project_dept_transitions_to_substate_id_dept_substates_id_fk" FOREIGN KEY ("to_substate_id") REFERENCES "public"."dept_substates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dept_transitions" ADD CONSTRAINT "project_dept_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dept_substates_dept_idx" ON "dept_substates" USING btree ("department_id","sort");--> statement-breakpoint
CREATE INDEX "project_dept_transitions_idx" ON "project_dept_transitions" USING btree ("project_id","department_id","created_at");--> statement-breakpoint
-- Datos: subestados iniciales por departamento (solo si el departamento no tiene ninguno)--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente de cotizar', 10, false, '{}'::text[], '{}'::text[]),
  ('Cotización enviada', 20, false, '{}'::text[], '{}'::text[]),
  ('Negociación con el cliente', 30, false, '{}'::text[], '{}'::text[]),
  ('Presupuesto aprobado', 40, true, '{}'::text[], ARRAY['comercial.finalUnitPrice']::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'comercial' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Pendiente de cotizar') ORDER BY t."sort")
WHERE s."name" = 'Cotización enviada' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'comercial') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Cotización enviada') ORDER BY t."sort")
WHERE s."name" = 'Negociación con el cliente' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'comercial') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Negociación con el cliente') ORDER BY t."sort")
WHERE s."name" = 'Presupuesto aprobado' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'comercial') AND s."can_return_to" = '{}';--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente', 10, false, '{}'::text[], '{}'::text[]),
  ('Desarrollo de muestras', 20, false, '{}'::text[], '{}'::text[]),
  ('Muestras en evaluación', 30, false, '{}'::text[], '{}'::text[]),
  ('Referencia aprobada', 40, true, '{}'::text[], ARRAY['formula.approvedReference']::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'idi' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Desarrollo de muestras') ORDER BY t."sort")
WHERE s."name" = 'Muestras en evaluación' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'idi') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Desarrollo de muestras') ORDER BY t."sort")
WHERE s."name" = 'Referencia aprobada' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'idi') AND s."can_return_to" = '{}';--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente', 10, false, '{}'::text[], '{}'::text[]),
  ('Envase y packaging', 20, false, '{}'::text[], '{}'::text[]),
  ('Naming y códigos', 30, false, '{}'::text[], '{}'::text[]),
  ('Validado', 40, true, '{}'::text[], '{}'::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'marketing' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Envase y packaging') ORDER BY t."sort")
WHERE s."name" = 'Naming y códigos' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'marketing') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Envase y packaging', 'Naming y códigos') ORDER BY t."sort")
WHERE s."name" = 'Validado' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'marketing') AND s."can_return_to" = '{}';--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente', 10, false, '{}'::text[], '{}'::text[]),
  ('Revisión de fórmula y documentación', 20, false, '{}'::text[], '{}'::text[]),
  ('Textos legales de etiqueta', 30, false, '{}'::text[], '{}'::text[]),
  ('Validado', 40, true, '{}'::text[], '{}'::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'calidad' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Revisión de fórmula y documentación') ORDER BY t."sort")
WHERE s."name" = 'Textos legales de etiqueta' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Textos legales de etiqueta') ORDER BY t."sort")
WHERE s."name" = 'Validado' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad') AND s."can_return_to" = '{}';--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente', 10, false, '{}'::text[], '{}'::text[]),
  ('Diseño en curso', 20, false, '{}'::text[], '{}'::text[]),
  ('En revisión', 30, false, '{}'::text[], '{}'::text[]),
  ('Artes finales aprobadas', 40, true, '{}'::text[], '{}'::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'diseno' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Diseño en curso') ORDER BY t."sort")
WHERE s."name" = 'En revisión' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'diseno') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Diseño en curso') ORDER BY t."sort")
WHERE s."name" = 'Artes finales aprobadas' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'diseno') AND s."can_return_to" = '{}';--> statement-breakpoint
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, v.required_fields, v.prompt_fields
FROM "departments" d, (VALUES
  ('Pendiente', 10, false, '{}'::text[], '{}'::text[]),
  ('Compras lanzadas', 20, false, '{}'::text[], '{}'::text[]),
  ('Planificación de producción', 30, false, '{}'::text[], '{}'::text[]),
  ('Listo para producir', 40, true, '{}'::text[], '{}'::text[])
) AS v(name, sort, is_final, required_fields, prompt_fields)
WHERE d."key" = 'operaciones' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Compras lanzadas') ORDER BY t."sort")
WHERE s."name" = 'Planificación de producción' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones') AND s."can_return_to" = '{}';--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" IN ('Planificación de producción') ORDER BY t."sort")
WHERE s."name" = 'Listo para producir' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones') AND s."can_return_to" = '{}';
--> statement-breakpoint
-- Datos: los departamentos que ya tenían terminados todos sus apartados parten del subestado final
INSERT INTO "project_dept_progress" ("project_id", "department_id", "substate_id", "entered_at", "completed_at")
SELECT x.project_id, d."id", fs."id", x.done_at, x.done_at
FROM (
  SELECT ps."project_id", m.dept, max(ps."status_at") AS done_at, count(*) FILTER (WHERE ps."status" = 'done') AS done_n, max(m.total) AS total
  FROM (VALUES ('comercial', 'comercial', 1), ('formula', 'idi', 1), ('identificacion', 'marketing', 2), ('packaging', 'marketing', 2),
               ('regulatorio', 'calidad', 1), ('etiqueta', 'diseno', 1), ('produccion', 'operaciones', 1)) AS m(section, dept, total)
  JOIN "project_sheet" ps ON ps."section" = m.section
  GROUP BY ps."project_id", m.dept
) x
JOIN "departments" d ON d."key" = x.dept
JOIN LATERAL (SELECT s."id" FROM "dept_substates" s WHERE s."department_id" = d."id" AND s."is_final" ORDER BY s."sort" LIMIT 1) fs ON true
WHERE x.done_n = x.total AND x.done_at IS NOT NULL
ON CONFLICT DO NOTHING;

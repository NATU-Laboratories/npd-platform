-- Compras / Aprovisionamiento: estados propios (se activa con P2, como Laboratorio)
INSERT INTO "dept_substates" ("department_id", "name", "sort", "is_final", "required_fields", "prompt_fields")
SELECT d."id", v.name, v.sort, v.is_final, '{}'::text[], '{}'::text[]
FROM "departments" d, (VALUES
  ('Pendiente', 10, false),
  ('Ofertas y muestras de proveedores', 20, false),
  ('Pedidos lanzados', 30, false),
  ('Materiales recibidos', 40, true)
) AS v(name, sort, is_final)
WHERE d."key" = 'compras' AND NOT EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."department_id" = d."id");
--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" = 'Ofertas y muestras de proveedores')
WHERE s."name" = 'Pedidos lanzados' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'compras') AND s."can_return_to" = '{}';
--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" = 'Pedidos lanzados')
WHERE s."name" = 'Materiales recibidos' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'compras') AND s."can_return_to" = '{}';
--> statement-breakpoint
-- Operaciones deja las compras: «Compras lanzadas» pasa a «Lote piloto», después de la planificación
UPDATE "dept_substates" SET "sort" = 20
WHERE "name" = 'Planificación de producción' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones')
  AND EXISTS (SELECT 1 FROM "dept_substates" x WHERE x."name" = 'Compras lanzadas' AND x."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones'));
--> statement-breakpoint
UPDATE "dept_substates" SET "name" = 'Lote piloto', "sort" = 30,
  "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = "dept_substates"."department_id" AND t."name" = 'Planificación de producción')
WHERE "name" = 'Compras lanzadas' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones');
--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = '{}'
WHERE s."name" = 'Planificación de producción' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones');
--> statement-breakpoint
UPDATE "dept_substates" s SET "can_return_to" = ARRAY(SELECT t."id" FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" = 'Lote piloto')
WHERE s."name" = 'Listo para producir' AND s."department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones')
  AND EXISTS (SELECT 1 FROM "dept_substates" t WHERE t."department_id" = s."department_id" AND t."name" = 'Lote piloto');

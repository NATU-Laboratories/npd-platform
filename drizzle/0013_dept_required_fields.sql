-- Datos obligatorios para avanzar de estado en los departamentos que no tenían ninguno
-- (solo se aplican si el estado sigue sin requisitos; editables en Backoffice → Estados de departamento)
UPDATE "dept_substates" SET "required_fields" = ARRAY['regulatorio.denomination', 'regulatorio.nominalMl', 'regulatorio.languages']::text[]
WHERE "name" = 'Textos legales de etiqueta' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['regulatorio.inci', 'regulatorio.warnings', 'regulatorio.pao', 'regulatorio.responsibleName', 'regulatorio.responsibleAddress', 'regulatorio.lot']::text[]
WHERE "name" = 'Validado' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'calidad');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['etiqueta.labelType', 'etiqueta.size', 'etiqueta.artworkUrl']::text[]
WHERE "name" = 'En revisión' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'diseno');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['etiqueta.artworkUrl', 'etiqueta.clientApproved', 'etiqueta.clientApprovedAt']::text[]
WHERE "name" = 'Artes finales aprobadas' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'diseno');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['etiqueta.dieType']::text[]
WHERE "name" = 'Revisión imprenta' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'diseno');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['aprovisionamiento.suppliersLeadTimes']::text[]
WHERE "name" = 'Ofertas y muestras de proveedores' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'compras');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['aprovisionamiento.ordersPlaced', 'aprovisionamiento.orderDate', 'aprovisionamiento.expectedArrival']::text[]
WHERE "name" = 'Pedidos lanzados' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'compras');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['aprovisionamiento.materialsReceived']::text[]
WHERE "name" = 'Materiales recibidos' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'compras');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['produccion.productionDate']::text[]
WHERE "name" = 'Planificación de producción' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['produccion.pilotApproved']::text[]
WHERE "name" = 'Listo para producir' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'operaciones');

-- Marketing no pasa a «Naming y códigos» sin los detalles de envase y packaging,
-- ni a «Validado» sin naming y códigos (editable en Backoffice → Estados de departamento)
UPDATE "dept_substates" SET "required_fields" = ARRAY['packaging.bottleModel', 'packaging.bottleFinish', 'packaging.capModel', 'packaging.labelPrint', 'packaging.secondaryType', 'packaging.masterUnits']::text[]
WHERE "name" = 'Naming y códigos' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'marketing');
--> statement-breakpoint
UPDATE "dept_substates" SET "required_fields" = ARRAY['identificacion.productName', 'identificacion.barcodeType', 'identificacion.qr']::text[]
WHERE "name" = 'Validado' AND "required_fields" = '{}' AND "department_id" = (SELECT "id" FROM "departments" WHERE "key" = 'marketing');

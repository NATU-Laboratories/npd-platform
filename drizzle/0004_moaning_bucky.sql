ALTER TABLE "department_members" DROP COLUMN "is_lead";--> statement-breakpoint
-- Datos: nuevo rol "Decisor global" (gestor de proyectos)
INSERT INTO "roles" ("key") VALUES ('global_decider') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Datos: la categoría Cosmética pasa a llamarse Personal Care
UPDATE "workflow_templates" SET "name" = 'Personal Care (PL, MP o MDD) – regulatorio reforzado' WHERE "name" = 'Cosmética (PL, MP o MDD) – regulatorio reforzado';

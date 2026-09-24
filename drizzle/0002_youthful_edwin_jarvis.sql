ALTER TYPE "public"."project_type" ADD VALUE 'MDD';--> statement-breakpoint
ALTER TABLE "gates" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "quote_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "prepayment" jsonb;
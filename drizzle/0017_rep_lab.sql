ALTER TABLE "dept_notes" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_samples" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dept_notes" ADD COLUMN "replenishment_id" uuid;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD COLUMN "replenishment_id" uuid;--> statement-breakpoint
ALTER TABLE "replenishments" ADD COLUMN "lab_substate_id" integer;--> statement-breakpoint
ALTER TABLE "replenishments" ADD COLUMN "lab_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replenishments" ADD COLUMN "lab_rounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "replenishments" ADD COLUMN "lab_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replenishments" ADD COLUMN "approved_reference" text;--> statement-breakpoint
ALTER TABLE "dept_notes" ADD CONSTRAINT "dept_notes_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_lab_substate_id_dept_substates_id_fk" FOREIGN KEY ("lab_substate_id") REFERENCES "public"."dept_substates"("id") ON DELETE set null ON UPDATE no action;
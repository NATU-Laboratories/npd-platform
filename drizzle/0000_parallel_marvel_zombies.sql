CREATE TYPE "public"."gate_key" AS ENUM('G1', 'G2', 'G3', 'G4', 'G5');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('pending', 'approved', 'info_requested', 'rejected', 'paused', 'recycled', 'forced');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notif_pref" AS ENUM('immediate', 'daily');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."project_category" AS ENUM('perfume', 'ambient', 'cosmetic');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'submitted', 'info_requested', 'in_progress', 'paused', 'in_production', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('PL', 'MP');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pendiente', 'bloqueada', 'en_curso', 'en_revision', 'devuelta', 'esperando_cliente', 'completada', 'no_aplica');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"parent_id" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"contact" text,
	"account_manager_user_id" uuid,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" integer,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '{"users":[],"departments":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "department_members" (
	"department_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "department_members_department_id_user_id_pk" PRIMARY KEY("department_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"lead_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "departments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" integer,
	"comment_id" integer,
	"sharepoint_item_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size" integer DEFAULT 0 NOT NULL,
	"tag" text,
	"phase" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_deciders" (
	"gate" "gate_key" NOT NULL,
	"project_type" "project_type" NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "gate_deciders_gate_project_type_user_id_pk" PRIMARY KEY("gate","project_type","user_id")
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"gate" "gate_key" NOT NULL,
	"status" "gate_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"reason_code" text,
	"client_evidence_file_id" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "info_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"gate_id" integer,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"fields_missing" text[] DEFAULT '{}'::text[] NOT NULL,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"answer" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"project_id" uuid,
	"recipients" text[] NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_code_counters" (
	"year" integer NOT NULL,
	"type" "project_type" NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_code_counters_year_type_pk" PRIMARY KEY("year","type")
);
--> statement-breakpoint
CREATE TABLE "project_departments" (
	"project_id" uuid NOT NULL,
	"department_id" integer NOT NULL,
	CONSTRAINT "project_departments_project_id_department_id_pk" PRIMARY KEY("project_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text DEFAULT '' NOT NULL,
	"type" "project_type",
	"category" "project_category",
	"subtype" text,
	"brand_id" integer,
	"client_id" integer,
	"requester_id" uuid NOT NULL,
	"account_manager_id" uuid,
	"origin" text,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"status_before_pause" "project_status",
	"phase" integer DEFAULT 0 NOT NULL,
	"priority" "priority",
	"needed_by" date,
	"needed_by_reason" text,
	"requested_at" timestamp with time zone,
	"decided_g1_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"units_first_order" integer,
	"units_annual" integer,
	"target_price" numeric(12, 2),
	"completeness_pct" integer DEFAULT 0 NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sharepoint_folder_id" text,
	"sharepoint_folder_url" text,
	"sharepoint_subfolders" jsonb,
	"staging_folder_id" text,
	"sap_order_ref" text,
	"template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_deps" (
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	CONSTRAINT "task_deps_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"phase" integer NOT NULL,
	"department_id" integer NOT NULL,
	"assignee_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pendiente' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"due_date" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"template_task_id" integer
);
--> statement-breakpoint
CREATE TABLE "template_task_deps" (
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	CONSTRAINT "template_task_deps_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"phase" integer NOT NULL,
	"department_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"can_return_to_task_id" integer,
	"est_days" integer DEFAULT 5 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_oid" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"notif_pref" "notif_pref" DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_entra_oid_unique" UNIQUE("entra_oid")
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_user_id_users_id_fk" FOREIGN KEY ("account_manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_deciders" ADD CONSTRAINT "gate_deciders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_departments" ADD CONSTRAINT "project_departments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_departments" ADD CONSTRAINT "project_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_deps" ADD CONSTRAINT "task_deps_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_template_task_id_template_tasks_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."template_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_task_deps" ADD CONSTRAINT "template_task_deps_task_id_template_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."template_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_task_deps" ADD CONSTRAINT "template_task_deps_depends_on_task_id_template_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."template_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_project_idx" ON "activity_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_type_value_idx" ON "catalog_items" USING btree ("type","value");--> statement-breakpoint
CREATE INDEX "comments_project_idx" ON "comments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "error_created_idx" ON "error_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "files_project_idx" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gates_project_gate_idx" ON "gates" USING btree ("project_id","gate");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "login_events_created_idx" ON "login_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_requester_idx" ON "projects" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "projects_requested_at_idx" ON "projects" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "projects_needed_by_idx" ON "projects" USING btree ("needed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));
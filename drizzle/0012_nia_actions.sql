CREATE TABLE "assistant_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"conversation_id" text,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams_conversations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"service_url" text NOT NULL,
	"bot_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"from_user_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_conversations" ADD CONSTRAINT "teams_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_actions_user_idx" ON "assistant_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_notices_user_idx" ON "user_notices" USING btree ("user_id","read_at");
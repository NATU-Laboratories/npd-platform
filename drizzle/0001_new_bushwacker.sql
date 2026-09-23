CREATE TABLE "storage_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_folder" boolean DEFAULT false NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"mime" text,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_uploads" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"data" "bytea" DEFAULT ''::bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

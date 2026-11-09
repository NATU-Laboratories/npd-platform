CREATE TABLE "proactive_alerts" (
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_alerts_kind_entity_id_stage_pk" PRIMARY KEY("kind","entity_id","stage")
);

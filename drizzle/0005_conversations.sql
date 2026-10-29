CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"messages" jsonb NOT NULL,
	"turns" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

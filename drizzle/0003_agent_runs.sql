CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"engine" text NOT NULL,
	"answer" text NOT NULL,
	"results" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"usage" jsonb,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_runs_created_idx" ON "agent_runs" USING btree ("created_at");
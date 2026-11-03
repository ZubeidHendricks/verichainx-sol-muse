CREATE TABLE "model_usage" (
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_usage_day_provider_idx" ON "model_usage" USING btree ("day","provider");
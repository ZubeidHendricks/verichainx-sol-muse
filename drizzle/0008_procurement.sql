CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"request_id" text NOT NULL,
	"column" text DEFAULT 'sourced' NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"seller" text NOT NULL,
	"image" text,
	"item_id" text,
	"product_url" text,
	"unit_price" text NOT NULL,
	"unit_units" bigint,
	"quantity" integer NOT NULL,
	"available" integer,
	"label" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scorecard" jsonb,
	"policy" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_id" text,
	"ordered_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"wallet" text NOT NULL,
	"wallet_secret_sealed" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"member_id" text NOT NULL,
	"text" text NOT NULL,
	"quantity" integer NOT NULL,
	"budget_units" bigint NOT NULL,
	"answer" text NOT NULL,
	"engine" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"card_id" text NOT NULL,
	"member_id" text NOT NULL,
	"vote" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "lot_of" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_company_idx" ON "cards" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "members_company_idx" ON "members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "requests_company_idx" ON "requests" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_card_member_idx" ON "votes" USING btree ("card_id","member_id");
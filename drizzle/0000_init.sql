CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"asset" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_units" bigint NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" jsonb,
	"registration_hash" text,
	"origin_sig" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_asset_unique" UNIQUE("asset")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"domain_verified_at" timestamp with time zone,
	"wallet" text NOT NULL,
	"custody" text NOT NULL,
	"agent_pubkey" text NOT NULL,
	"agent_secret_sealed" text,
	"collection_asset" text,
	"shopify_shop" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"price_units" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"buyer_wallet" text NOT NULL,
	"reference" text NOT NULL,
	"order_hash" text NOT NULL,
	"fee_bps" integer NOT NULL,
	"tx_sig" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"sig" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_item_idx" ON "offers" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_idx" ON "orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "orders_offer_buyer_idx" ON "orders" USING btree ("offer_id","buyer_wallet");
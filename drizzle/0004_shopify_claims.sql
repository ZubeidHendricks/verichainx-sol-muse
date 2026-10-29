CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"shopify_order_id" text NOT NULL,
	"order_name" text NOT NULL,
	"email_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by" text,
	"tx_sig" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shopify_product_id" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "shopify_token_sealed" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_order_item_idx" ON "claims" USING btree ("shopify_order_id","item_id");
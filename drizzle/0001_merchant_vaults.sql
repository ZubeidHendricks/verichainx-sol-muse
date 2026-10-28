ALTER TABLE "merchants" ADD COLUMN "vault_secret_sealed" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_wallet_unique" UNIQUE("wallet");
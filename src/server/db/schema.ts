import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** §12. Amounts are USDC base units. */
export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),
  domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
  wallet: text("wallet").notNull().unique(), // owns the merchant's assets and receives USDC
  custody: text("custody", { enum: ["vault", "own_wallet"] }).notNull(),
  // Devnet only: a vault key per merchant, never shared, so the owner check still tells merchants apart.
  vaultSecretSealed: text("vault_secret_sealed"),
  agentPubkey: text("agent_pubkey").notNull(),
  agentSecretSealed: text("agent_secret_sealed"), // service-held agent key, sealed with KEY_SEAL_SECRET
  collectionAsset: text("collection_asset"),
  shopifyShop: text("shopify_shop"), // e.g. lerato.myshopify.com, set when the store installs the app (§11.3)
  shopifyTokenSealed: text("shopify_token_sealed"), // Admin API access token, sealed with KEY_SEAL_SECRET
  // The wallet that signed in and manages this shop (§11.4). For own-wallet shops it equals `wallet`.
  ownerWallet: text("owner_wallet"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  asset: text("asset").unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priceUnits: bigint("price_units", { mode: "bigint" }).notNull(),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  fingerprint: jsonb("fingerprint"),
  registrationHash: text("registration_hash"),
  originSig: text("origin_sig"),
  shopifyProductId: text("shopify_product_id"), // the product it was registered from, for orders/paid
  status: text("status", { enum: ["draft", "listed", "sold", "delisted"] }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offers = pgTable("offers", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  priceUnits: bigint("price_units", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  envelope: jsonb("envelope").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("offers_item_idx").on(t.itemId)]);

export type OrderEvent = { status: string; at: string; sig?: string; note?: string };

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  offerId: text("offer_id").notNull().references(() => offers.id),
  buyerWallet: text("buyer_wallet").notNull(),
  reference: text("reference").notNull(),
  orderHash: text("order_hash").notNull(),
  feeBps: integer("fee_bps").notNull(),
  txSig: text("tx_sig"),
  status: text("status", { enum: ["pending", "paid", "shipped", "delivered", "failed"] }).notNull().default("pending"),
  events: jsonb("events").$type<OrderEvent[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("orders_reference_idx").on(t.reference), index("orders_offer_buyer_idx").on(t.offerId, t.buyerWallet)]);

/** Memo-anchored records and their full JSON (§7.3). */
export const records = pgTable("records", {
  sig: text("sig").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  hash: text("hash").notNull(),
});

/** Each shopping-agent run, kept so a result can be shared and the model's steps reviewed later. */
export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  message: text("message").notNull(),
  engine: text("engine").notNull(),
  answer: text("answer").notNull(),
  results: jsonb("results").notNull(),
  trace: jsonb("trace").notNull(),
  usage: jsonb("usage"),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("agent_runs_created_idx").on(t.createdAt)]);

/**
 * §11.3: a Shopify buyer's right to the item's NFT. The link carries a token derived from the claim id, and the
 * buyer also gives the order's email, kept here only as a hash. Single use; locked after too many wrong emails.
 */
export const claims = pgTable("claims", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  shopifyOrderId: text("shopify_order_id").notNull(),
  orderName: text("order_name").notNull(), // "#1001", as the buyer's receipt shows it
  emailHash: text("email_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedBy: text("claimed_by"),
  txSig: text("tx_sig"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("claims_order_item_idx").on(t.shopifyOrderId, t.itemId)]);

/** A shopping conversation (the home page chat): the thread as shown, and the turns shop agents get as context. */
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  messages: jsonb("messages").notNull(),
  turns: jsonb("turns").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

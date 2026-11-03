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
  /** Units the shop can make or supply; null for a one-of-a-kind item. Bulk orders buy a lot of these. */
  stock: integer("stock"),
  /** Set on a lot: the item it's a quantity of. A lot has its own NFT, minted when a company orders it. */
  lotOf: text("lot_of"),
  quantity: integer("quantity").notNull().default(1),
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
  /** Gets the NFT when it isn't the paying wallet (an agent buying for its owner). */
  recipientWallet: text("recipient_wallet"),
  /** The most the payer allowed for this order (agent wallets); null when a person signs. */
  maxPriceUnits: bigint("max_price_units", { mode: "bigint" }),
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

/** Paid model calls per UTC day and provider, so a public site can't run past MODEL_CALLS_PER_DAY. */
export const modelUsage = pgTable("model_usage", {
  day: text("day").notNull(),
  provider: text("provider").notNull(),
  calls: integer("calls").notNull().default(0),
}, (t) => [uniqueIndex("model_usage_day_provider_idx").on(t.day, t.provider)]);

/** A company buying through its procurement agent: its devnet wallet (sealed, like a vault) and spending policy. */
export type Policy = {
  per_order_usdc: string; monthly_usdc: string;
  /** Only offers the checks mark recommended (verified seller, NFT held and listed, origin record). */
  verified_only: boolean;
};

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  wallet: text("wallet").notNull(),
  walletSecretSealed: text("wallet_secret_sealed").notNull(),
  policy: jsonb("policy").$type<Policy>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  role: text("role", { enum: ["approver", "member"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("members_company_idx").on(t.companyId)]);

/** A purchase request a member gave the procurement agent, and what the agent said. */
export const requests = pgTable("requests", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  memberId: text("member_id").notNull().references(() => members.id),
  text: text("text").notNull(),
  quantity: integer("quantity").notNull(),
  budgetUnits: bigint("budget_units", { mode: "bigint" }).notNull(),
  answer: text("answer").notNull(),
  engine: text("engine").notNull(),
  runId: text("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("requests_company_idx").on(t.companyId)]);

export type PolicyCheck = { rule: string; ok: boolean; detail: string };
export type CardEvent = { at: string; who: string; what: string; sig?: string };

/** One sourced option on the company's board: Sourced → Shortlist → Approved → Ordered (or Rejected). */
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  requestId: text("request_id").notNull().references(() => requests.id),
  column: text("column", { enum: ["sourced", "shortlist", "approved", "ordered", "rejected"] }).notNull().default("sourced"),
  kind: text("kind", { enum: ["maker", "store"] }).notNull(),
  title: text("title").notNull(),
  seller: text("seller").notNull(),
  image: text("image"),
  itemId: text("item_id"),
  productUrl: text("product_url"),
  unitPrice: text("unit_price").notNull(), // "129 USDC", or the store's price in its currency
  unitUnits: bigint("unit_units", { mode: "bigint" }), // USDC base units, makers only
  quantity: integer("quantity").notNull(),
  available: integer("available"), // units the shop has, when known
  label: text("label").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").notNull().default([]),
  scorecard: jsonb("scorecard"),
  policy: jsonb("policy").$type<PolicyCheck[]>().notNull().default([]),
  orderId: text("order_id"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  history: jsonb("history").$type<CardEvent[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("cards_company_idx").on(t.companyId)]);

export const votes = pgTable("votes", {
  cardId: text("card_id").notNull().references(() => cards.id),
  memberId: text("member_id").notNull().references(() => members.id),
  vote: text("vote", { enum: ["must_have", "nice_to_have", "skip"] }).notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("votes_card_member_idx").on(t.cardId, t.memberId)]);

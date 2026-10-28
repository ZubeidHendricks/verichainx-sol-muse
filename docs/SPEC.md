# VeriChainX Sol — Product & Technical Spec

**Working name:** VeriChainX Sol (repo `verichainx-sol`). Rename freely; nothing below depends on it.
**Target:** Alliance ALL19 application (regular deadline **November 18, 2026**). The build runs
November 5–17.
**Status:** spec v1, October 28, 2026.

**Relation to the other apps.** VeriChainX Sol is a new, separate app on Solana. It is not the Meta
hackathon app:

- GlobalChain Muse (Hedera) stays as it is, submitted on November 4.
- The existing Sei app stays separate.

The three apps share an open message format (§10) so one shopper's agent can buy from sellers on any
of them, but they share no code. VeriChainX Sol re-implements ideas from GlobalChain Muse and
AfriChain and records which in `PRIOR_WORK.md`.

---

## 1. One-liner

**Verified sellers and ownership that moves with payment, for AI shopping agents, on Solana.**

A shopper's agent finds offers from merchants' agents. It checks that the seller is real and the
item is genuine. Then it buys with one wallet signature: USDC goes to the merchant and the item's
ownership NFT comes back to the buyer in the same transaction. Every offer can also be shared as a
Blink, so a person can buy it from a post on X.

## 2. Problem

- **AI shopping agents can't tell real sellers from clones.** Storefronts, product photos and
  "certificates" are trivially copied. Agent-to-agent commerce makes this worse: an agent will happily
  buy from a convincing fake.
- **Ownership doesn't move with payment.** A receipt proves you paid, not that the item is genuine or
  that it's yours. Resale and warranty both break on that gap.
- **Crypto checkout is still clunky for merchants.** Merchants want USDC without changing how they
  sell.

## 3. Goals and non-goals

**Goals (v1, by November 17):**
1. Merchants onboard and get a verified-seller identity tied to a Solana address.
2. Merchants register items. Each item gets a Metaplex Core NFT and an on-chain origin record.
3. A buyer's agent queries merchants' agents and gets signed offers. It verifies seller, item and
   ownership, and ranks the offers.
4. Buying is one atomic Solana transaction, signed by the buyer in their own wallet (Solana Pay
   transaction request): USDC to the merchant, a protocol fee to the treasury, and the NFT to the
   buyer.
5. Every offer is a Blink (Solana Action) that can be posted on X and bought from there.
6. A copied listing that reuses a real item's QR or origin record is caught, because the NFT isn't in
   the copier's wallet.
7. Runs end to end on devnet, with a public URL, a demo video and tests.

**Non-goals (v1):**
- Custom on-chain program. v1 uses existing programs only: SPL Token, Associated Token Account, Memo
  and Metaplex Core. That means no audit dependency.
- Fiat payments, refunds and disputes.
- Shipping integrations beyond status updates.
- Mainnet launch. The design is mainnet-ready, but v1 runs on devnet.
- Merging with the Hedera or Sei apps.

## 4. Users

| User | Wants | Gets |
|---|---|---|
| **Shopper** (and their agent) | A genuine item at a fair price, safely | Ranked offers with evidence; one-signature purchase; an ownership NFT |
| **Merchant** (independent brand, maker, Shopify store) | Be recognised as real by agents; get paid in USDC | Verified-seller badge; an agent that pitches for them; USDC settlement; resale linked to their origin record |
| **Reseller / second owner** | Prove an item is genuine and theirs | The NFT and the origin record travel with the item; transfers are visible on-chain |
| **Anyone on X** | Buy what they see | A Blink that shows the verified offer and buys it in one tap |

## 5. User stories (acceptance criteria in §13)

1. **Merchant onboarding.**
   - A merchant signs in with their Solana wallet (Sign-In With Solana) or installs the Shopify app.
   - They prove the store domain (DNS TXT record or Shopify OAuth) and become a verified seller.
2. **Item registration.**
   - The merchant uploads 2–4 photos and details.
   - The AI picks the distinctive marks and stores them as the origin fingerprint.
   - A Core NFT is minted to the merchant, and the origin record hash is anchored on-chain.
3. **Agent shopping.**
   - The shopper types "everyday bag under $400".
   - Their agent broadcasts the request; merchant agents reply with signed offers.
   - The agent verifies each offer and presents a ranked list with reasons.
4. **Buy in the app.** The shopper clicks Buy, approves one transaction in Phantom or Solflare, and the
   NFT appears in their wallet.
5. **Buy from X.** The merchant shares the offer's Blink on X. A viewer buys it inside the post with
   the same atomic transaction.
6. **Catch a copy.**
   - A copier lists the same item with the real QR code and photos.
   - The buyer's agent sees that the NFT is owned by the real merchant, not the copier, and flags the
     listing "Avoid".
7. **Resale.**
   - The owner lists the item.
   - The buyer's agent checks the NFT is in the reseller's wallet and that the origin record matches.
   - The sale moves USDC and the NFT atomically.
8. **Shopify order.**
   - A shopper buys a registered item on a partner Shopify store.
   - The `orders/paid` webhook triggers a claim link (a Blink).
   - The shopper claims the NFT into their own wallet.

## 6. System overview

```
 Shopper ──► Web app (Next.js) ──► Buyer agent ──► Merchant agents (HTTP, signed offers)
   │                │                   │                     │
   │ wallet         │ Actions/Blinks    │ verify              │ catalog + Core NFTs
   ▼                ▼                   ▼                     ▼
 Phantom ◄── Solana Pay tx request ── Tx builder ──► Solana (devnet → mainnet)
                                        │             · Metaplex Core (items)
                                        │             · SPL Token (USDC)
                                        │             · Memo (origin + event records)
                                        ▼
                                 Postgres (offers, items, orders, merchants)
                                 Blob storage (photos, NFT metadata JSON)
```

Components:

1. **Web app.**
   - Shopper chat UI, merchant dashboard, public item pages (`/i/<asset>`) and verify pages.
   - Hosts the Actions endpoints and the Solana Pay transaction-request endpoints.
2. **Buyer agent.** An LLM tool-calling loop that discovers merchants, collects offers, runs
   verification and ranks the results.
3. **Merchant agents.** One per merchant, run by the service in v1. Each answers queries from its
   catalogue and signs offers with the merchant's agent key. External merchants can host their own
   agent at the same endpoint shape.
4. **Verifier.**
   - Seller identity check.
   - On-chain ownership check.
   - Origin-record match.
   - AI photo comparison against the origin fingerprint.
   - Seller-risk signals.
5. **Tx builder.** Builds partially signed transactions for purchases, claims and resales.
6. **Indexer (light).** Confirms transactions and updates order state. It uses RPC signatures by
   reference key, or Helius webhooks.

## 7. On-chain design

### 7.1 Programs used (no custom program in v1)

- **Metaplex Core:** one asset per physical item.
- **SPL Token + Associated Token Account:** USDC.
- **Memo:** origin records and order events as compact JSON.
- **Compute Budget:** priority fees on mainnet.

### 7.2 Item NFT (Metaplex Core asset)

- **Collection.** One Core collection per merchant, named after the store. Collection authority is
  the merchant's vault key (§7.5).
- **Asset fields:**
  - `name`: the product name plus a short id.
  - `uri`: a metadata JSON in blob storage with image, attributes, `origin_record` (the memo
    signature), `registration_hash` and `merchant`.
- **Plugins:**
  - `Attributes`: `registration_hash`, `origin_sig`, `merchant_domain`.
  - `TransferDelegate`: set to the service's settlement key while the item is listed, so the service
    can co-sign the NFT leg of a sale without holding the merchant's key. It is revoked on delist and
    reset to none after sale.
  - `Royalties` (optional, v1.1): merchant royalty on resales, enforced with an allowlist ruleset.
- **Ownership states:**
  - Minted to the merchant's payout wallet. If the merchant has none yet, it goes to a merchant vault
    (§7.5).
  - On sale it moves to the buyer's wallet.

### 7.3 Origin and event records (Memo)

The canonical JSON is ≤ 500 bytes, keys sorted, prefixed `vcx1:`.

```json
{"t":"origin","asset":"<asset>","h":"<sha256 of the full registration record>","m":"<merchant>"}
{"t":"order","o":"<order id>","asset":"<asset>","s":"paid|shipped|delivered","h":"<sha256 of event>"}
```

- The full record (photos, fingerprint crops, rationale) lives in Postgres and blob storage. The
  memo proves what existed and when. Anyone can recompute the hash.
- Records are signed by the service anchoring key. The memo transaction's signature is the record id.

### 7.4 Purchase transaction (atomic)

These instructions go in one versioned transaction:

1. `ComputeBudget.setComputeUnitPrice` (mainnet only).
2. `ATA.createIdempotent` for the merchant's USDC ATA. It is paid by the fee payer.
3. `SPL.transferChecked` USDC buyer → merchant (price minus fee).
4. `SPL.transferChecked` USDC buyer → treasury (protocol fee, default **1%**).
5. `mpl-core.transferV1` asset merchant → buyer. The authority is the `TransferDelegate`, which is the
   service settlement key.
6. `Memo` with `{"t":"order","o":…,"s":"paid"}`.
7. A reference public key, added as a read-only non-signer account on instruction 3. Solana Pay uses
   it to find the transaction.

**Signers:**
- **Fee payer:** the service fee-payer key (default) or the buyer.
- **Buyer:** signs in their wallet.
- **Service settlement key:** signs as transfer delegate.

The server returns the transaction **partially signed** by the fee payer and the settlement key. The
wallet adds the buyer's signature and submits.

**Atomicity:** either every instruction lands or none does. The buyer can't get the NFT without
paying, and the merchant can't get paid without releasing the NFT.

**Guards before signing:**
- The asset is listed.
- The price matches the signed offer.
- The offer hasn't expired (`expires_at`, default 15 minutes).
- The asset's current owner is the merchant.
- The transfer delegate is ours.
- The blockhash is fresh.

The settlement key signs only transactions whose instructions match this exact template.

**The owner guard is the copy check (found in testing, Oct 28).** The chain does not link the NFT leg
to the USDC leg. Core lets the transfer delegate move a listed asset whoever is paid, and the
settlement key is the delegate on every listed asset. So a transaction that pays a copier and moves
the real merchant's NFT would land. Only the server's "on-chain owner == merchant being paid" check
stops it. `preparePurchase` therefore requires a fresh on-chain read of the asset as an argument.
`tests/purchase.svm.test.ts` shows both halves. A v2 custom program could enforce the check on-chain.

### 7.5 Keys and custody

| Key | Holds | Storage |
|---|---|---|
| **Fee payer** | SOL for fees and ATA rent | KMS or encrypted env; devnet in `.env` |
| **Settlement key** | Nothing; only a transfer delegate on listed assets | KMS; signs only template-matching transactions (§7.4) |
| **Anchoring key** | SOL for memo fees | KMS or env |
| **Treasury** | Protocol fees in USDC | Multisig (Squads) on mainnet |
| **Merchant vault** | Assets and USDC for merchants without their own wallet | Service-held, devnet only. On mainnet merchants must connect a wallet or use an embedded wallet provider |
| **Merchant agent key** | Signs offers (ed25519) | Per merchant, service-held in v1; merchants can bring their own |

Shopper wallets are always the shopper's own (Phantom, Solflare, Backpack). The service never holds
shopper funds.

### 7.6 Ownership lookup

- `getAsset` via DAS (Helius) for owner, plugins and attributes.
- Fallback: fetch the Core asset account and decode the owner.
- Results are cached for 10 seconds and always refreshed right before building a transaction.

### 7.7 Networks

| | Devnet | Mainnet |
|---|---|---|
| USDC | A test USDC mint the service creates (6 decimals), or Circle devnet USDC | Circle USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| RPC | Helius devnet | Helius mainnet |
| Explorer | `explorer.solana.com/tx/<sig>?cluster=devnet` | Solscan |

## 8. Agents

### 8.1 Buyer agent

An LLM tool-calling loop, capped at 30 steps. It has these tools:

| Tool | Does |
|---|---|
| `discover_merchants(need, budget)` | Registry lookup by category and price; returns merchant agent endpoints |
| `request_offers(need, budget)` | Fans out to merchant agents (5 s timeout each); collects signed offers |
| `verify_seller(offer)` | Checks the offer's signature against the merchant's agent key, the verified domain and the payout wallet |
| `verify_ownership(offer)` | Checks the asset is owned by the offer's merchant and the transfer delegate is set |
| `verify_item(offer)` | Matches the origin memo hash; compares listing photos with the origin fingerprint (AI vision) |
| `assess_seller_risk(offer)` | Account age, sales history from on-chain transfers, review signals |
| `present_recommendations(ranked)` | Final ranked list with reasons and evidence ids |
| `prepare_purchase(offer_id)` | Returns a Solana Pay URL and a Blink URL for the chosen offer |

**Guardrail:** the agent can't recommend an offer that fails `verify_seller` or `verify_ownership`.
A "recommended" label on such an offer is downgraded in code, not by prompt.

### 8.2 Merchant agents

- **Endpoint:** `POST https://<host>/agent/v1/offers`. The body is a `need` envelope (§10). The
  response is a list of signed `offer` envelopes.
- **v1:** the service runs one agent per merchant. It pitches from the catalogue and writes the pitch
  text with the LLM, but price and asset come from the database, never the LLM.
- **Declining:** an agent may decline, with a reason, when nothing fits.

### 8.3 AI provider

- **Interface:** provider-agnostic, through the Vercel AI SDK (`generateText` with tools).
- **Default:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) for agent reasoning and photo comparison.
  Fallbacks are configurable.
- **Separate budget** from the Meta hackathon key. Default cap: **$40 total** for the build, enforced
  by a per-run token counter and a hard daily limit in config.
- **Scripted engine:** for tests and offline demos, labelled "scripted" in the UI.

## 9. Verification model

| Check | Signal | Effect |
|---|---|---|
| **Seller identity** | Offer signature valid; merchant domain verified; payout wallet matches registry | Fail → excluded |
| **Ownership** | Asset owner == merchant payout wallet or vault; transfer delegate == settlement key | Fail → "Avoid" ("NFT belongs to someone else") |
| **Origin record** | Memo exists; recomputed hash == `registration_hash` on the asset | Missing or mismatch → "No origin record" (neutral for non-partners) or "Avoid" (claims one but fails) |
| **Photos** | AI comparison of listing photos vs origin fingerprint crops (E1… vs R1…) | Score 0–100 with evidence |
| **Listing text** | Replica terms ("1:1", "mirror quality"), price far below origin price | Risk points |
| **Seller risk** | Wallet age, prior sales, refund rate, reviews | Risk 0–100 |

Output per offer: `recommendation` (recommended / caution / avoid), `product_score`, `seller_risk`
and an `evidence[]` list, each item with a source id. All of this is shown in the UI and in the
Blink description.

## 10. Cross-app protocol (Solana · Hedera · Sei)

This is a shared JSON envelope, so a buyer's agent on any app can talk to sellers on any app.
Accounts use CAIP-10.

```json
{
  "v": "vcx-agent/1",
  "type": "need | offer | decline",
  "id": "uuid",
  "from": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:<agent pubkey>",
  "created_at": "2026-11-10T10:00:00Z",
  "expires_at": "2026-11-10T10:15:00Z",
  "body": { "...": "need: text, budget, currency | offer: title, price, currency, asset, chain, pay_url" },
  "sig": "<signature over canonical JSON without sig>"
}
```

**Chain ids (verify before use):**
- Solana: devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, mainnet
  `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.
- Hedera: `hedera:testnet` / `hedera:mainnet`.
- Sei EVM: `eip155:1328` (testnet) / `eip155:1329` (mainnet).

**Signatures:** ed25519 for Solana, the account's key type for Hedera, and EIP-191 for Sei.

**Rules:**
- Each app verifies signatures for its own chain and may call the other apps' public verify
  endpoints for theirs.
- `GET /.well-known/vcx-agent.json` on each app publishes its agent endpoint, chains, supported
  currencies and verify endpoint.
- **Payment always settles on the item's own chain.** A cross-chain purchase hands off to the other
  app's pay URL, the same way GlobalChain Muse hands off to Shopify checkout.

## 11. Integrations

### 11.1 Solana Pay (transaction request)

- `GET /api/pay/<offer_id>` returns `{label, icon}`.
- `POST /api/pay/<offer_id>` with `{account}` returns `{transaction, message}`. The transaction is the
  partially signed purchase from §7.4.
- The QR and the link are `solana:https://<host>/api/pay/<offer_id>`.
- Order status: the indexer finds the transaction by reference key (`findReference`), confirms it,
  and marks the order `paid`.

### 11.2 Actions / Blinks

- `GET /api/actions/offer/<offer_id>` returns the Action metadata:
  - title, image, description with the verification summary, and price;
  - a single "Buy for $X USDC" button.
- `POST` with the account returns the same transaction as §11.1.
- `actions.json` at the domain root maps `/i/*` to the Action endpoints.
- Claim Blink: `/api/actions/claim/<claim_id>` (§11.3).
- Register the domain with the Blinks registry for unfurling on X. Check the current registration
  process.

### 11.3 Shopify (partner stores)

- **Install:** OAuth with scopes `read_products,read_orders`. The store becomes a verified merchant
  and gets a merchant vault or connects a payout wallet.
- **Register at origin:** from the Shopify product photos, as in §5.2.
- **`orders/paid` webhook (HMAC-verified):** for each registered line item:
  1. Create a `claim` with an expiry of 30 days.
  2. Email the buyer through Shopify's order notification note, or show the claim link on the order
     status page via an app block.
  3. The claim Blink transfers the NFT from the vault or merchant to the claimer's wallet. It
     requires the order email to match, by sending a one-time code to the order's email.
- **Optional:** if a Solana Pay checkout option for Shopify is available, document it as a USDC
  checkout path. Purchases through it still go through the claim flow.

### 11.4 Wallet sign-in (merchants)

- Sign-In With Solana (SIWS) message, verified server-side.
- Session in an HTTP-only signed cookie.

## 12. Data model (Postgres)

```
merchants(id, name, domain, domain_verified_at, payout_wallet, vault_wallet, agent_pubkey,
          collection_asset, shopify_shop, created_at)
items(id, merchant_id, asset, title, description, price_usdc, photos[], fingerprint jsonb,
      registration_hash, origin_sig, status: draft|listed|sold|delisted, created_at)
offers(id, item_id, merchant_id, price_usdc, expires_at, envelope jsonb, sig)
orders(id, offer_id, buyer_wallet, reference, tx_sig, status: pending|paid|shipped|delivered|failed,
       events jsonb[], created_at)
claims(id, item_id, shopify_order_id, email_hash, code_hash, expires_at, claimed_by, tx_sig)
agent_runs(id, query, steps jsonb, tokens_in, tokens_out, cost_usd, created_at)
records(sig, kind, payload jsonb, hash)   -- memo-anchored records and their full JSON
```

## 13. API (HTTP)

| Method & path | Purpose |
|---|---|
| `POST /api/agent/shop` | `{message, session_id?}` → trace, offers with verification, answer |
| `POST /agent/v1/offers` | Merchant agent endpoint (§8.2) |
| `GET /.well-known/vcx-agent.json` | Discovery (§10) |
| `POST /api/merchants/siws` | Wallet sign-in |
| `POST /api/merchants/domain/verify` | DNS TXT check |
| `POST /api/items` | Create item (photos, details) → registration + mint |
| `POST /api/items/:id/list` · `/delist` | Set or revoke the transfer delegate; create an offer |
| `GET /api/verify/:asset` | Public verification: owner, origin record, merchant, history |
| `GET/POST /api/pay/:offer_id` | Solana Pay transaction request (§11.1) |
| `GET/POST /api/actions/offer/:offer_id` | Blink (§11.2) |
| `GET/POST /api/actions/claim/:claim_id` | Claim Blink (§11.3) |
| `GET /api/orders/:id` | Order status and events |
| `GET /shopify/install` · `/auth/callback` · `POST /shopify/webhooks/orders-paid` | Shopify (§11.3) |

**Pages:** `/` (shopper agent), `/merchant` (dashboard), `/i/<asset>` (item and verify page, Blink
target), `/orders/<id>`, `/partners` (merchant signup).

**Acceptance criteria per story (§5):**
1. A wallet-signed merchant with a verified TXT record shows the "Verified seller" badge in offers.
2. Registering an item creates a Core asset owned by the merchant. The asset carries
   `registration_hash` and `origin_sig`, and `GET /api/verify/<asset>` recomputes the hash.
3. A shopping query returns ≥ 3 merchant offers with signatures verified. The trace lists every tool
   call.
4. After the wallet signs, the explorer shows one transaction with the USDC, fee, NFT and memo legs.
   The order becomes `paid` within 30 seconds.
5. The Blink unfurls on X (or dial.to) and completes the same transaction.
6. A copier's offer pointing at another merchant's asset is marked "Avoid" with the evidence "NFT
   belongs to someone else".
7. A resale moves the NFT to the new owner, and the origin record still verifies.
8. A Shopify test order creates a claim. The claim Blink moves the NFT to the claimer's wallet once.
   Replaying it fails.

## 14. Stack

- **TypeScript**, **Next.js** (App Router) for the UI, API routes and Actions. Deployed on **Vercel**,
  which gives a stable public URL for Blinks, Solana Pay and Shopify.
- **Solana:**
  - `@solana/kit` (web3.js 2.x), or `@solana/web3.js` 1.x where Metaplex needs it.
  - `@metaplex-foundation/umi` + `@metaplex-foundation/mpl-core`.
  - `@solana/spl-token`, `@solana/pay` and `@solana/actions`.
  - Wallet adapter on the client.
- **Data:** Postgres (Neon) with Drizzle ORM; Vercel Blob for photos and metadata JSON.
- **AI:** Vercel AI SDK, with the default model from §8.3.
- **RPC:** Helius (devnet and mainnet), with DAS for asset reads and webhooks for confirmations.
- **Tests:** Vitest for unit tests; `solana-test-validator` with Core loaded for integration tests;
  Playwright for one end-to-end purchase flow on devnet.

## 15. Security

- **Settlement key:** signs only transactions that match the purchase or claim template exactly:
  - the same instruction programs, in order;
  - amounts equal to the signed offer;
  - the asset equal to the offer's;
  - no extra instructions.
  Anything else is refused.
- **Offers** are signed and expire (15 minutes). Price and asset come from the database and are
  checked against the envelope.
- **Ownership is re-read** right before signing.
- **Claims:** one-time codes are hashed; claims expire; each is single-use (DB transaction plus an
  on-chain owner check).
- **Webhooks and pages:** Shopify webhook HMAC (base64) and OAuth HMAC (hex) are verified, and the
  OAuth state is single-use with a TTL. SIWS nonces are single-use.
- **Secrets:**
  - Only in env or KMS.
  - A pre-commit secret scan covers base58 64-byte keys, `shpss_` and provider API key prefixes.
  - `.env` is gitignored.
- **AI output never decides money:** prices, assets and recipients come from the database. The LLM
  only ranks and explains.
- **Rate limits** on the agent, pay and actions endpoints.

## 16. Business model (for the pitch)

- **Protocol fee:** 1% of each agent or Blink sale, paid on-chain in the same transaction (§7.4).
- **Merchant plan:**
  - Free to register items.
  - A paid tier for agent placement, analytics and the Shopify app (for example $29/month).
- **Resale:** an optional merchant royalty, plus the protocol fee, on every resale through the
  network.

## 17. Milestones (Nov 5 – Nov 17)

| Day | Deliverable |
|---|---|
| Nov 5 | Repo, Next.js app, Vercel deploy, Neon, Helius devnet, keys funded; `PRIOR_WORK.md` |
| Nov 6 | Core collection and asset mint; Memo origin record; `GET /api/verify/:asset` |
| Nov 7 | Test USDC mint; purchase transaction builder plus template guard; unit tests |
| Nov 8 | Solana Pay transaction request; indexer by reference; order page |
| Nov 9 | Merchant agents plus signed envelopes; buyer agent tools; ranking guardrail |
| Nov 10 | Photo fingerprint and comparison; copied-QR "Avoid" case; seeded demo merchants |
| Nov 11 | Blinks (offer); `actions.json`; test on dial.to |
| Nov 12 | Merchant onboarding (SIWS and DNS TXT); dashboard; list and delist |
| Nov 13 | Shopify app: OAuth, register at origin, `orders/paid` → claim Blink |
| Nov 14 | `/.well-known/vcx-agent.json`; envelope interop test with GlobalChain Muse (Hedera) |
| Nov 15 | Integration tests on the local validator; one Playwright devnet purchase |
| Nov 16 | Demo video (3 min); README; real merchant outreach (goal: 3–5 installs) |
| Nov 17 | Alliance application submitted with links to all three apps |

**Cut order if time runs out:** Shopify (§11.3) first, then cross-app interop (§10), then resale.
Never cut the atomic purchase, Blinks or the copy check.

## 18. Demo script (3 min)

1. **0:00** — Problem: an agent can't tell a real seller from a clone.
2. **0:20** — The shopper asks for an everyday bag under $400. The agent trace shows offers arriving
   signed from merchant agents.
3. **0:50** — Verification: the genuine item passes. A copy reusing the real QR is flagged "Avoid"
   because its NFT is in another wallet.
4. **1:30** — Buy: one Phantom signature. The explorer shows USDC, fee and NFT moving in one
   transaction.
5. **2:00** — A Blink on X: the same offer, bought from the post.
6. **2:30** — Merchant view: verified badge, items, sales; the Shopify claim flow.
7. **2:50** — Close: one trust layer for agent commerce, live on Solana, compatible with the Hedera
   and Sei apps.

## 19. Metrics to report to Alliance

- Merchants onboarded and items registered.
- Agent purchases and Blink purchases on devnet.
- Copies caught in tests and demos.
- Time from "need" to settled purchase.
- Shopify installs.

## 20. Assumptions to confirm

- **Name and branding:** "VeriChainX Sol" is a placeholder.
- **AI provider and budget:** defaults in §8.3. This budget is separate from the Meta hackathon's
  R150.
- **Sei app:** its location, chain (Sei EVM vs Cosmos side) and whether it adopts the §10 envelope.
- **Blinks registration** and **Shopify Solana Pay** availability: check the current processes before
  November 11 and November 13.
- **CAIP chain ids** in §10: verify against the current CAIP registry.

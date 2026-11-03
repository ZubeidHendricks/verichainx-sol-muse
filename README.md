# VeriChainX Sol

Verified sellers, and ownership that moves with payment, for AI shopping agents on Solana.

Shopping is a conversation between agents. Each shop's sales agent greets the shopper and pitches its items; the
shopper's own agent checks every pitch against the chain (seller, ownership, origin record, price, photos) and marks
it recommended, caution or avoid. The shopper then buys with one wallet signature. A single transaction pays the merchant in USDC, pays a 1%
protocol fee, moves the item's Metaplex Core NFT to the buyer and records the order with a memo.
Either all of it lands or none of it does.

Built for the Meta Global AI Developer Hackathon: the shopper's agent runs on Muse Spark (Meta Model API).

The full spec is in [`docs/SPEC.md`](docs/SPEC.md). Prior work and what came from where is in
[`PRIOR_WORK.md`](PRIOR_WORK.md).

## Status

Work in progress, devnet only. Live at https://verichainx-sol.vercel.app.

**Built:**
- Signed `vcx-agent/1` envelopes.
- Origin and order memo records.
- Core collection, item mint (with origin record), list and delist.
- The atomic purchase transaction.
- The settlement-key template guard and the on-chain owner check.
- Postgres schema (Drizzle; PGlite locally and in tests).
- Merchants with sealed per-merchant vault and agent keys.
- Registration, listing and signed offers.
- Solana Pay transaction request (`/api/pay/:offer`).
- Blink (`/api/actions/offer/:offer`, `/actions.json`).
- Order confirmation by reference (`/api/orders/:id`).
- Merchant agents (`POST /agent/v1/offers`) and discovery (`/.well-known/vcx-agent.json`).
- Verifier: seller, ownership, origin record, price, replica language, and the shop's history (completed sales and
  age) as seller risk.
- Photo check: each registered photo's perceptual hash goes into the origin record (so the NFT's hash covers it), and
  the listing photo is compared with them. A photo that isn't a registered one goes to a vision model when
  `PHOTO_MODEL` is set (Muse Spark, or a free Groq model); its "different item" adds risk, its "same" never clears a
  failed check.
- Buyer agent (`POST /api/agent/shop`) on Muse Spark (Meta Model API), with Groq as a fallback and the scripted
  engine as the last resort. The model picks the tool calls; code verifies every offer and caps each recommendation
  with the guardrail. `npm run agent:live` runs one real model against a local chain.
- Public verification by asset (`/api/verify/:asset`).
- Web pages: the shopping agent (`/`), offers with Solana Pay QR and live payment status (`/o/:offer`), ownership NFT
  and origin record (`/i/:asset`), orders (`/orders/:id`) and shops (`/merchant`, devnet demo behind `MERCHANT_DEMO=1`).
- Buy in the app with a browser wallet (Wallet Standard: Phantom, Solflare, Backpack), next to the Solana Pay QR.
- Other apps' agents as offer sources (`AGENT_PEERS`), and a demo copier agent (`DEMO_COPIER=1`) for the copy check.
- Shop domain verification by DNS TXT record (`_vcx.<domain>` → `vcx-verify=<shop wallet>`).
- Sign In With Solana for `/merchant`. Shops keep items in their own wallet, which signs each list and delist;
  the service-held wallet is a devnet demo option only.
- Resale: a buyer can list an item they hold from `/merchant`, as an own-wallet shop of their own. One shop per
  wallet; naming a shop later takes over the resale shop.
- Shopify partner stores (§11.3): a signed-in shop connects its store by OAuth (GraphQL Admin API), its products are
  registered at origin with their photos, and each `orders/paid` webhook (HMAC-checked) creates a claim link. The
  buyer gives the order's email and a wallet, and the NFT moves to them once; five wrong emails lock the claim.
  Needs `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` from a Shopify app with protected customer data access for orders.
  The local demo fakes a paid order (`POST /api/local/shopify-order`) to show the claim page.
- Agent-to-agent shopping on `/`: a verified shop's sales agent welcomes the shopper, and every shop's agent can pitch
  or answer (a signed offer carrying its pitch, or a signed `reply`). Shop agents see the conversation so far and stick
  to their own catalogue and prices. The shopper's agent checks each pitch, notes whether replies hold up against the
  shop's registered items, and answers the shopper. With `DEMO_COPIER=1` a copier's agent pitches cheap copies, and the
  checks catch them. Conversations have shareable pages (`/c/:id`).
- Real stores next to the makers: the shopper's agent searches Shopify's Global Catalog (`SHOPIFY_CATALOG=1`) and
  checks each store itself: own domain and its age (RDAP), refund policy, reviews, replica and brand-copy wording, and
  dropship signs ("Ships From" options, supplier apps, default vendor, supplier boilerplate, overseas or slow
  delivery, inflated markdowns). Store items are bought on the store's own checkout; there's no NFT.
- A 0–100 scorecard on every result: authentic 30%, seller 25%, quality 25%, value 10%, delivery 10%. Anything to
  avoid is capped at 20; the score ranks within a label and never lifts one.
- MCP server for other developers' agents (`/api/mcp`, Streamable HTTP, 30 calls a minute per IP, set up at
  `/developers`): `find_products`, `check_product_page`, `verify_item`, `verify_offer_signature`, `prepare_purchase`,
  `buy_with_agent_wallet`, `send_transaction`, `order_status`. A bot can pay from its own wallet under a spending cap,
  with the NFT going to its owner; only that order's exact purchase is relayed. `scripts/agent-buy.mts` is a whole bot.
- Test USDC faucet on devnet (`POST /api/faucet`), and orders marked shipped and delivered by the seller, each step an
  order memo on Solana.
- Every agent run is saved: a shareable page per run (`/runs/:id`) and a list (`/runs`).
- A local demo on an in-process Solana VM (`npm run demo:local`), and a browser test on it (`npm run e2e`).
- Devnet setup and an end-to-end devnet purchase script. The first run, on 2026-10-29, was
  [this purchase](https://explorer.solana.com/tx/4uYM5ztLWhEtbFeSygss3LUmG7yqkKD5zzjdBG5gg5KdvzLfVtGkiTtyMQ6ctZj6oF75dJiytwZ9LRMtcs2H9Edq?cluster=devnet):
  129 USDC split 127.71 to the merchant and 1.29 to the treasury, with the NFT moving to the buyer, in one transaction.

## Develop

```bash
npm install
npm test          # fetches the Core program once, then runs unit and LiteSVM tests
npm run typecheck
npm run dev
```

The LiteSVM tests run the real SPL Token, Associated Token Account, Memo and mainnet Metaplex Core
programs in-process. No validator or devnet SOL is needed.

A pre-commit hook (`scripts/secret-scan.sh`) blocks secret keys and API keys. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Devnet: `npm run devnet:setup` creates the service keys, a test USDC mint and `.env.local`. Fund the fee
payer it prints at https://faucet.solana.com. Then `npm run devnet:e2e` runs one real purchase.

To try the whole app with nothing to set up: `npm run demo:local`, then open http://localhost:3200. It runs on
LiteSVM with an in-memory database, seeded with the demo shops, and resets on restart. Without a model key the agent
uses the scripted engine. `npm run e2e` runs the Playwright test on it: the shopper asks the shop agents, a test wallet
in the page buys the real tote (the copy is flagged), signs in with Solana, resells it, and lists a new item.

To try the web app on devnet: `npm run devnet:seed` mints three demo shops' items, then `MERCHANT_DEMO=1 npm run dev`.
Phone wallets need the app on a public URL (set `APP_URL` to your tunnel). Without a phone,
`npm run demo:wallet -- <offerId> http://localhost:3000` plays the buyer's wallet.

The local database (PGlite, `.data/pglite`) is single-process and locked while in use: stop `npm run dev`
before running `devnet:seed` or `scripts/db-peek.mts`.

## Deploy

On Vercel with Neon Postgres: the app uses `DATABASE_URL` when it's set (PGlite otherwise). Set the variables from
`.env.example` on the project (not `MODEL_API_KEY` on a public site: anyone can run the agent), then:

```bash
DATABASE_URL=<unpooled url> npx tsx scripts/db-migrate.mts
DATABASE_URL=<unpooled url> APP_URL=https://<your app> npm run devnet:seed
vercel deploy --prod
```

`.vercelignore` keeps `keys/`, `.env*` and local data out of the upload.

## Layout

```
src/lib/
  canonical.ts       canonical JSON and SHA-256
  envelope.ts        vcx-agent/1 envelopes: sign and verify (ed25519)
  records.ts         vcx1: memo records
  money.ts           USDC base units and fee split
  chains.ts          CAIP-2/10 ids for Solana, Hedera and Sei
  solana/
    purchase.ts      atomic purchase builder, template guard, preparePurchase
    items.ts         collection, register (mint + origin memo), list, delist, ownership check
    memo.ts          raw Memo instruction
    umi.ts           Umi setup and key loading
src/server/
  db/                Drizzle schema and PGlite setup (migrations in drizzle/)
  catalog.ts         merchants, item registration, list/delist, signed offers
  pay.ts             startPurchase (Solana Pay + Blinks), refreshOrder (confirm by reference)
  handlers.ts        HTTP handlers for the routes in src/app/
  chain.ts           ChainPort: RPC implementation
  sealed.ts          AES-GCM for service-held keys
  agents/            shop sales agents, verifier, the shopper's agent, demo copier
  chat.ts            conversations between the shopper, shop agents and the shopper's agent
tests/               Vitest; LiteSVM for anything on-chain, in-memory PGlite for the database
```

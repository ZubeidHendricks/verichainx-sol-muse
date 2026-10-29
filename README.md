# VeriChainX Sol

Verified sellers, and ownership that moves with payment, for AI shopping agents on Solana.

A shopper's agent collects signed offers from merchants' agents and checks the seller and the item.
It then buys with one wallet signature. A single transaction pays the merchant in USDC, pays a 1%
protocol fee, moves the item's Metaplex Core NFT to the buyer and records the order with a memo.
Either all of it lands or none of it does.

The full spec is in [`docs/SPEC.md`](docs/SPEC.md). Prior work and what came from where is in
[`PRIOR_WORK.md`](PRIOR_WORK.md).

## Status

Work in progress, devnet only.

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
- Verifier: seller, ownership, origin record, price and replica language.
- Buyer agent, scripted engine, with the ranking guardrail in code (`POST /api/agent/shop`).
- Public verification by asset (`/api/verify/:asset`).
- Devnet setup and an end-to-end devnet purchase script. The first run, on 2026-10-29, was
  [this purchase](https://explorer.solana.com/tx/4uYM5ztLWhEtbFeSygss3LUmG7yqkKD5zzjdBG5gg5KdvzLfVtGkiTtyMQ6ctZj6oF75dJiytwZ9LRMtcs2H9Edq?cluster=devnet):
  129 USDC split 127.71 to the merchant and 1.29 to the treasury, with the NFT moving to the buyer, in one transaction.

**Next:**
- LLM engine for the buyer agent on Groq (`GROQ_API_KEY`), with AI photo comparison.
- Web UI.
- SIWS and DNS verification.
- Shopify.

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
  agents/            merchant agents, verifier, buyer agent
tests/               Vitest; LiteSVM for anything on-chain, in-memory PGlite for the database
```

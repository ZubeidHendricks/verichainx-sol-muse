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

**Next:**
- Database.
- Solana Pay and Blink endpoints.
- Merchant and buyer agents.
- Web UI.

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
tests/               Vitest; *.svm.test.ts run on LiteSVM
```

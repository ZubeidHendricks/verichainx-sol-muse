# Prior work

VeriChainX Sol is a new codebase, started October 28, 2026. No code was copied from the projects below.
It re-implements some of their ideas in TypeScript on Solana.

| Idea | Earlier project | Here |
|---|---|---|
| Signed agent-to-agent offers | GlobalChain Muse (Hedera, Python, Meta hackathon, Oct 2026), ECDSA-signed messages | `vcx-agent/1` envelopes, ed25519, CAIP-10 senders (`src/lib/envelope.ts`) |
| Hash-only provenance records | GlobalChain Muse and VeriChainX Muse, canonical JSON + SHA-256 anchored on HCS | Same hashing, anchored with the Memo program (`src/lib/records.ts`) |
| One NFT per physical item; copies caught because the NFT isn't in the copier's wallet | GlobalChain Muse (HTS NFTs), AfriChain | Metaplex Core assets and a pre-signing owner check (`src/lib/solana/`) |
| Seller-risk signals, replica-language lexicon | VeriChainX Muse / GlobalChain Muse | Planned (§9 of `docs/SPEC.md`) |
| Shopify partner install, `orders/paid` → ownership claim | GlobalChain Muse | Planned (§11.3) |

New here:
- One atomic Solana transaction for USDC, the protocol fee and the NFT (`src/lib/solana/purchase.ts`).
- The settlement-key template guard.
- Solana Pay and Blinks.

Third-party code is used only through npm packages listed in `package.json`. The Metaplex Core
program binary used in tests is downloaded from mainnet by `scripts/fetch-programs.mjs` and is not
committed.

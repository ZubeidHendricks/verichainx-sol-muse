# Prior work

This repository is a copy of VeriChainX Sol (`verichainx-sol`), made on 3 November 2026 with its full git history
to be the Meta Global AI Developer Hackathon entry (building period 27 October – 4 November 2026). Every commit
below was made during that period; the Muse-specific changes are the commits after the copy.

VeriChainX Sol is a new codebase, started October 28, 2026. No code was copied from the projects below.
It re-implements some of their ideas in TypeScript on Solana.

| Idea | Earlier project | Here |
|---|---|---|
| Signed agent-to-agent offers | GlobalChain Muse (Hedera, Python, Meta hackathon, Oct 2026), ECDSA-signed messages | `vcx-agent/1` envelopes, ed25519, CAIP-10 senders (`src/lib/envelope.ts`) |
| Hash-only provenance records | GlobalChain Muse and VeriChainX Muse, canonical JSON + SHA-256 anchored on HCS | Same hashing, anchored with the Memo program (`src/lib/records.ts`) |
| One NFT per physical item; copies caught because the NFT isn't in the copier's wallet | GlobalChain Muse (HTS NFTs), AfriChain | Metaplex Core assets and a pre-signing owner check (`src/lib/solana/`) |
| Seller-risk signals, replica-language lexicon | VeriChainX Muse / GlobalChain Muse | Seller risk from the shop's history and replica wording (`src/server/agents/verify.ts`) |
| Shopify partner install, `orders/paid` → ownership claim | GlobalChain Muse | OAuth install, product registration and claim links (`src/server/shopify.ts`) |

New here:
- One atomic Solana transaction for USDC, the protocol fee and the NFT (`src/lib/solana/purchase.ts`).
- The settlement-key template guard.
- Solana Pay and Blinks.

Third-party code is used only through npm packages listed in `package.json`. The Metaplex Core
program binary used in tests is downloaded from mainnet by `scripts/fetch-programs.mjs` and is not
committed.

## Ported from verichainx-shop (November 2026)

The Shopify catalog search, store and dropship checks, scorecard, MCP tools, agent-wallet purchase, faucet and the
agent-buy bot were first built in a sibling app, `verichainx-shop` (Vercel project of the same name, created 30 October
2026, during the hackathon), and ported here
on 1 November 2026, adapted to this app's chain port, verdicts and agent-to-agent chat.

## Procurement for companies (3 November 2026)

Company boards, the procurement agent, spending policy, voting and lots (`src/server/procure.ts`, `src/app/teams/`)
were written here on 3 November 2026, during the hackathon. The board's voting was guided by a feature list from
another of the author's apps (a shared Kanban board with votes); no code was copied from it.

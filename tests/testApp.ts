import { generateSigner, type Signer } from "@metaplex-foundation/umi";

import { parseUsdc } from "@/lib/money";
import type { App } from "@/server/app";
import { openDb } from "@/server/db";

import { LocalChain, SvmChainPort } from "./svm";

export type TestApp = App & { local: LocalChain; buyer: Signer; clock: { now: Date } };

/** The whole service on LiteSVM and in-memory Postgres, with a funded buyer and a test USDC mint. */
export async function makeTestApp(): Promise<TestApp> {
  const local = new LocalChain();
  const u = local.umi;
  const keys = { feePayer: generateSigner(u), settlement: generateSigner(u), anchor: generateSigner(u) };
  const buyer = generateSigner(u);
  const treasury = generateSigner(u);
  local.fund(keys.feePayer, keys.anchor, buyer);
  const usdcMint = await local.createUsdc(keys.feePayer, [
    { owner: buyer.publicKey, amount: parseUsdc("1000") }, { owner: treasury.publicKey, amount: 0n },
  ]);
  const clock = { now: new Date() };
  return {
    db: await openDb(), chain: new SvmChainPort(local), umi: u, keys, local, buyer, clock,
    config: {
      cluster: "devnet", appUrl: "https://sol.example.test", usdcMint, treasury: treasury.publicKey, feeBps: 100,
      sealSecret: "test-seal-secret-test-seal-secret-0123", offerTtlMinutes: 15,
    },
    now: () => clock.now,
  };
}

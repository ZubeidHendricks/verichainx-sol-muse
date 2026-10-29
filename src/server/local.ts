import { randomBytes } from "node:crypto";

import { generateSigner, publicKey } from "@metaplex-foundation/umi";
import bs58 from "bs58";

import { parseUsdc } from "@/lib/money";

import type { App } from "./app";
import { Refused } from "./catalog";
import { openDb } from "./db";
import { seedDemoShops } from "./demo-shops";
import { LocalChain, SvmChainPort } from "./local-chain";

/**
 * The local demo (`VCX_LOCAL_CHAIN=1`): the whole app on an in-process Solana VM and an in-memory database,
 * seeded with the demo shops at startup. Nothing touches devnet, and everything resets on restart. The
 * browser test (`npm run e2e`) runs on it, with a test wallet that sends through `/api/local/send`.
 */
export type LocalApp = App & { local: LocalChain };

export const isLocal = () => process.env.VCX_LOCAL_CHAIN === "1";

export async function localApp(models: App["agentModels"]): Promise<LocalApp> {
  const local = new LocalChain();
  const umi = local.umi;
  const keys = { feePayer: generateSigner(umi), settlement: generateSigner(umi), anchor: generateSigner(umi) };
  const treasury = generateSigner(umi);
  local.fund(keys.feePayer, keys.anchor);
  const usdcMint = await local.createUsdc(keys.feePayer, [{ owner: treasury.publicKey, amount: 0n }]);
  const app: LocalApp = {
    db: await openDb(), chain: new SvmChainPort(local), umi, keys, local,
    config: {
      cluster: "devnet", appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""), usdcMint,
      treasury: treasury.publicKey, feeBps: Number(process.env.PROTOCOL_FEE_BPS ?? 100),
      sealSecret: randomBytes(32).toString("hex"), offerTtlMinutes: 15,
    },
    now: () => new Date(),
    agentModels: models,
  };
  await seedDemoShops(app);
  return app;
}

function asLocal(app: App): LocalApp {
  if (!isLocal() || !("local" in app)) throw new Refused("only available on the local chain");
  return app as LocalApp;
}

/** Gives a wallet SOL for fees and 500 test USDC. */
export async function fundWallet(app: App, address: string) {
  const l = asLocal(app);
  l.local.airdrop(publicKey(address));
  await l.local.mintUsdc(l.config.usdcMint, l.keys.feePayer, address, parseUsdc("500"));
}

/** Submits a transaction a wallet has signed; what `sendTransaction` on an RPC node would do. */
export function submitSigned(app: App, base64: string): string {
  const l = asLocal(app);
  const tx = l.umi.transactions.deserialize(Buffer.from(base64, "base64"));
  try {
    l.local.submit(tx);
  } catch (e) {
    throw new Refused((e as Error).message.split("\n")[0]);
  }
  return bs58.encode(tx.signatures[0]);
}

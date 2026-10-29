import { randomBytes } from "node:crypto";

import type { KeypairSigner, Umi } from "@metaplex-foundation/umi";

import type { Cluster } from "@/lib/chains";
import { signerFromSecret, makeUmi } from "@/lib/solana/umi";

import { modelsFromEnv, type ChatModel } from "./agents/llm";
import { RpcChain, type ChainPort } from "./chain";
import { openDb, type Db } from "./db";

/** Service keys (§7.5). The settlement key holds nothing; it is only ever a transfer delegate. */
export type ServiceKeys = { feePayer: KeypairSigner; settlement: KeypairSigner; anchor: KeypairSigner };

export type AppConfig = {
  cluster: Cluster;
  appUrl: string;
  usdcMint: string;
  treasury: string;
  feeBps: number;
  sealSecret: string;
  offerTtlMinutes: number;
};

export type App = {
  db: Db; chain: ChainPort; umi: Umi; keys: ServiceKeys; config: AppConfig; now: () => Date;
  /** Models for the buyer agent, tried in order; none means the scripted engine. */
  agentModels?: ChatModel[];
};

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

/**
 * One App per process, kept on globalThis: Next bundles each route separately, and two PGlite
 * instances on the same data directory don't see each other's writes.
 */
const shared = globalThis as typeof globalThis & { __vcxApp?: Promise<App> };

/** The app wired from the environment. Tests build their own App with LiteSVM and in-memory PGlite. */
export function getApp(): Promise<App> {
  shared.__vcxApp ??= (async () => {
    const umi = makeUmi(env("SOLANA_RPC_URL"));
    return {
      db: await openDb(process.env.PGLITE_DIR ?? ".data/pglite"),
      chain: new RpcChain(umi),
      umi,
      keys: {
        feePayer: signerFromSecret(umi, env("FEE_PAYER_SECRET")),
        settlement: signerFromSecret(umi, env("SETTLEMENT_SECRET")),
        anchor: signerFromSecret(umi, env("ANCHOR_SECRET")),
      },
      config: {
        cluster: (process.env.SOLANA_CLUSTER ?? "devnet") as Cluster,
        appUrl: env("APP_URL").replace(/\/$/, ""),
        usdcMint: env("USDC_MINT"),
        treasury: env("TREASURY_ADDRESS"),
        feeBps: Number(process.env.PROTOCOL_FEE_BPS ?? 100),
        sealSecret: env("KEY_SEAL_SECRET"),
        offerTtlMinutes: 15,
      },
      now: () => new Date(),
      agentModels: modelsFromEnv(),
    };
  })();
  return shared.__vcxApp;
}

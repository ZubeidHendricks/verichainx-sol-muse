/**
 * One-time devnet setup (§17, Nov 5): service keys, SOL for fees, a test USDC mint and the treasury's
 * USDC account. Writes .env.local. Safe to re-run: existing keys and the mint are reused.
 *
 *   npx tsx scripts/devnet-setup.mts [--rpc https://api.devnet.solana.com]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { generateSigner, lamports, publicKey, sol, transactionBuilder, type KeypairSigner } from "@metaplex-foundation/umi";
import {
  SPL_TOKEN_PROGRAM_ID, createAccount, createIdempotentAssociatedToken, findAssociatedTokenPda, initializeMint2,
} from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";

import { makeUmi, signerFromSecret } from "../src/lib/solana/umi.ts";

const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "https://api.devnet.solana.com";
const umi = makeUmi(rpc);
mkdirSync("keys", { recursive: true });

function key(name: string): KeypairSigner {
  const file = `keys/${name}.json`;
  if (existsSync(file)) return signerFromSecret(umi, readFileSync(file, "utf8"));
  const k = generateSigner(umi);
  writeFileSync(file, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

const keys = { feePayer: key("fee-payer"), settlement: key("settlement"), anchor: key("anchor"), treasury: key("treasury") };
for (const [name, k] of Object.entries(keys)) console.log(`${name.padEnd(10)} ${k.publicKey}`);

async function balance(k: KeypairSigner) {
  return Number((await umi.rpc.getBalance(k.publicKey)).basisPoints) / 1e9;
}

// Only the fee payer needs SOL: it pays every fee and all rent. The other keys only sign.
for (const k of [keys.feePayer]) {
  if ((await balance(k)) >= 0.5) continue;
  try {
    await umi.rpc.airdrop(k.publicKey, sol(1));
    console.log(`airdropped 1 SOL to ${k.publicKey}`);
  } catch (e) {
    console.error(`airdrop to ${k.publicKey} failed (${(e as Error).message.split("\n")[0]}).`);
    console.error(`Send it devnet SOL at https://faucet.solana.com (address ${k.publicKey}), then re-run this script.`);
    process.exit(2);
  }
}

let mint = existsSync("keys/usdc-mint.json") ? signerFromSecret(umi, readFileSync("keys/usdc-mint.json", "utf8")) : null;
if (!mint || !(await umi.rpc.accountExists(mint.publicKey))) {
  mint = key("usdc-mint");
  const rent = await umi.rpc.getRent(82);
  await transactionBuilder()
    .add(createAccount(umi, { newAccount: mint, payer: keys.feePayer, lamports: lamports(rent.basisPoints),
      space: 82, programId: SPL_TOKEN_PROGRAM_ID }))
    .add(initializeMint2(umi, { mint: mint.publicKey, decimals: 6, mintAuthority: keys.feePayer.publicKey, freezeAuthority: null }))
    .add(createIdempotentAssociatedToken(umi, {
      payer: keys.feePayer, owner: keys.treasury.publicKey, mint: mint.publicKey,
      ata: findAssociatedTokenPda(umi, { owner: keys.treasury.publicKey, mint: mint.publicKey })[0],
    }))
    .setFeePayer(keys.feePayer)
    .sendAndConfirm(umi);
  console.log(`test USDC mint ${mint.publicKey} (mint authority: fee payer)`);
}

const env = {
  SOLANA_CLUSTER: "devnet",
  SOLANA_RPC_URL: rpc,
  FEE_PAYER_SECRET: bs58.encode(keys.feePayer.secretKey),
  SETTLEMENT_SECRET: bs58.encode(keys.settlement.secretKey),
  ANCHOR_SECRET: bs58.encode(keys.anchor.secretKey),
  TREASURY_ADDRESS: keys.treasury.publicKey,
  USDC_MINT: publicKey(mint.publicKey),
  PROTOCOL_FEE_BPS: "100",
  KEY_SEAL_SECRET: existsSync(".env.local")
    ? (/^KEY_SEAL_SECRET=(.+)$/m.exec(readFileSync(".env.local", "utf8"))?.[1] ?? randomBytes(32).toString("base64url"))
    : randomBytes(32).toString("base64url"),
  APP_URL: "http://localhost:3000",
};
writeFileSync(".env.local", Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
console.log("wrote .env.local (gitignored). Keys are in keys/ (gitignored).");

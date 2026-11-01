import { createIdempotentAssociatedToken, findAssociatedTokenPda, mintTokensToChecked } from "@metaplex-foundation/mpl-toolbox";
import { publicKey, transactionBuilder } from "@metaplex-foundation/umi";

import { USDC_DECIMALS, formatUsdc, parseUsdc } from "@/lib/money";

import type { App } from "./app";
import { Refused } from "./catalog";

/** Test USDC per request: enough for a few of the demo items. */
export const FAUCET_AMOUNT = parseUsdc("500");

/**
 * Devnet (and the local demo) only: mints test USDC to a wallet so anyone can try a purchase. The fee payer is the
 * test mint's authority and pays for the token account, so the wallet needs no SOL.
 */
export async function fundTestUsdc(app: App, account: string): Promise<{ amount: string; signature: string }> {
  if (app.config.cluster === "mainnet") throw new Refused("There's no faucet on mainnet.");
  let owner;
  try {
    owner = publicKey(account);
  } catch {
    throw new Refused("account must be a Solana address");
  }
  const mint = publicKey(app.config.usdcMint);
  const ata = findAssociatedTokenPda(app.umi, { owner, mint })[0];
  const signature = await app.chain.send(transactionBuilder().setFeePayer(app.keys.feePayer)
    .add(createIdempotentAssociatedToken(app.umi, { payer: app.keys.feePayer, ata, owner, mint }))
    .add(mintTokensToChecked(app.umi, { mint, token: ata, mintAuthority: app.keys.feePayer, amount: FAUCET_AMOUNT, decimals: USDC_DECIMALS })));
  return { amount: formatUsdc(FAUCET_AMOUNT), signature };
}

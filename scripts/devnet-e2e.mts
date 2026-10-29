/**
 * One real purchase on devnet, end to end, through the same service code the routes use:
 * merchant → registered item NFT → listing → signed offer → partially signed purchase →
 * buyer wallet signs → order confirmed by reference. Needs `npm run devnet:setup` first.
 *
 *   npm run devnet:e2e
 *
 * Uses its own database (.data/devnet-e2e) and a demo buyer key in keys/demo-buyer.json. The buyer
 * gets test USDC from the mint (the fee payer is the mint authority) and needs no SOL.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { generateSigner, publicKey, signTransaction, transactionBuilder, type KeypairSigner } from "@metaplex-foundation/umi";
import { createIdempotentAssociatedToken, findAssociatedTokenPda, mintTokensToChecked } from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";

import { explorerTx } from "../src/lib/chains";
import { parseUsdc } from "../src/lib/money";
import { signerFromSecret } from "../src/lib/solana/umi";
import { getApp } from "../src/server/app";
import { createMerchant, listItem, makeOffer, registerItem } from "../src/server/catalog";
import { refreshOrder, startPurchase } from "../src/server/pay";

process.loadEnvFile(".env.local");
process.env.PGLITE_DIR ??= ".data/devnet-e2e";
const app = await getApp();
const { umi, keys, config } = app;
const link = (sig: string) => explorerTx(sig, config.cluster);

function buyerKey(): KeypairSigner {
  const file = "keys/demo-buyer.json";
  if (existsSync(file)) return signerFromSecret(umi, readFileSync(file, "utf8"));
  const k = generateSigner(umi);
  writeFileSync(file, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

async function usdc(owner: string) {
  const ata = findAssociatedTokenPda(umi, { owner: publicKey(owner), mint: publicKey(config.usdcMint) })[0];
  const acc = await umi.rpc.getAccount(ata);
  return acc.exists ? new DataView(acc.data.buffer, acc.data.byteOffset + 64, 8).getBigUint64(0, true) : 0n;
}

const buyer = buyerKey();
console.log(`buyer      ${buyer.publicKey}`);
if ((await usdc(buyer.publicKey)) < parseUsdc("200")) {
  const ata = findAssociatedTokenPda(umi, { owner: buyer.publicKey, mint: publicKey(config.usdcMint) })[0];
  const sig = await app.chain.send(transactionBuilder()
    .add(createIdempotentAssociatedToken(umi, { payer: keys.feePayer, ata, owner: buyer.publicKey, mint: publicKey(config.usdcMint) }))
    .add(mintTokensToChecked(umi, { mint: publicKey(config.usdcMint), token: ata, mintAuthority: keys.feePayer,
      amount: parseUsdc("500"), decimals: 6 }))
    .setFeePayer(keys.feePayer));
  console.log(`minted 500 test USDC to the buyer  ${link(sig)}`);
}

const merchant = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
console.log(`merchant   ${merchant.wallet} (vault)`);
let item = await registerItem(app, merchant.id, {
  title: "Woven Market Tote", description: "Hand-woven in Cape Town.", price: "129",
  photos: ["https://cdn.example.test/tote-1.jpg"],
});
console.log(`item NFT   ${item.asset}  origin ${link(item.originSig!)}`);
item = await listItem(app, item.id);
console.log(`listed     settlement key is the transfer delegate`);

const offer = await makeOffer(app, item.id, { pitch: "Hand-woven, brass maker's tag." });
const start = await startPurchase(app, offer.id, buyer.publicKey);
console.log(`offer      ${offer.id} → order ${start.order.id}\n           ${start.message}`);

// What the buyer's wallet does with the Solana Pay / Blink transaction.
const tx = await signTransaction(umi.transactions.deserialize(Buffer.from(start.transaction, "base64")), [buyer]);
const sig = bs58.encode(await umi.rpc.sendTransaction(tx, { commitment: "confirmed" }));
const bh = await umi.rpc.getLatestBlockhash({ commitment: "confirmed" });
await umi.rpc.confirmTransaction(bs58.decode(sig), { strategy: { type: "blockhash", ...bh }, commitment: "confirmed" });
console.log(`purchase   ${link(sig)}`);

let order = start.order;
for (let i = 0; i < 20 && order.status === "pending"; i++) {
  order = await refreshOrder(app, order.id);
  if (order.status === "pending") await new Promise((r) => setTimeout(r, 1500));
}
const nft = await app.chain.getAsset(item.asset!);
console.log(`order      ${order.status}${order.txSig ? ` (${order.txSig.slice(0, 12)}…)` : ""}`);
console.log(`NFT owner  ${nft?.owner} ${nft?.owner === buyer.publicKey ? "= buyer" : "≠ buyer"}`);
console.log(`USDC       merchant ${Number(await usdc(merchant.wallet)) / 1e6}, treasury ${Number(await usdc(config.treasury)) / 1e6}`);
process.exit(order.status === "paid" ? 0 : 1);

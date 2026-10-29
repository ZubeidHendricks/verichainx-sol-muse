/**
 * Plays the shopper's wallet for a demo without a phone: fetches the Solana Pay transaction for an
 * offer, signs it with the demo buyer key (keys/demo-buyer.json, funded by `npm run devnet:e2e`) and
 * sends it to devnet. The offer page then turns to "Paid" on its own.
 *
 *   npm run demo:wallet -- <offerId> [http://localhost:3100]
 */
import { readFileSync } from "node:fs";

import { signTransaction } from "@metaplex-foundation/umi";
import bs58 from "bs58";

import { makeUmi, signerFromSecret } from "../src/lib/solana/umi";

const [offer, base = "http://localhost:3000"] = process.argv.slice(2);
if (!offer) throw new Error("usage: npm run demo:wallet -- <offerId> [appUrl]");
const umi = makeUmi(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
const buyer = signerFromSecret(umi, readFileSync("keys/demo-buyer.json", "utf8"));
const url = `${base}/api/pay/${offer}`;

console.log("label  ", (await (await fetch(url)).json()).label);
const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: buyer.publicKey }) });
const body = await r.json();
if (!r.ok) throw new Error(`the app refused: ${JSON.stringify(body)}`);
console.log("message", body.message);
const tx = await signTransaction(umi.transactions.deserialize(Buffer.from(body.transaction, "base64")), [buyer]);
console.log("sent   ", bs58.encode(await umi.rpc.sendTransaction(tx, { commitment: "confirmed" })));

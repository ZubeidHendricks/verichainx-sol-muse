/**
 * A shopping bot that pays in USDC from its own Solana wallet, through the VeriChainX MCP server. Devnet only: it gets
 * test USDC from the faucet, finds a recommended maker item, buys it under a spending cap for its owner, and waits for
 * the order to be paid. Copy this into your own agent.
 *
 *   npx tsx scripts/agent-buy.mts [app url] [query] [owner wallet]
 *   npx tsx scripts/agent-buy.mts https://verichainx-sol.vercel.app "woven tote"
 */
import { generateSigner, signTransaction } from "@metaplex-foundation/umi";

import { makeUmi } from "../src/lib/solana/umi";

const [base = "https://verichainx-sol.vercel.app", query = "woven tote", owner] = process.argv.slice(2);
const CAP_USDC = 200;

let id = 0;
async function call(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const body = text.includes("data: ") ? text.slice(text.indexOf("data: ") + 6).split("\n")[0] : text;
  const { result, error } = JSON.parse(body);
  if (error) throw new Error(`${name}: ${error.message}`);
  if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

// Only to build and sign transactions; nothing is sent from here except through the MCP server.
const umi = makeUmi("https://api.devnet.solana.com");
// The bot's own wallet. A real agent loads its key from a secret store, funded by its owner with only what it may spend.
const bot = generateSigner(umi);
console.log(`bot wallet   ${bot.publicKey}`);
const faucet = await fetch(`${base}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: bot.publicKey }) });
if (!faucet.ok) throw new Error(`faucet: ${(await faucet.json()).message}`);
console.log(`funded       ${(await faucet.json()).amount} test USDC`);

const found = await call("find_products", { query, max_price_usd: CAP_USDC });
const pick = found.makers.find((m: { label: string }) => m.label === "recommended");
if (!pick) throw new Error(`no recommended maker item for "${query}"`);
console.log(`picked       ${pick.title} · ${pick.price} · score ${pick.scorecard.overall} (${pick.scorecard.grade})`);

const buy = await call("buy_with_agent_wallet", { offer_id: pick.offer_id, payer_wallet: bot.publicKey, recipient_wallet: owner, max_price_usdc: CAP_USDC });
const tx = await signTransaction(umi.transactions.deserialize(Buffer.from(buy.transaction, "base64")), [bot]);
const sent = await call("send_transaction", { order_id: buy.order_id, transaction: Buffer.from(umi.transactions.serialize(tx)).toString("base64") });
console.log(`sent         ${sent.explorer}`);

for (let i = 0; i < 30; i++) {
  const o = await call("order_status", { order_id: buy.order_id });
  if (o.status !== "pending") {
    console.log(`order        ${o.status} · NFT owner ${o.owner_wallet}`);
    process.exit(o.status === "paid" ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
throw new Error("order still pending after a minute");

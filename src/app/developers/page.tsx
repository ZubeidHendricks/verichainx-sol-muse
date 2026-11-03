import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";

export const metadata: Metadata = { title: "Developers" };

const TOOLS = [
  ["find_products", "Search VeriChainX makers and real Shopify stores. Every result comes back checked, labelled (recommended, caution, avoid) and scored 0–100 on authentic, seller, quality, value and delivery."],
  ["check_product_page", "Check any Shopify product link before your agent buys: domain age, refund policy, reviews, replica and brand-copy wording, and dropship signs."],
  ["verify_item", "Look up an item by its Solana NFT address: current owner, maker, and the origin record with whether its hash recomputes."],
  ["verify_offer_signature", "Check a signed vcx-agent/1 offer and whether its signer is a registered shop's agent."],
  ["prepare_purchase", "A pay page, Solana Pay link and Blink for a maker offer that still passes, for a shopper to sign in their own wallet. Refuses anything to avoid."],
  ["buy_with_agent_wallet", "For bots with their own Solana wallet. Re-checks the offer, refuses anything over your spending cap, and returns one transaction that pays the maker from the bot's USDC and moves the ownership NFT to the bot's owner. We pay the network fee."],
  ["send_transaction", "Submits that order's purchase once the bot has signed it. Nothing else is relayed."],
  ["order_status", "Tracks the order from paid to shipped and delivered, with the Solana transaction for each step."],
] as const;

export default function Page() {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For developers</p>
        <h1 className="display sub">Check a seller before your agent buys</h1>
        <p style={{ maxWidth: "62ch" }}>
          The checks our shopping agent runs are an MCP server. Your agent calls them and gets back evidence, a label and a
          scorecard. Labels come from fixed rules, so no model can talk a copy into a recommendation.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Connect />
      </Suspense>
      <section className="panel stack">
        <h2 className="eyebrow">Tools</h2>
        <dl className="tools">
          {TOOLS.map(([name, text]) => (
            <div key={name}>
              <dt className="mono">{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel stack">
        <h2 className="eyebrow">Let your bot pay in USDC</h2>
        <p style={{ margin: 0, maxWidth: "62ch" }}>
          Give your agent its own Solana wallet and fund it with only what it may spend. The item&apos;s ownership NFT lands in
          your wallet, not the bot&apos;s, in the same transaction as the payment.
        </p>
        <ol style={{ margin: 0 }}>
          <li><code>find_products</code>, then pick a result labelled recommended</li>
          <li><code>buy_with_agent_wallet</code> with <code>payer_wallet</code>, <code>recipient_wallet</code> and <code>max_price_usdc</code></li>
          <li>Sign the returned transaction with the bot&apos;s key</li>
          <li><code>send_transaction</code> with the order id, then <code>order_status</code></li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>
          A complete devnet bot is <code>scripts/agent-buy.mts</code>: it gets test USDC from <code>POST /api/faucet</code>, finds a
          recommended item, buys it and waits for the order to be paid.
        </p>
      </section>
      <section className="panel stack">
        <h2 className="eyebrow">What it doesn&apos;t do</h2>
        <ul style={{ margin: 0 }}>
          <li>Move money on its own. Maker purchases are signed by the shopper&apos;s wallet or your bot&apos;s; store items are bought on the store&apos;s own checkout.</li>
          <li>Buy from stores that don&apos;t allow agents. Stores come from Shopify&apos;s catalog, which is built for agents.</li>
          <li>Prove a physical item is genuine by itself. A clean scorecard means the seller and listing checked out, with the evidence attached.</li>
        </ul>
      </section>
    </div>
  );
}

async function Connect() {
  await connection();
  const url = `${(await getApp()).config.appUrl}/api/mcp`;
  return (
    <section className="panel stack">
      <h2 className="eyebrow">Connect</h2>
      <p style={{ margin: 0 }}>Streamable HTTP, free while in beta, 30 calls a minute per IP. Add it to any MCP client:</p>
      <pre className="code"><code>{JSON.stringify({ mcpServers: { verichainx: { url } } }, null, 2)}</code></pre>
      <p className="small muted" style={{ margin: 0 }}>Clients that only speak stdio: <code>npx -y mcp-remote {url}</code></p>
    </section>
  );
}

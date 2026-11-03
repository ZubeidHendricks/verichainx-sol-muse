import { createMcpHandler } from "mcp-handler";
import { connection } from "next/server";
import { z } from "zod";

import { getApp } from "@/server/app";
import { NotFound, Refused } from "@/server/catalog";
import { clientIp, rateLimited } from "@/server/http";
import {
  buyWithAgentWallet, checkProductPage, findProducts, orderStatus, preparePurchaseLinks, sendTransaction, verifyItem,
  verifyOfferSignature,
} from "@/server/mcp";

/** VeriChainX as an MCP server for other developers' shopping agents (Streamable HTTP). Free in beta, rate-limited per IP. */
export const maxDuration = 120;

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Runs a tool; refusals and lookups that miss go back to the caller as messages, anything else is logged. */
async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof Refused || e instanceof NotFound) return fail(e.message);
    console.error("[mcp]", e);
    return fail("Something went wrong on our side. Try again.");
  }
}

const address = z.string().min(32).max(44);

// Tool classes for Muse connectors and other MCP clients: which tools only read, and which write.
// Nothing here is destructive; the writes create an order or relay the payer's own signed purchase.
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_ONCE = { ...WRITE, idempotentHint: true }; // sending the same signed purchase twice lands once

const handler = createMcpHandler((server) => {
  server.registerTool("find_products", {
    annotations: READ,
    title: "Find verified products",
    description: "Search VeriChainX makers (items with an ownership NFT on Solana, paid in USDC) and real Shopify stores. "
      + "Every result is checked (seller identity, NFT ownership, origin record; or a store's domain age, refund policy, reviews, "
      + "replica wording and dropship signs) and labelled recommended, caution or avoid, with a 0-100 scorecard "
      + "(authentic, seller, quality, value, delivery). Labels come from fixed rules, not a model.",
    inputSchema: z.object({
      query: z.string().min(2).max(200).describe("What the shopper wants, e.g. 'woven beach tote'"),
      max_price_usd: z.number().positive().optional(),
    }),
  }, async (a) => run(async () => findProducts(await getApp(), a)));

  server.registerTool("check_product_page", {
    annotations: READ,
    title: "Check a Shopify product page",
    description: "Check any Shopify product link before buying: the store's domain age, own domain, refund policy, reviews, "
      + "replica and brand-copy wording, and dropship signs. Returns a label and a scorecard.",
    inputSchema: z.object({ url: z.string().url().describe("https://<store>/products/<handle>") }),
  }, async ({ url }) => run(async () => checkProductPage(await getApp(), url).catch((e) => {
    throw e instanceof Error && !(e instanceof NotFound) ? new Refused(e.message) : e;
  })));

  server.registerTool("verify_item", {
    annotations: READ,
    title: "Verify a VeriChainX item",
    description: "Look up an item by its Solana NFT (asset) address: current owner, maker, whether it's listed, and its origin "
      + "record with whether the anchored hash recomputes.",
    inputSchema: z.object({ asset: address }),
  }, async ({ asset }) => run(async () => verifyItem(await getApp(), asset)));

  server.registerTool("verify_offer_signature", {
    annotations: READ,
    title: "Verify a signed offer",
    description: "Check a vcx-agent/1 offer envelope's signature and expiry, and whether the signer is a registered shop's agent.",
    inputSchema: z.object({ envelope: z.record(z.string(), z.unknown()) }),
  }, async ({ envelope }) => run(async () => verifyOfferSignature(await getApp(), envelope)));

  server.registerTool("prepare_purchase", {
    annotations: READ,
    title: "Prepare a purchase",
    description: "For a maker offer that still passes the checks: a pay page, a Solana Pay link and a Blink. The shopper signs one "
      + "transaction in their own wallet that pays the seller in USDC and moves the ownership NFT to them. Refuses offers to avoid.",
    inputSchema: z.object({ offer_id: z.string().min(4).max(100) }),
  }, async ({ offer_id }) => run(async () => preparePurchaseLinks(await getApp(), offer_id)));

  server.registerTool("buy_with_agent_wallet", {
    annotations: WRITE,
    title: "Buy with the agent's own wallet",
    description: "For agents holding their own Solana wallet and USDC. Re-checks the maker offer, refuses anything to avoid or "
      + "priced over max_price_usdc, and returns a transaction that pays the seller from payer_wallet and moves the ownership NFT "
      + "to recipient_wallet (the agent's owner; defaults to payer_wallet) atomically. VeriChainX pays the network fee. Sign it "
      + "with payer_wallet, then call send_transaction. Fund the agent's wallet with only what it may spend.",
    inputSchema: z.object({
      offer_id: z.string().min(4).max(100),
      payer_wallet: address.describe("The agent's wallet: pays the USDC and signs"),
      recipient_wallet: address.optional().describe("Who owns the item afterwards, e.g. the agent's owner"),
      max_price_usdc: z.number().positive().describe("Spending cap for this purchase; refused above it"),
    }),
  }, async (a) => run(async () => buyWithAgentWallet(await getApp(), a)));

  server.registerTool("send_transaction", {
    annotations: WRITE_ONCE,
    title: "Send a signed purchase",
    description: "Submit the purchase from buy_with_agent_wallet once payer_wallet has signed it. Only that order's exact purchase "
      + "is relayed. Returns the Solana signature and the order's status.",
    inputSchema: z.object({ order_id: z.string().min(4).max(60), transaction: z.string().min(100).max(4000).describe("base64, fully signed") }),
  }, async ({ order_id, transaction }) => run(async () => sendTransaction(await getApp(), order_id, transaction)));

  server.registerTool("order_status", {
    annotations: READ,
    title: "Track an order",
    description: "Status of a VeriChainX order (pending, paid, shipped, delivered or failed) with each step's Solana transaction.",
    inputSchema: z.object({ order_id: z.string().min(4).max(60) }),
  }, async ({ order_id }) => run(async () => orderStatus(await getApp(), order_id)));
}, { serverInfo: { name: "verichainx", version: "0.1.0" } });

async function guarded(req: Request) {
  await connection();
  if (rateLimited(`mcp:${clientIp(req)}`, 30)) return Response.json({ error: "Too many requests; slow down" }, { status: 429 });
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };

import { generateSigner, publicKey } from "@metaplex-foundation/umi";
import { and, eq } from "drizzle-orm";

import { hashRecord } from "@/lib/canonical";
import { formatUsdc } from "@/lib/money";
import { orderMemo, preparePurchase, type PurchaseTerms } from "@/lib/solana/purchase";

import { newId, type App } from "./app";
import { NotFound, Refused, assetCollection, checkOffer, loadOffer } from "./catalog";
import { schema } from "./db";

const { orders, items } = schema;
export type Order = typeof orders.$inferSelect;

function isAddress(s: unknown): s is string {
  try {
    return typeof s === "string" && publicKey(s).length > 0;
  } catch {
    return false;
  }
}

/** `collection` comes from the asset itself: a resold item stays in its maker's collection. */
function terms(app: App, o: Order, ctx: Awaited<ReturnType<typeof loadOffer>>, collection?: string): PurchaseTerms {
  return {
    orderId: o.id, asset: ctx.item.asset!, collection,
    merchant: ctx.merchant.wallet, buyer: o.buyerWallet, usdcMint: app.config.usdcMint, treasury: app.config.treasury,
    price: ctx.offer.priceUnits, feeBps: o.feeBps, reference: o.reference, orderHash: o.orderHash,
  };
}

/**
 * §11.1 / §11.2: the transaction behind both the Solana Pay link and the Blink. Re-checks the signed
 * offer, reads the asset fresh from the chain and returns the purchase partially signed. A wallet
 * that asks twice gets the same pending order back.
 */
export async function startPurchase(app: App, offerId: string, account: unknown) {
  if (!isAddress(account)) throw new Refused("account must be a Solana address");
  const ctx = await loadOffer(app, offerId);
  checkOffer(app, ctx.offer, ctx.item, ctx.merchant);
  if (account === ctx.merchant.wallet) throw new Refused("the seller can't buy their own item");
  const current = await app.chain.getAsset(ctx.item.asset!);
  if (!current) throw new Refused("asset not found on chain");

  let [order] = await app.db.select().from(orders)
    .where(and(eq(orders.offerId, offerId), eq(orders.buyerWallet, account), eq(orders.status, "pending")));
  if (!order) {
    const id = newId("ord");
    [order] = await app.db.insert(orders).values({
      id, offerId, buyerWallet: account, reference: generateSigner(app.umi).publicKey, feeBps: app.config.feeBps,
      orderHash: hashRecord({ order: id, offer: offerId, asset: ctx.item.asset, buyer: account,
        price: formatUsdc(ctx.offer.priceUnits), fee_bps: app.config.feeBps }),
      events: [{ status: "pending", at: app.now().toISOString() }],
    }).returning();
  }

  const { transaction } = await preparePurchase(app.umi, terms(app, order, ctx, assetCollection(current)), app.keys.feePayer, app.keys.settlement,
    await app.chain.latestBlockhash(), current);
  const seller = ctx.merchant.domain ?? ctx.merchant.name;
  return {
    order,
    transaction,
    message: `Buy ${ctx.item.title} for ${formatUsdc(ctx.offer.priceUnits)} USDC from ${seller}. The ownership NFT comes to this wallet.`,
  };
}

/** §11.1 indexer: finds the order's transaction by reference and marks it paid if it is really ours. */
export async function refreshOrder(app: App, orderId: string): Promise<Order> {
  const [order] = await app.db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new NotFound(`no order ${orderId}`);
  if (order.status !== "pending") return order;
  const ctx = await loadOffer(app, order.offerId);
  const memo = orderMemo(terms(app, order, ctx));
  // Anyone can mention a reference key, so only a successful transaction carrying our exact memo counts.
  const tx = (await app.chain.findByReference(order.reference)).find((t) => t.ok && t.memos.includes(memo));
  if (!tx) return order;
  const asset = await app.chain.getAsset(ctx.item.asset!);
  if (asset?.owner !== order.buyerWallet) return order; // the memo landed but the NFT didn't: not paid
  const [paid] = await app.db.update(orders).set({
    status: "paid", txSig: tx.signature,
    events: [...order.events, { status: "paid", at: app.now().toISOString(), sig: tx.signature }],
  }).where(and(eq(orders.id, orderId), eq(orders.status, "pending"))).returning();
  await app.db.update(items).set({ status: "sold" }).where(eq(items.id, ctx.item.id));
  return paid ?? order;
}

import { desc, eq } from "drizzle-orm";
import QRCode from "qrcode";

import { hashRecord } from "@/lib/canonical";
import { explorerTx } from "@/lib/chains";
import type { Envelope } from "@/lib/envelope";
import { formatUsdc } from "@/lib/money";
import { attribute } from "@/lib/solana/items";

import { verifyOffer } from "./agents/verify";
import type { ShopResult } from "./agents/buyer";
import { newId, type App } from "./app";
import { NotFound, Refused, checkOffer, heldItems, loadOffer, manages } from "./catalog";
import { schema } from "./db";
import { refreshOrder } from "./pay";
import { shopClaims } from "./shopify";

/** Read models for the web pages. Route handlers and pages share these, so both say the same thing. */

const explorerAddress = (app: App, a: string) =>
  `https://explorer.solana.com/address/${a}${app.config.cluster === "mainnet" ? "" : "?cluster=devnet"}`;

/** GET /api/verify/:asset and /i/:asset: who holds an item NFT, whether it's listed, and its origin record. */
export async function assetReport(app: App, assetId: string) {
  const asset = await app.chain.getAsset(assetId);
  if (!asset) throw new NotFound(`no asset ${assetId}`);
  const [owner] = await app.db.select().from(schema.merchants).where(eq(schema.merchants.wallet, asset.owner));
  const [item] = await app.db.select().from(schema.items).where(eq(schema.items.asset, assetId));
  const h = attribute(asset, "registration_hash");
  const [rec] = h ? await app.db.select().from(schema.records).where(eq(schema.records.hash, h)) : [];
  const d = asset.transferDelegate?.authority;
  return {
    asset: assetId,
    name: asset.name,
    owner: asset.owner,
    owner_merchant: owner ? { id: owner.id, name: owner.name, domain: owner.domain, verified: Boolean(owner.domainVerifiedAt) } : null,
    listed: d?.type === "Address" && d.address === app.keys.settlement.publicKey,
    origin: h ? {
      registration_hash: h,
      record_sig: rec?.sig ?? null,
      recomputes: rec ? hashRecord(rec.payload) === h : false,
      record: rec?.payload ?? null,
    } : null,
    item: item ? { id: item.id, title: item.title, status: item.status } : null,
    links: {
      asset: explorerAddress(app, assetId),
      origin_tx: rec?.sig ? explorerTx(rec.sig, app.config.cluster) : null,
    },
  };
}
export type AssetReport = Awaited<ReturnType<typeof assetReport>>;

/** /o/:offer: the offer, a fresh verification of it, and how to pay. */
export async function offerPage(app: App, offerId: string) {
  const { offer, item, merchant } = await loadOffer(app, offerId);
  let problem: string | null = null;
  try {
    checkOffer(app, offer, item, merchant);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    problem = e.message;
  }
  const verdict = await verifyOffer(app, offer.envelope as Envelope);
  const payUrl = `${app.config.appUrl}/api/pay/${offerId}`;
  const solanaPay = `solana:${encodeURIComponent(payUrl)}`;
  const isPublic = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(app.config.appUrl);
  return {
    offer: { id: offer.id, price: formatUsdc(offer.priceUnits), expiresAt: offer.expiresAt.toISOString() },
    item: { id: item.id, title: item.title, description: item.description, asset: item.asset, status: item.status,
      photos: item.photos },
    merchant: { name: merchant.name, domain: merchant.domain, verified: Boolean(merchant.domainVerifiedAt), wallet: merchant.wallet },
    verdict,
    problem,
    pay: {
      solanaPay,
      qrSvg: await QRCode.toString(solanaPay, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
      // Blink clients fetch the action from the internet, so only offer it on a public URL.
      blink: isPublic ? `https://dial.to/?action=${encodeURIComponent(`solana-action:${app.config.appUrl}/api/actions/offer/${offerId}`)}` : null,
      isPublic,
    },
    feeBps: app.config.feeBps,
  };
}
export type OfferPage = Awaited<ReturnType<typeof offerPage>>;

/** The newest order on an offer, refreshed from the chain if it's still pending. Polled by /o/:offer. */
export async function offerStatus(app: App, offerId: string) {
  const [latest] = await app.db.select().from(schema.orders).where(eq(schema.orders.offerId, offerId))
    .orderBy(desc(schema.orders.createdAt)).limit(1);
  if (!latest) return { order: null };
  const order = await refreshOrder(app, latest.id);
  return { order: { id: order.id, status: order.status, buyer: order.buyerWallet,
    tx: order.txSig ? explorerTx(order.txSig, app.config.cluster) : null } };
}

/** /orders/:id */
export async function orderPage(app: App, orderId: string) {
  const order = await refreshOrder(app, orderId);
  const { offer, item, merchant } = await loadOffer(app, order.offerId);
  return {
    order: { id: order.id, status: order.status, buyer: order.buyerWallet, events: order.events,
      tx: order.txSig ? explorerTx(order.txSig, app.config.cluster) : null },
    item: { title: item.title, asset: item.asset },
    merchant: { name: merchant.name, domain: merchant.domain },
    price: formatUsdc(offer.priceUnits),
  };
}

/** /merchant: the shops this wallet manages (plus open demo shops), and items it can resell. */
export async function merchantBoard(app: App, wallet: string | null) {
  const ms = (await app.db.select().from(schema.merchants).orderBy(desc(schema.merchants.createdAt)))
    .filter((m) => manages(m, wallet));
  const its = await app.db.select().from(schema.items).orderBy(desc(schema.items.createdAt));
  return {
    shops: await Promise.all(ms.map(async (m) => ({
      id: m.id, name: m.name, domain: m.domain, verified: Boolean(m.domainVerifiedAt), wallet: m.wallet,
      custody: m.custody, walletLink: explorerAddress(app, m.wallet), shopify: m.shopifyShop,
      items: its.filter((i) => i.merchantId === m.id).map((i) => ({
        id: i.id, title: i.title, price: formatUsdc(i.priceUnits), status: i.status, asset: i.asset,
      })),
      claims: m.shopifyShop ? await shopClaims(app, m.id) : [],
    }))),
    held: wallet ? (await heldItems(app, wallet)).map((i) => ({ id: i.id, title: i.title, asset: i.asset, paid: formatUsdc(i.priceUnits) })) : [],
  };
}

/** What /api/agent/shop returns: the run, with each result marked if this app holds the offer. */
export type ShopReply = Omit<ShopResult, "results"> & { results: (ShopResult["results"][number] & { local: boolean })[] };

export async function saveRun(app: App, message: string, reply: ShopReply): Promise<string> {
  const id = newId("run");
  await app.db.insert(schema.agentRuns).values({ id, message, engine: reply.engine, answer: reply.answer,
    results: reply.results, trace: reply.trace, usage: reply.usage ?? null, notes: reply.notes ?? [], createdAt: app.now() });
  return id;
}

/** /runs/:id: a saved run, as the shopper saw it. */
export async function runPage(app: App, runId: string) {
  const [r] = await app.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  if (!r) throw new NotFound(`no run ${runId}`);
  const reply = { need: null, engine: r.engine, answer: r.answer, results: r.results, trace: r.trace,
    usage: r.usage ?? undefined, notes: r.notes } as unknown as ShopReply;
  return { id: r.id, message: r.message, createdAt: r.createdAt.toISOString(), reply };
}

/** /runs: recent runs, newest first. */
export async function recentRuns(app: App, limit = 30) {
  const rows = await app.db.select({ id: schema.agentRuns.id, message: schema.agentRuns.message, engine: schema.agentRuns.engine,
    results: schema.agentRuns.results, usage: schema.agentRuns.usage, createdAt: schema.agentRuns.createdAt })
    .from(schema.agentRuns).orderBy(desc(schema.agentRuns.createdAt)).limit(limit);
  return rows.map((r) => {
    const results = r.results as ShopReply["results"];
    const u = r.usage as { prompt_tokens: number; completion_tokens: number } | null;
    return { id: r.id, message: r.message, engine: r.engine, createdAt: r.createdAt.toISOString(),
      offers: results.length, avoided: results.filter((x) => x.final === "avoid" || x.final === "excluded").length,
      tokens: u ? u.prompt_tokens + u.completion_tokens : null };
  });
}

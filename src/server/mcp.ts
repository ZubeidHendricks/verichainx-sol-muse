import { eq } from "drizzle-orm";

import { explorerTx, parseCaip10 } from "@/lib/chains";
import { verifyEnvelope, type Envelope } from "@/lib/envelope";
import { formatUsdc, parseUsdc } from "@/lib/money";

import { localSource, peerSources, shop, type Ranked } from "./agents/buyer";
import { copierSource } from "./agents/copier";
import { verifyOffer } from "./agents/verify";
import type { App } from "./app";
import { Refused, loadOffer } from "./catalog";
import { schema } from "./db";
import { refreshOrder, startPurchase, submitPurchase } from "./pay";
import { formatPrice } from "./stores/catalog";
import { checkStore } from "./stores/check";
import { productFromUrl } from "./stores/page";
import { makerScorecard, storeScorecard, type ScoreKey, type Scorecard } from "./stores/scorecard";
import { searchStores, type StoreResult } from "./stores/search";
import { assetReport } from "./views";

/**
 * VeriChainX for other developers' agents (MCP, /api/mcp): the same checks and scorecards the shopper's agent
 * uses. Labels come from code. Nothing here moves funds on its own: purchases are transactions the payer signs.
 */

type ScoreParts = Record<ScoreKey, { score: number | null; note: string }>;
const scores = (c: Scorecard) => ({ overall: c.overall, grade: c.grade,
  ...(Object.fromEntries(c.rows.map((r) => [r.key, { score: r.score, note: r.note }])) as ScoreParts) });

function makerView(r: Ranked & { scorecard: Scorecard }) {
  const o = r.offer;
  return {
    source: "verichainx_maker", offer_id: o?.offer_id, title: o?.title, seller: o?.merchant_domain ?? o?.merchant,
    price: o ? `${o.price} USDC` : null, label: r.final, reasons: r.reasons, pitch: o?.pitch ?? null,
    scorecard: scores(r.scorecard), evidence: r.evidence, ownership_nft: o?.asset ?? null,
    buy: r.final === "recommended" || r.final === "caution" ? "call prepare_purchase or buy_with_agent_wallet with offer_id" : "blocked",
  };
}

function storeView(s: StoreResult) {
  const p = s.product;
  return {
    source: "shopify_store", title: p.title, variant: p.variant_title, store: p.store.public_domain,
    price: formatPrice(p.price_minor, p.currency), label: s.recommendation, reasons: s.reasons,
    scorecard: scores(s.scorecard), evidence: s.evidence, product_url: p.url,
    checkout_url: s.recommendation === "avoid" ? null : p.checkout_url,
    note: "Bought on the store's own checkout by the shopper; no ownership NFT.",
  };
}

export async function findProducts(app: App, a: { query: string; max_price_usd?: number }) {
  const text = a.max_price_usd ? `${a.query} under $${a.max_price_usd}` : a.query;
  const sources = [localSource(app), ...peerSources(), ...(process.env.DEMO_COPIER === "1" ? [copierSource(app)] : [])];
  const [makers, stores] = await Promise.all([shop(app, text, sources), searchStores(app, a.query, a.max_price_usd, 6)]);
  const peers = makers.results.map((r) => Math.round(Number(r.offer?.price ?? 0) * 100)).filter(Boolean);
  return {
    makers: makers.results.map((r) => makerView({ ...r, scorecard: makerScorecard(r, r.final, peers) })),
    stores: stores.map(storeView),
  };
}

export async function checkProductPage(app: App, url: string, fetcher?: typeof fetch) {
  const p = await productFromUrl(url, fetcher);
  const check = await checkStore(app, p, app.stores ? { facts: (x) => app.stores!.facts(x), age: app.stores.age } : {});
  return storeView({ product: p, recommendation: check.recommendation, reasons: check.reasons, evidence: check.evidence,
    scorecard: storeScorecard(p, check, []) });
}

export async function verifyOfferSignature(app: App, envelope: unknown) {
  const r = verifyEnvelope(envelope, app.now());
  let signer: string | null = null;
  try {
    signer = parseCaip10((envelope as Envelope).from).address;
  } catch { /* reported as not ok */ }
  const [m] = r.ok && signer
    ? await app.db.select({ name: schema.merchants.name, domain: schema.merchants.domain, verified: schema.merchants.domainVerifiedAt })
      .from(schema.merchants).where(eq(schema.merchants.agentPubkey, signer))
    : [];
  return { ok: r.ok, reason: r.ok ? null : r.reason, signer, registered: Boolean(m),
    merchant: m ? { name: m.name, domain: m.domain, verified: Boolean(m.verified) } : null };
}

/** Re-checks an offer now and refuses anything to avoid. */
async function buyable(app: App, offerId: string) {
  const { offer, item } = await loadOffer(app, offerId);
  const v = await verifyOffer(app, offer.envelope as Envelope);
  if (v.recommendation === "avoid" || v.recommendation === "excluded") {
    throw new Refused(`refused: the checks say ${v.recommendation} (${v.reasons.join("; ") || "failed a hard check"})`);
  }
  return { offer, item, label: v.recommendation };
}

export async function preparePurchaseLinks(app: App, offerId: string) {
  const { offer, item, label } = await buyable(app, offerId);
  const pay = `${app.config.appUrl}/api/pay/${offerId}`;
  return {
    offer_id: offerId, title: item.title, price_usdc: formatUsdc(offer.priceUnits), label,
    pay_page: `${app.config.appUrl}/o/${offerId}`, solana_pay: `solana:${encodeURIComponent(pay)}`,
    blink: `${app.config.appUrl}/api/actions/offer/${offerId}`,
    note: "The shopper signs one transaction that pays the seller in USDC and moves the ownership NFT to them.",
  };
}

export async function buyWithAgentWallet(app: App, a: { offer_id: string; payer_wallet: string; recipient_wallet?: string; max_price_usdc: number }) {
  const { label } = await buyable(app, a.offer_id);
  const cap = parseUsdc(a.max_price_usdc.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
  const r = await startPurchase(app, a.offer_id, a.payer_wallet, { recipient: a.recipient_wallet, maxPriceUnits: cap });
  return {
    order_id: r.order.id, message: r.message, label, payer_wallet: a.payer_wallet,
    recipient_wallet: r.order.recipientWallet ?? a.payer_wallet, transaction: r.transaction,
    next: "Sign with payer_wallet (VeriChainX's fee payer and settlement key have signed), then call send_transaction "
      + "with the order_id. The blockhash expires in about a minute.",
  };
}

export async function sendTransaction(app: App, orderId: string, transaction: string) {
  const signature = await submitPurchase(app, orderId, transaction);
  const order = await refreshOrder(app, orderId);
  return { signature, explorer: explorerTx(signature, app.config.cluster), status: order.status };
}

export async function orderStatus(app: App, orderId: string) {
  const o = await refreshOrder(app, orderId);
  const { item } = await loadOffer(app, o.offerId);
  return {
    order_id: o.id, status: o.status, payer_wallet: o.buyerWallet, owner_wallet: o.recipientWallet ?? o.buyerWallet,
    asset: item.asset, events: o.events.map((e) => ({ ...e, explorer: e.sig ? explorerTx(e.sig, app.config.cluster) : null })),
  };
}

export const verifyItem = (app: App, asset: string) => assetReport(app, asset);

import { describe, expect, it } from "vitest";

import { generateSigner, signTransaction } from "@metaplex-foundation/umi";

import { createMerchant, listItem, makeOffer, registerItem } from "@/server/catalog";
import {
  buyWithAgentWallet, checkProductPage, findProducts, orderStatus, preparePurchaseLinks, sendTransaction, verifyOfferSignature,
} from "@/server/mcp";
import { pageExtras, productFromUrl } from "@/server/stores/page";

import { makeTestApp } from "./testApp";

const productJson = {
  product: {
    id: 1,
    title: "Waxed Canvas Tote",
    handle: "waxed-tote",
    body_html: "<p>Made from 18oz waxed cotton canvas.</p>",
    vendor: "My Store",
    options: [{ name: "Color" }],
    images: [{ src: "https://cdn.shopify.com/t.jpg" }],
    variants: [
      { id: 11, title: "Olive", price: "120.00", compare_at_price: "150.00" },
      { id: 12, title: "Black", price: "125.00", compare_at_price: null },
    ],
  },
};

const fetcher = (async (url: string) => {
  if (url.endsWith(".json")) return Response.json(productJson);
  if (url.endsWith("/policies/refund-policy")) return new Response("Refunds", { status: 200 });
  return new Response('<script>Shopify.currency = {"active":"GBP","rate":"1.0"};</script><script type="application/ld+json">{"aggregateRating":{"ratingValue":"4.6","reviewCount":"212"}}</script>');
}) as typeof fetch;

describe("checking any Shopify product link (MCP check_product_page)", () => {
  it("builds the product from the store's own data, in the linked variant, currency and rating", async () => {
    const p = await productFromUrl("https://shop.example.com/products/waxed-tote?variant=12", fetcher);
    expect(p).toMatchObject({ title: "Waxed Canvas Tote", variant_title: "Black", price_minor: 12500, currency: "GBP", rating: { value: 4.6, count: 212 } });
    expect(p.store.refund_policy).toBe("https://shop.example.com/policies/refund-policy");
    expect(p.checkout_url).toBe("https://shop.example.com/cart/12:1");
    const first = await productFromUrl("https://shop.example.com/products/waxed-tote", fetcher);
    expect(first.list_price_minor).toBe(15000);
  });

  it("only fetches public store links", async () => {
    for (const bad of ["http://shop.example.com/products/x", "https://127.0.0.1/products/x", "https://localhost/products/x", "https://printer.local/products/x", "https://shop.example.com/collections/all"]) {
      await expect(productFromUrl(bad, fetcher)).rejects.toThrow();
    }
  });

  it("reads currency and rating when a page has them, and nothing when it doesn't", () => {
    expect(pageExtras('"priceCurrency": "ZAR", "ratingValue": 4.2, "ratingCount": 9')).toEqual({ currency: "ZAR", rating: { value: 4.2, count: 9 } });
    expect(pageExtras("<html></html>")).toEqual({ currency: null, rating: null });
  });
});

describe("MCP tools on the local chain", () => {
  it("finds a maker's item with a scorecard, then an agent buys it for its owner and tracks the order", async () => {
    const app = await makeTestApp();
    const m = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
    const item = await listItem(app, (await registerItem(app, m.id, { title: "Woven Market Tote", price: "129",
      description: "Hand-woven ilala palm and cotton.", photos: [] })).id);

    const found = await findProducts(app, { query: "woven tote", max_price_usd: 200 });
    expect(found.stores).toEqual([]); // no store search configured
    const tote = found.makers[0];
    expect(tote).toMatchObject({ title: "Woven Market Tote", price: "129.00 USDC", ownership_nft: item.asset });
    expect(tote.scorecard.authentic.score).toBeGreaterThanOrEqual(85);

    expect(await preparePurchaseLinks(app, tote.offer_id!)).toMatchObject({ price_usdc: "129.00", pay_page: expect.stringContaining("/o/") });

    const owner = generateSigner(app.umi).publicKey;
    const buy = await buyWithAgentWallet(app, { offer_id: tote.offer_id!, payer_wallet: app.buyer.publicKey, recipient_wallet: owner, max_price_usdc: 150 });
    const tx = app.umi.transactions.deserialize(Buffer.from(buy.transaction, "base64"));
    const signed = Buffer.from(app.umi.transactions.serialize(await signTransaction(tx, [app.buyer]))).toString("base64");
    expect((await sendTransaction(app, buy.order_id, signed)).status).toBe("paid");
    expect(await orderStatus(app, buy.order_id)).toMatchObject({ status: "paid", owner_wallet: owner, asset: item.asset });
  });

  it("refuses to sell what the checks say to avoid, and verifies offer signatures", async () => {
    const app = await makeTestApp();
    const m = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
    const item = await listItem(app, (await registerItem(app, m.id, { title: "Tote 1:1 mirror quality", price: "40", photos: [] })).id);
    const offer = await makeOffer(app, item.id);
    await expect(preparePurchaseLinks(app, offer.id)).rejects.toThrow("refused");
    await expect(buyWithAgentWallet(app, { offer_id: offer.id, payer_wallet: app.buyer.publicKey, max_price_usdc: 100 })).rejects.toThrow("refused");

    expect(await verifyOfferSignature(app, offer.envelope)).toMatchObject({ ok: true, registered: true, merchant: { name: "Lerato Bags" } });
    const tampered = { ...(offer.envelope as object), body: { ...(offer.envelope as { body: object }).body, price: "1.00" } };
    expect(await verifyOfferSignature(app, tampered)).toMatchObject({ ok: false, registered: false });
  });

  it("checks any Shopify product link", async () => {
    const app = await makeTestApp();
    // No network: the store's facts and domain age come from here.
    app.stores = { search: async () => ({ products: [] }), facts: async () => ({ product: null, catalog: null, shipping: null }), age: async () => 3 };
    const r = await checkProductPage(app, "https://shop.example.com/products/waxed-tote", fetcher);
    expect(r).toMatchObject({ source: "shopify_store", title: "Waxed Canvas Tote", store: "shop.example.com" });
    expect(r.scorecard.overall).toBeGreaterThan(0);
  });
});

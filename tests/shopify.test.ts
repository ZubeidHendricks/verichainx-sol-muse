import { createHmac } from "node:crypto";

import { generateSigner } from "@metaplex-foundation/umi";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getItem, registerItem } from "@/server/catalog";
import { schema } from "@/server/db";
import { ordersPaidPost } from "@/server/handlers";
import {
  claimToken, claimView, completeInstall, installRedirect, normalizeShop, ordersPaid, redeemClaim, shopClaims,
  verifyWebhookHmac, type ShopifyConfig,
} from "@/server/shopify";

import { makeTestApp, type TestApp } from "./testApp";

const cfg: ShopifyConfig = { apiKey: "test-key", apiSecret: "test-secret", apiVersion: "2026-10" };
const SHOP = "lerato.myshopify.com";

/** Shopify's side: the token exchange and the Admin GraphQL queries the app makes. */
function fakeShopify() {
  const calls: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url === `https://${SHOP}/admin/oauth/access_token`) {
      calls.push("token");
      return body.code === "good-code" ? Response.json({ access_token: "shpat_test", scope: "read_products,read_orders" })
        : Response.json({ error: "invalid" }, { status: 400 });
    }
    expect(new Headers(init.headers).get("x-shopify-access-token")).toBe("shpat_test");
    const q: string = body.query;
    if (q.includes("shop {")) { calls.push("shop"); return Response.json({ data: { shop: { name: "Lerato Bags", primaryDomain: { host: "leratobags.co.za" } } } }); }
    if (q.includes("webhookSubscriptionCreate")) {
      calls.push(`webhook ${body.variables.uri}`);
      return Response.json({ data: { webhookSubscriptionCreate: { userErrors: [] } } });
    }
    if (q.includes("products(")) {
      calls.push("products");
      return Response.json({ data: { products: { nodes: [
        { legacyResourceId: "8001", title: "Woven Market Tote", descriptionHtml: "<p>Hand-woven <b>ilala</b> palm.</p>",
          media: { nodes: [{ image: { url: "https://cdn.shopify.example/tote.jpg" } }, {}] }, variants: { nodes: [{ price: "129.00" }] } },
        { legacyResourceId: "8002", title: "Gift card", descriptionHtml: "", media: { nodes: [] }, variants: { nodes: [{ price: "0.00" }] } },
      ] } } });
    }
    throw new Error(`unexpected ${url} ${q}`);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** The query Shopify sends back to the callback, signed like Shopify signs it. */
function callbackQuery(params: Record<string, string>, secret = cfg.apiSecret) {
  const q = new URLSearchParams(params);
  const msg = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  q.set("hmac", createHmac("sha256", secret).update(msg).digest("hex"));
  return q;
}

describe("Shopify partner stores", () => {
  let app: TestApp;
  const owner = "9EtLwvEf2a6LfZbKfVKNDgkfJmzoSY7uS4jVhZ2qjVRm";

  beforeAll(async () => {
    app = await makeTestApp();
  });

  it("only accepts myshopify.com stores", () => {
    expect(normalizeShop("Lerato")).toBe(SHOP);
    expect(normalizeShop("https://lerato.myshopify.com/admin/products")).toBe(SHOP);
    expect(() => normalizeShop("evil.com")).toThrow("myshopify.com");
    expect(() => normalizeShop("lerato.myshopify.com.evil.com")).toThrow();
  });

  it("installs: checks the signature and state, imports the products and subscribes to paid orders", async () => {
    const { url, cookie } = installRedirect(app, cfg, "lerato", owner);
    const sent = new URL(url);
    expect(sent.host).toBe(SHOP);
    expect(sent.searchParams.get("scope")).toBe("read_products,read_orders");
    const state = sent.searchParams.get("state")!;
    const s = fakeShopify();

    await expect(completeInstall(app, cfg, callbackQuery({ code: "good-code", shop: SHOP, state }, "wrong"), cookie, s.fetch))
      .rejects.toThrow("signature");
    await expect(completeInstall(app, cfg, callbackQuery({ code: "good-code", shop: SHOP, state: "other" }), cookie, s.fetch))
      .rejects.toThrow("expired or was started elsewhere");
    await expect(completeInstall(app, cfg, callbackQuery({ code: "good-code", shop: "other.myshopify.com", state }), cookie, s.fetch))
      .rejects.toThrow("expired or was started elsewhere");
    expect(s.calls).toEqual([]);

    const { merchant, imported } = await completeInstall(app, cfg, callbackQuery({ code: "good-code", shop: SHOP, state }), cookie, s.fetch);
    expect(merchant).toMatchObject({ name: "Lerato Bags", shopifyShop: SHOP, ownerWallet: owner, custody: "vault" });
    expect(merchant.domainVerifiedAt).not.toBeNull();
    expect(merchant.shopifyTokenSealed).not.toContain("shpat_test");
    expect(imported).toEqual(["Woven Market Tote"]); // the free gift card is skipped
    expect(s.calls).toEqual(["token", "shop", `webhook ${app.config.appUrl}/api/shopify/webhooks/orders-paid`, "products"]);
  });

  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ id: 1 });
    const good = createHmac("sha256", cfg.apiSecret).update(body).digest("base64");
    expect(verifyWebhookHmac(body, good, cfg.apiSecret)).toBe(true);
    expect(verifyWebhookHmac(`${body} `, good, cfg.apiSecret)).toBe(false);
    expect(verifyWebhookHmac(body, null, cfg.apiSecret)).toBe(false);
  });

  it("a paid order creates one claim; the buyer claims the NFT once, with the order's email", async () => {
    const order = { id: 5551, name: "#1001", email: "Thandi@Example.com", line_items: [{ product_id: 8001, quantity: 1 }, { product_id: 9999 }] };
    const [{ claim, url }] = await ordersPaid(app, SHOP, order);
    expect(url).toBe(`${app.config.appUrl}/claim/${claim.id}?t=${claimToken(app, claim.id)}`);
    expect(await ordersPaid(app, SHOP, order)).toEqual([]); // Shopify retries webhooks
    expect(await claimView(app, claim.id, "wrong-token")).toBeNull();

    const token = claimToken(app, claim.id);
    const wallet = generateSigner(app.umi).publicKey;
    await expect(redeemClaim(app, claim.id, token, "someone@else.com", wallet)).rejects.toThrow("isn't the email on the order");
    await expect(redeemClaim(app, claim.id, token, "thandi@example.com", "not-an-address")).rejects.toThrow("isn't a Solana address");

    const out = await redeemClaim(app, claim.id, token, " thandi@example.com ", wallet);
    expect(app.local.asset(out.asset).owner).toBe(wallet);
    expect((await getItem(app, claim.itemId)).status).toBe("sold");
    await expect(redeemClaim(app, claim.id, token, "thandi@example.com", wallet)).rejects.toThrow("already been claimed");
    expect(await claimView(app, claim.id, token)).toMatchObject({ orderName: "#1001", claimedBy: wallet, txSig: out.signature });
    expect(await shopClaims(app, claim.merchantId)).toMatchObject([{ orderName: "#1001", title: "Woven Market Tote", claimed: true }]);
  });

  it("doesn't claim a sold item again, and locks a claim after five wrong emails", async () => {
    // The tote is sold now, so a second order of it creates no claim.
    expect(await ordersPaid(app, SHOP, { id: 5552, name: "#1002", email: "a@b.co", line_items: [{ product_id: 8001 }] })).toEqual([]);

    const [m] = await app.db.select().from(schema.merchants).where(eq(schema.merchants.shopifyShop, SHOP));
    const basket = await registerItem(app, m.id, { title: "Woven Basket", price: "85", photos: [] });
    await app.db.update(schema.items).set({ shopifyProductId: "8003" }).where(eq(schema.items.id, basket.id));
    const [{ claim }] = await ordersPaid(app, SHOP, { id: 5553, name: "#1003", email: "sipho@example.com", line_items: [{ product_id: 8003 }] });
    const token = claimToken(app, claim.id);
    const wallet = generateSigner(app.umi).publicKey;
    for (let i = 0; i < 5; i++) {
      await expect(redeemClaim(app, claim.id, token, `guess${i}@example.com`, wallet)).rejects.toThrow("isn't the email on the order");
    }
    await expect(redeemClaim(app, claim.id, token, "sipho@example.com", wallet)).rejects.toThrow("Too many wrong emails");
  });

  it("takes paid-order webhooks over HTTP only with a valid signature", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", cfg.apiKey);
    vi.stubEnv("SHOPIFY_API_SECRET", cfg.apiSecret);
    try {
      const body = JSON.stringify({ id: 5554, name: "#1004", email: "x@example.com", line_items: [] });
      const post = (hmac: string, shop = SHOP) => ordersPaidPost(app, new Request("https://sol.example.test/api/shopify/webhooks/orders-paid", {
        method: "POST", body, headers: { "x-shopify-hmac-sha256": hmac, "x-shopify-shop-domain": shop } }));
      expect((await post("bad")).status).toBe(401);
      const good = createHmac("sha256", cfg.apiSecret).update(body).digest("base64");
      expect((await post(good)).status).toBe(200);
      expect((await post(good, "unknown.myshopify.com")).status).toBe(200); // not retried
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

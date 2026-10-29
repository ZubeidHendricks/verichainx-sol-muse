import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { transferV1 } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { and, eq, isNull, sql } from "drizzle-orm";

import { newId, type App } from "./app";
import { mac, open, seal as signState } from "./auth";
import { Refused, createMerchant, getItem, getMerchant, listItem, registerItem, sealedSigner, type Merchant } from "./catalog";
import { schema } from "./db";
import { seal, unseal } from "./sealed";

/**
 * §11.3 Shopify partner stores. A signed-in shop connects its store by OAuth (which proves the store is theirs),
 * the store's products are registered at origin, and each paid order of a registered product creates a claim:
 * a link the buyer opens to receive the item's NFT in their own wallet.
 *
 * Uses the GraphQL Admin API. Order webhooks carry the buyer's email, which Shopify treats as protected customer
 * data: the app has to request that access in the Partner Dashboard.
 */
const { merchants, items, claims } = schema;

export const SCOPES = "read_products,read_orders";
export const STATE_COOKIE = "vcx_shopify";
const CLAIM_DAYS = 30;
const MAX_ATTEMPTS = 5;

export type ShopifyConfig = { apiKey: string; apiSecret: string; apiVersion: string };

export function shopifyConfig(env: Record<string, string | undefined> = process.env): ShopifyConfig | null {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return null;
  return { apiKey: env.SHOPIFY_API_KEY, apiSecret: env.SHOPIFY_API_SECRET, apiVersion: env.SHOPIFY_API_VERSION ?? "2026-10" };
}

/** "lerato" or "https://lerato.myshopify.com/admin" → "lerato.myshopify.com"; anything else is refused. */
export function normalizeShop(input: string): string {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = s.includes(".") ? s : `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Refused("Enter your store's myshopify.com address.");
  return shop;
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** OAuth redirects: hex HMAC-SHA256 over the other query parameters, sorted. */
export function verifyOAuthHmac(query: URLSearchParams, secret: string): boolean {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const message = [...query.entries()].filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return safeEqual(createHmac("sha256", secret).update(message).digest("hex"), hmac);
}

/** Webhooks: base64 HMAC-SHA256 of the raw body. */
export function verifyWebhookHmac(rawBody: string, header: string | null, secret: string): boolean {
  return Boolean(header) && safeEqual(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"), header!);
}

type State = { shop: string; wallet: string; nonce: string; exp: number };

/** Where to send a signed-in shop to approve the app, and the single-use state to keep in a cookie. */
export function installRedirect(app: App, cfg: ShopifyConfig, shopInput: string, wallet: string) {
  const shop = normalizeShop(shopInput);
  const nonce = randomBytes(16).toString("hex");
  const state: State = { shop, wallet, nonce, exp: app.now().getTime() + 10 * 60_000 };
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: cfg.apiKey, scope: SCOPES, redirect_uri: `${app.config.appUrl}/api/shopify/callback`,
    state: nonce }).toString();
  return { url: url.toString(), cookie: signState(app, state) };
}

async function admin<T>(cfg: ShopifyConfig, shop: string, token: string, query: string, variables: object, fetchFn: typeof fetch): Promise<T> {
  const r = await fetchFn(`https://${shop}/admin/api/${cfg.apiVersion}/graphql.json`, {
    method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => ({}))) as { data?: T; errors?: unknown };
  if (!r.ok || body.errors || !body.data) throw new Error(`Shopify ${r.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  return body.data;
}

/**
 * The OAuth callback: checks the HMAC and the state, swaps the code for a token, and makes the store a verified
 * shop managed by the wallet that started the install. Then subscribes to paid orders and imports the products.
 */
export async function completeInstall(app: App, cfg: ShopifyConfig, query: URLSearchParams, stateCookie: string | undefined,
  fetchFn: typeof fetch = fetch) {
  if (!verifyOAuthHmac(query, cfg.apiSecret)) throw new Refused("Shopify's signature on this request doesn't match.");
  const state = open<State>(app, stateCookie);
  const shop = normalizeShop(query.get("shop") ?? "");
  if (!state || state.exp < app.now().getTime() || state.nonce !== query.get("state") || state.shop !== shop) {
    throw new Refused("This install link expired or was started elsewhere. Start again from /merchant.");
  }
  const r = await fetchFn(`https://${shop}/admin/oauth/access_token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.apiSecret, code: query.get("code") }),
  });
  const { access_token: token, scope } = (await r.json().catch(() => ({}))) as { access_token?: string; scope?: string };
  if (!r.ok || !token) throw new Refused("Shopify didn't grant access. Try the install again.");
  if (!SCOPES.split(",").every((s) => scope?.split(",").includes(s))) throw new Refused(`The app needs ${SCOPES} access.`);

  const { shop: info } = await admin<{ shop: { name: string; primaryDomain: { host: string } } }>(cfg, shop, token,
    "{ shop { name primaryDomain { host } } }", {}, fetchFn);
  const [existing] = await app.db.select().from(merchants).where(eq(merchants.shopifyShop, shop));
  if (existing && existing.ownerWallet !== state.wallet) throw new Refused("This store is connected to another wallet.");
  // OAuth proves the store is theirs; the store's own domain still needs the DNS record to show as verified.
  const m = existing ?? await createMerchant(app, { name: info.name, domain: shop, ownerWallet: state.wallet });
  const [row] = await app.db.update(merchants).set({
    shopifyShop: shop, shopifyTokenSealed: seal(new TextEncoder().encode(token), app.config.sealSecret),
    domainVerifiedAt: m.domainVerifiedAt ?? (m.domain === shop ? app.now() : null),
  }).where(eq(merchants.id, m.id)).returning();

  await admin(cfg, shop, token, `mutation($uri: String!) {
    webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: { uri: $uri, format: JSON }) { userErrors { message } }
  }`, { uri: `${app.config.appUrl}/api/shopify/webhooks/orders-paid` }, fetchFn);
  const imported = await importProducts(app, cfg, row, fetchFn);
  return { merchant: row, imported };
}

const accessToken = (app: App, m: Merchant) => new TextDecoder().decode(unseal(m.shopifyTokenSealed!, app.config.sealSecret));
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

type ProductNode = {
  legacyResourceId: string; title: string; descriptionHtml: string;
  media: { nodes: { image?: { url: string } }[] }; variants: { nodes: { price: string }[] };
};

/** §5.2 from Shopify: registers each active product not imported yet, with its photos, and lists it. */
export async function importProducts(app: App, cfg: ShopifyConfig, m: Merchant, fetchFn: typeof fetch = fetch) {
  const data = await admin<{ products: { nodes: ProductNode[] } }>(cfg, m.shopifyShop!, accessToken(app, m), `{
    products(first: 50, query: "status:active") { nodes {
      legacyResourceId title descriptionHtml
      media(first: 4) { nodes { ... on MediaImage { image { url } } } }
      variants(first: 1) { nodes { price } }
    } } }`, {}, fetchFn);
  const known = new Set((await app.db.select({ p: items.shopifyProductId }).from(items).where(eq(items.merchantId, m.id))).map((r) => r.p));
  const added = [];
  for (const p of data.products.nodes) {
    const price = p.variants.nodes[0]?.price;
    if (known.has(p.legacyResourceId) || !price || Number(price) <= 0) continue;
    const item = await registerItem(app, m.id, {
      title: p.title.slice(0, 120), description: stripHtml(p.descriptionHtml).slice(0, 600), price: Number(price).toFixed(2),
      photos: p.media.nodes.map((n) => n.image?.url).filter((u): u is string => Boolean(u)),
    });
    await app.db.update(items).set({ shopifyProductId: p.legacyResourceId }).where(eq(items.id, item.id));
    if (m.custody === "vault") await listItem(app, item.id);
    added.push(item.title);
  }
  return added;
}

const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** The token in a claim link. Derived, not stored, so the shop's board can show the link again. */
export const claimToken = (app: App, claimId: string) => mac(app, `claim:${claimId}`).slice(0, 32);
export const claimUrl = (app: App, claimId: string) => `${app.config.appUrl}/claim/${claimId}?t=${claimToken(app, claimId)}`;

type PaidOrder = { id: number | string; name?: string; email?: string | null; contact_email?: string | null;
  line_items?: { product_id?: number | string | null; quantity?: number }[] };

/** orders/paid: a claim for each registered, unsold product in the order. Repeated webhooks don't add more. */
export async function ordersPaid(app: App, shop: string, order: PaidOrder) {
  const [m] = await app.db.select().from(merchants).where(eq(merchants.shopifyShop, normalizeShop(shop)));
  if (!m) throw new Refused("unknown store");
  const email = order.email ?? order.contact_email;
  if (!email) return [];
  const out = [];
  for (const li of order.line_items ?? []) {
    if (li.product_id == null) continue;
    const [item] = await app.db.select().from(items)
      .where(and(eq(items.merchantId, m.id), eq(items.shopifyProductId, String(li.product_id))));
    if (!item || item.status === "sold") continue;
    const [claim] = await app.db.insert(claims).values({
      id: newId("cl"), itemId: item.id, merchantId: m.id, shopifyOrderId: String(order.id), orderName: order.name ?? `#${order.id}`,
      emailHash: emailHash(email), expiresAt: new Date(app.now().getTime() + CLAIM_DAYS * 86_400_000),
    }).onConflictDoNothing().returning();
    if (claim) out.push({ claim, url: claimUrl(app, claim.id) });
  }
  return out;
}

/** What the claim page shows before the buyer claims. The token must match. */
export async function claimView(app: App, claimId: string, token: string) {
  const [c] = await app.db.select().from(claims).where(eq(claims.id, claimId));
  if (!c || !safeEqual(claimToken(app, c.id), token)) return null;
  const item = await getItem(app, c.itemId);
  const m = await getMerchant(app, c.merchantId);
  return { id: c.id, orderName: c.orderName, item: { title: item.title, asset: item.asset, photo: item.photos[0] ?? null },
    shop: m.name, claimedBy: c.claimedBy, txSig: c.txSig, expired: c.expiresAt < app.now(), locked: c.attempts >= MAX_ATTEMPTS };
}

/**
 * Sends the NFT to `address`. The claim is taken in the database first, so two tries can't both send; if the
 * transfer fails the claim is released again.
 */
export async function redeemClaim(app: App, claimId: string, token: string, email: string, address: string) {
  const view = await claimView(app, claimId, token);
  if (!view) throw new Refused("This claim link isn't valid.");
  if (view.claimedBy) throw new Refused("This item has already been claimed.");
  if (view.expired) throw new Refused("This claim has expired. Contact the shop.");
  if (view.locked) throw new Refused("Too many wrong emails. Contact the shop.");
  try {
    publicKey(address);
  } catch {
    throw new Refused("That isn't a Solana address.");
  }
  const [c] = await app.db.select().from(claims).where(eq(claims.id, claimId));
  if (!safeEqual(c.emailHash, emailHash(email))) {
    await app.db.update(claims).set({ attempts: sql`${claims.attempts} + 1` }).where(eq(claims.id, claimId));
    throw new Refused("That isn't the email on the order.");
  }
  const [taken] = await app.db.update(claims).set({ claimedBy: address })
    .where(and(eq(claims.id, claimId), isNull(claims.claimedBy))).returning();
  if (!taken) throw new Refused("This item has already been claimed.");
  try {
    const item = await getItem(app, c.itemId);
    const m = await getMerchant(app, c.merchantId);
    const asset = await app.chain.getAsset(item.asset!);
    if (!asset || asset.owner !== m.wallet) throw new Refused("The shop no longer holds this item. Contact the shop.");
    const collection = asset.updateAuthority.type === "Collection" ? asset.updateAuthority.address : undefined;
    const sig = await app.chain.send(transferV1(app.umi, {
      asset: publicKey(item.asset!), collection, newOwner: publicKey(address),
      authority: sealedSigner(app, m.vaultSecretSealed, "vault"), payer: app.keys.feePayer,
    }).setFeePayer(app.keys.feePayer));
    await app.db.update(claims).set({ txSig: sig }).where(eq(claims.id, claimId));
    await app.db.update(items).set({ status: "sold" }).where(eq(items.id, item.id));
    return { signature: sig, asset: item.asset! };
  } catch (e) {
    await app.db.update(claims).set({ claimedBy: null }).where(eq(claims.id, claimId));
    throw e;
  }
}

/** Claims for a shop's board, newest first, with their links. */
export async function shopClaims(app: App, merchantId: string) {
  const rows = await app.db.select({ c: claims, title: items.title }).from(claims).innerJoin(items, eq(claims.itemId, items.id))
    .where(eq(claims.merchantId, merchantId)).orderBy(sql`${claims.createdAt} desc`).limit(50);
  return rows.map(({ c, title }) => ({ id: c.id, orderName: c.orderName, title, claimed: Boolean(c.txSig), url: claimUrl(app, c.id) }));
}

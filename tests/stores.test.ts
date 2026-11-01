import { describe, expect, it } from "vitest";

import type { App } from "@/server/app";
import { searchCatalog, toStoreProduct, type StoreProduct } from "@/server/stores/catalog";
import { brandIn, checkStore, registrableDomain } from "@/server/stores/check";
import { deliveryFrom, dropshipCheck, type StoreFacts } from "@/server/stores/dropship";
import { storeScorecard, valueRow } from "@/server/stores/scorecard";

// Every test passes its own partner lookup, so the store check never touches the app's database.
const NO_APP = null as unknown as App;

// Shaped like a product from Shopify's Global Catalog (search_catalog).
const catalogProduct = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/p/abc",
  title: "Agility 2.0 Tracksuit - Black",
  description: { plain: "Lightweight <b>tracksuit</b>." },
  url: "https://montirex.com/products/agility",
  media: [{ type: "image", url: "https://cdn.shopify.com/a.jpg" }],
  rating: { value: 4.9, count: 338 },
  variants: [
    { id: "gid://shopify/ProductVariant/1", title: "S", price: { amount: 150000, currency: "ZAR" }, checkout_url: "https://montirex.com/cart/1:1", seller: { name: "Montirex", domain: "montirex.myshopify.com", links: [{ type: "refund_policy", url: "https://montirex.com/policies/refund-policy" }] } },
    { id: "gid://shopify/ProductVariant/2", title: "M", price: { amount: 150000, currency: "ZAR" }, list_price: { amount: 180000, currency: "ZAR" }, checkout_url: "https://montirex.com/cart/2:1", seller: { name: "Montirex", domain: "montirex.myshopify.com", links: [{ type: "refund_policy", url: "https://montirex.com/policies/refund-policy" }] } },
  ],
  ...over,
});

const product = (over: Partial<StoreProduct> = {}, store: Partial<StoreProduct["store"]> = {}): StoreProduct => {
  const p = toStoreProduct(catalogProduct())!;
  return { ...p, ...over, store: { ...p.store, ...store } };
};

const noPartner = async () => null;
const NO_FACTS: StoreFacts = { product: null, catalog: null, shipping: null };
const facts = (over: Partial<StoreFacts> = {}) => async () => ({ ...NO_FACTS, ...over });
const ownLabel = { vendor: "Montirex", tags: [], options: ["Size"], body: "Made from 88% polyester, 12% elastane." };

describe("Shopify catalog results", () => {
  it("maps a product to the shopper's size, the store's own domain and its refund policy", () => {
    const p = toStoreProduct(catalogProduct(), "m")!;
    expect(p.variant_title).toBe("M");
    expect(p.checkout_url).toBe("https://montirex.com/cart/2:1");
    expect(p.list_price_minor).toBe(180000);
    expect(p.store.public_domain).toBe("montirex.com");
    expect(p.store.refund_policy).toMatch(/refund-policy/);
    expect(p.description).toBe("Lightweight tracksuit .");
  });

  it("skips products with nothing in stock", () => {
    const v = catalogProduct().variants.map((x) => ({ ...x, availability: { available: false } }));
    expect(toStoreProduct(catalogProduct({ variants: v }))).toBeNull();
  });

  it("sends the budget in USD cents and the ship-to country as filters", async () => {
    let sent: { params: { arguments: { catalog: { filters: unknown; query: string } } } } | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { products: [catalogProduct()], pagination: { total_count: 470 } } } });
    }) as typeof fetch;
    const r = await searchCatalog({ query: "black tracksuit", maxPriceUsd: 100, shipsTo: "za", size: "M" }, fetcher);
    expect(sent!.params.arguments.catalog.filters).toEqual({ available: true, price: { max: 10000 }, ships_to: { country: "ZA" } });
    expect(sent!.params.arguments.catalog.query).toBe("black tracksuit size M");
    expect(r.total).toBe(470);
    expect(r.products[0].variant_title).toBe("M");
  });
});

describe("store checks", () => {
  it("recommends an established store with its own domain and a refund policy", async () => {
    const c = await checkStore(NO_APP, product(), { age: async () => 6.7, partner: noPartner, facts: facts() });
    expect(c.recommendation).toBe("recommended");
    expect(c.evidence.find((e) => e.id === "AGE")?.detail).toBe("Domain registered 6 years ago");
  });

  it("is cautious about a store with only a myshopify.com address or a new domain", async () => {
    expect((await checkStore(NO_APP, product({}, { public_domain: "x1.myshopify.com" }), { age: async () => 5, partner: noPartner, facts: facts() })).recommendation).toBe("caution");
    const young = await checkStore(NO_APP, product(), { age: async () => 0.04, partner: noPartner, facts: facts() });
    expect(young.recommendation).toBe("caution");
    expect(young.reasons).toContain("domain under a year old");
  });

  it("is cautious about a famous brand from a store that isn't the brand's own", async () => {
    const c = await checkStore(NO_APP, product({ title: "Nike Dri-FIT Academy Tracksuit" }), { age: async () => 7, partner: noPartner, facts: facts() });
    expect(c.recommendation).toBe("caution");
    expect(c.evidence.find((e) => e.id === "BRAND")?.ok).toBeNull();
    const own = await checkStore(NO_APP, product({ title: "Nike Tech Fleece Tracksuit" }, { public_domain: "nike.com" }), { age: async () => 30, partner: noPartner, facts: facts() });
    expect(own.recommendation).toBe("recommended");
  });

  it("says avoid for replica wording, or a famous brand sold as 'premium quality'", async () => {
    expect((await checkStore(NO_APP, product({ title: "Tote bag 1:1 mirror quality" }), { age: async () => 5, partner: noPartner, facts: facts() })).recommendation).toBe("avoid");
    const c = await checkStore(NO_APP, product({ title: "Nike Premium Quality Zipper Tracksuit" }), { age: async () => 3, partner: noPartner, facts: facts() });
    expect(c.recommendation).toBe("avoid");
    expect(c.reasons[0]).toBe("Nike item described with copy-seller wording");
  });

  it("marks a registered VeriChainX maker", async () => {
    const c = await checkStore(NO_APP, product(), { age: async () => 3, partner: async () => ({ merchant_id: "m1", name: "Montirex" }), facts: facts() });
    expect(c.evidence.find((e) => e.id === "ORIGIN")?.ok).toBe(true);
  });

  it("finds the registrable domain and named brands", () => {
    expect(registrableDomain("shop.novaclothing.co.uk")).toBe("novaclothing.co.uk");
    expect(registrableDomain("www.montirex.com")).toBe("montirex.com");
    expect(brandIn("Air Jordan 1 Retro")).toBe("Nike");
    expect(brandIn("Agility tracksuit")).toBeNull();
  });
});

describe("dropship signs", () => {
  it("calls a product with a 'Ships From' option, or a supplier app as vendor, likely dropshipped", () => {
    expect(dropshipCheck(product({ options: ["Color", "Ships From"] }), NO_FACTS).level).toBe("likely");
    const d = dropshipCheck(product(), { ...NO_FACTS, product: { ...ownLabel, vendor: "CJdropshipping" } });
    expect(d.level).toBe("likely");
    expect(d.evidence.find((e) => e.id === "SUPPLIER")?.detail).toMatch(/CJdropshipping/);
  });

  it("treats one weak sign as 'possibly', and a clean store as no sign", () => {
    expect(dropshipCheck(product(), { ...NO_FACTS, product: { ...ownLabel, vendor: "My Store" } }).level).toBe("possible");
    const clean = dropshipCheck(product(), { product: ownLabel, catalog: { count: 40, vendors: ["Montirex"], types: ["Tracksuit", "Shorts"] }, shipping: "Shipping policy. Orders ship within 1-2 business days. Delivery takes 2-4 business days." });
    expect(clean.level).toBe("none");
    expect(clean.evidence[0].ok).toBe(true);
    expect(clean.delivery).toMatchObject({ min_days: 3, max_days: 6 });
  });

  it("spots supplier boilerplate, general-store categories and overseas shipping", () => {
    const d = dropshipCheck(product({ description: "Note: due to manual measurement, please allow 1-3cm error." }), {
      product: null,
      catalog: { count: 250, vendors: ["Eptchn"], types: ["Hot Sale", "Daily necessities"] },
      shipping: "Shipping policy. Items are shipped from our overseas warehouse and arrive in 10-20 business days.",
    });
    expect(d.level).toBe("likely");
    expect(d.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(["BOILERPLATE", "GENERAL", "OVERSEAS"]));
    // A "Funnel Neck" jacket is a product type, not a sales-funnel test.
    expect(dropshipCheck(product(), { ...NO_FACTS, catalog: { count: 30, vendors: ["Closure"], types: ["Funnel Neck"] } }).level).toBe("none");
  });

  it("reads delivery times: processing plus transit, abroad kept apart, holiday delays ignored", () => {
    expect(deliveryFrom("Orders are processed within 1-2 business days. UK delivery 3-5 working days. International orders 7-14 days.")).toEqual({ min_days: 4, max_days: 7, abroad_max_days: 16, overseas: false });
    expect(deliveryFrom("Delivery in 2-3 weeks. During the holiday period expect delays of up to 30-40 days.")).toMatchObject({ min_days: 14, max_days: 21 });
    expect(deliveryFrom("UK Mainland £4.99 3-5 Working Days DPD. Rest Of The World From £15.99 5-10 Working Days DHL")).toMatchObject({ max_days: 5, abroad_max_days: 10 });
    expect(deliveryFrom("We love our customers.")).toBeNull();
  });

  it("lowers an otherwise recommended store to caution when it's likely dropshipped", async () => {
    const c = await checkStore(NO_APP, product({ options: ["Ships From", "Size"] }), { age: async () => 6, partner: noPartner, facts: facts() });
    expect(c.recommendation).toBe("caution");
    expect(c.reasons[0]).toBe('likely dropshipped: "Ships From" option');
  });
});

describe("scorecard", () => {
  const card = async (p: StoreProduct, f: Partial<StoreFacts>, age = 6) => {
    const c = await checkStore(NO_APP, p, { age: async () => age, partner: noPartner, facts: facts(f) });
    return storeScorecard(p, c, [150000, 160000, 140000, 155000]);
  };

  it("scores an established own-label store above a dropshipped one", async () => {
    const good = await card(product(), { product: ownLabel, shipping: "Delivery takes 2-4 business days." });
    const drop = await card(product({ options: ["Ships From"] }), { shipping: "Ships from China, 12-25 days." });
    expect(good.overall).toBeGreaterThan(drop.overall + 15);
    expect(good.rows.find((r) => r.key === "authentic")?.note).toMatch(/own label/);
    expect(drop.rows.find((r) => r.key === "quality")?.note).toMatch(/reviews may be imported/);
    expect(drop.rows.find((r) => r.key === "delivery")?.note).toMatch(/ships from overseas/);
  });

  it("trusts many reviews over a few perfect ones", async () => {
    const many = await card(product({ rating: { value: 4.7, count: 2000 } }), {});
    const few = await card(product({ rating: { value: 5, count: 3 } }), {});
    expect(many.rows[2].score).toBeGreaterThan(few.rows[2].score!);
  });

  it("caps anything to avoid at 20, and leaves value blank without enough to compare", async () => {
    expect((await card(product({ title: "Tote bag 1:1 mirror quality" }), {})).overall).toBeLessThanOrEqual(20);
    expect(valueRow(1000, [900, 1100]).score).toBeNull();
    expect(valueRow(1000, [2000, 2000, 2000]).note).toBe("50% below the typical price of similar results");
  });
});

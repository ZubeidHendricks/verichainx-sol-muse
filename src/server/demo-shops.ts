import { and, eq, inArray, isNull } from "drizzle-orm";

import type { App } from "./app";
import { createMerchant, listItem, registerItem } from "./catalog";
import { schema } from "./db";

/**
 * Demo shops for devnet and the local chain. `.example` domains can't hold a DNS record, so the shops
 * marked `verified` are marked so directly. Demo data only: real shops verify with the TXT record on /merchant.
 */
export const DEMO_SHOPS = [
  { name: "Lerato Bags", domain: "lerato-bags.example", verified: true, items: [
    { title: "Woven Market Tote", price: "129", stock: 60, description: "Hand-woven ilala palm and cotton, brass maker's tag. Made in Cape Town." },
    { title: "Everyday Woven Basket", price: "85", stock: 30, description: "Round basket with leather handles, woven to order." },
  ] },
  { name: "Cape Leather Co", domain: "capeleather.example", verified: true, items: [
    { title: "Everyday Leather Tote", price: "349", stock: 12, description: "Full-grain leather, unlined, saddle-stitched." },
    { title: "Slim Leather Wallet", price: "95", stock: 120, description: "Six cards and notes, vegetable-tanned leather." },
  ] },
  { name: "New Canvas Co", domain: "newcanvas.example", verified: false, items: [
    { title: "Everyday Canvas Tote", price: "89", stock: 200, description: "Heavy waxed canvas with an inside pocket." },
  ] },
];

export async function markDemoShopsVerified(app: App) {
  const domains = DEMO_SHOPS.filter((s) => s.verified).map((s) => s.domain);
  await app.db.update(schema.merchants).set({ domainVerifiedAt: app.now() }).where(inArray(schema.merchants.domain, domains));
  return domains;
}

/**
 * Stock counts for the demo items, so companies can order them by quantity. Matched by shop domain and title, so it
 * can run again on a database seeded before stock existed.
 */
export async function setDemoStock(app: App) {
  for (const s of DEMO_SHOPS) {
    const [m] = await app.db.select().from(schema.merchants).where(eq(schema.merchants.domain, s.domain));
    if (!m) continue;
    for (const it of s.items) {
      await app.db.update(schema.items).set({ stock: it.stock })
        .where(and(eq(schema.items.merchantId, m.id), eq(schema.items.title, it.title), isNull(schema.items.lotOf)));
    }
  }
}

/** Creates the demo shops and mints and lists their items. `log` sees each item as it's listed. */
export async function seedDemoShops(app: App, log: (line: string) => void = () => {}) {
  for (const s of DEMO_SHOPS) {
    const m = await createMerchant(app, { name: s.name, domain: s.domain });
    for (const it of s.items) {
      const slug = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const item = await registerItem(app, m.id, { title: it.title, price: it.price, description: it.description,
        photos: [`${app.config.appUrl}/demo/${slug}.jpg`] });
      await listItem(app, item.id);
      log(`${s.name.padEnd(16)} ${it.title.padEnd(24)} ${it.price.padStart(4)} USDC  ${item.asset}`);
    }
  }
  await markDemoShopsVerified(app);
  await setDemoStock(app);
}

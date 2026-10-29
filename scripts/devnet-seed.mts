/**
 * Demo shops and items on devnet, in the app's own database (PGLITE_DIR, default .data/pglite), so the
 * shopping agent has something to find. Each item is a real Core NFT minted and listed on devnet.
 * Stop `npm run dev` first: PGlite allows one process per data directory.
 *
 * `.example` domains can't hold a DNS record, so the shops marked `verified` are marked so directly. That is
 * demo data only: real shops verify through the TXT record on /merchant.
 *
 *   npm run devnet:seed
 */
import { inArray } from "drizzle-orm";

import { getApp } from "../src/server/app";
import { createMerchant, listItem, registerItem } from "../src/server/catalog";
import { schema } from "../src/server/db";

process.loadEnvFile(".env.local");
const app = await getApp();
const SHOPS = [
  { name: "Lerato Bags", domain: "lerato-bags.example", verified: true, items: [
    { title: "Woven Market Tote", price: "129", description: "Hand-woven ilala palm and cotton, brass maker's tag. Made in Cape Town." },
    { title: "Everyday Woven Basket", price: "85", description: "Round basket with leather handles, woven to order." },
  ] },
  { name: "Cape Leather Co", domain: "capeleather.example", verified: true, items: [
    { title: "Everyday Leather Tote", price: "349", description: "Full-grain leather, unlined, saddle-stitched." },
    { title: "Slim Leather Wallet", price: "95", description: "Six cards and notes, vegetable-tanned leather." },
  ] },
  { name: "New Canvas Co", domain: "newcanvas.example", items: [
    { title: "Everyday Canvas Tote", price: "89", description: "Heavy waxed canvas with an inside pocket." },
  ] },
];

const verifiedDomains = SHOPS.filter((s) => s.verified).map((s) => s.domain);
async function markVerified() {
  await app.db.update(schema.merchants).set({ domainVerifiedAt: app.now() })
    .where(inArray(schema.merchants.domain, verifiedDomains));
}

if ((await app.db.select().from(schema.merchants)).length) {
  await markVerified();
  console.log(`shops already exist; marked ${verifiedDomains.join(", ")} verified`);
  process.exit(0);
}

for (const s of SHOPS) {
  const m = await createMerchant(app, { name: s.name, domain: s.domain });
  for (const it of s.items) {
    const item = await registerItem(app, m.id, { ...it, photos: [] });
    await listItem(app, item.id);
    console.log(`${s.name.padEnd(16)} ${it.title.padEnd(24)} ${it.price.padStart(4)} USDC  ${item.asset}`);
  }
}
await markVerified();
process.exit(0);

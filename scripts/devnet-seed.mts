/**
 * Demo shops and items on devnet, in the app's own database (PGLITE_DIR, default .data/pglite), so the
 * shopping agent has something to find. Each item is a real Core NFT minted and listed on devnet.
 * Stop `npm run dev` first: PGlite allows one process per data directory.
 *
 *   npm run devnet:seed
 */
import { getApp } from "../src/server/app";
import { schema } from "../src/server/db";
import { markDemoShopsVerified, seedDemoShops, setDemoStock } from "../src/server/demo-shops";

process.loadEnvFile(".env.local");
const app = await getApp();
if ((await app.db.select().from(schema.merchants)).length) {
  const domains = await markDemoShopsVerified(app);
  await setDemoStock(app);
  console.log(`shops already exist; marked ${domains.join(", ")} verified and set their stock`);
  process.exit(0);
}
await seedDemoShops(app, console.log);
process.exit(0);

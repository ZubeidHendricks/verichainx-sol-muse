/** Prints a summary of the local database (PGLITE_DIR, default .data/pglite). Stop `npm run dev` first. */
import { openDb, schema } from "../src/server/db";

const db = await openDb(process.env.PGLITE_DIR ?? ".data/pglite");
for (const [name, table] of Object.entries({ merchants: schema.merchants, items: schema.items, offers: schema.offers, orders: schema.orders })) {
  const rows = await db.select().from(table);
  console.log(name.padEnd(10), rows.length, name === "items" ? rows.map((r) => `${(r as { title: string }).title}:${(r as { status: string }).status}`).join(", ") : "");
}
process.exit(0);

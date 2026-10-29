/** Applies migrations to DATABASE_URL (run once before a deploy, so cold starts don't race to migrate). */
import { openPostgres } from "../src/server/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = await openPostgres(url);
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
console.log("migrated");

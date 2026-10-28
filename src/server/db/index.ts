import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

export { schema };
export type Db = Awaited<ReturnType<typeof openDb>>;

/**
 * Opens the database and applies migrations. v1 runs on PGlite (in-process Postgres): a directory for
 * local dev, memory for tests. Neon is added at deploy time behind the same Drizzle schema.
 */
export async function openDb(dataDir?: string) {
  const db = drizzle({ client: new PGlite(dataDir), schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

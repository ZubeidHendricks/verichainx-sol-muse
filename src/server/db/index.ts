import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";

import * as schema from "./schema";

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = () => path.join(process.cwd(), "drizzle");

/** Hosted Postgres (Neon on Vercel), when DATABASE_URL is set. Migrations run on first open. */
export async function openPostgres(url: string): Promise<Db> {
  const db = drizzlePg({ client: new Pool({ connectionString: url, max: 5 }), schema });
  await migratePg(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/** PGlite (in-process Postgres): a directory for local dev, memory for tests. */
export async function openDb(dataDir?: string): Promise<Db> {
  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    lockDir(dataDir);
  }
  const db = drizzle({ client: new PGlite(dataDir), schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/**
 * PGlite is single-process: a second process on the same directory corrupts it. Holds a pid lock for
 * the life of this process and refuses to open a directory another live process holds.
 */
function lockDir(dataDir: string) {
  const lock = path.join(dataDir, "vcx.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    if (pid && pid !== process.pid && alive(pid)) {
      throw new Error(`${dataDir} is in use by process ${pid} (stop \`npm run dev\` or use another PGLITE_DIR)`);
    }
  }
  writeFileSync(lock, String(process.pid));
  process.once("exit", () => {
    try { if (Number(readFileSync(lock, "utf8")) === process.pid) rmSync(lock); } catch { /* already gone */ }
  });
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

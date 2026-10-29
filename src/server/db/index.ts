import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    lockDir(dataDir);
  }
  const db = drizzle({ client: new PGlite(dataDir), schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
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

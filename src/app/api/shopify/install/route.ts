import { connection } from "next/server";

import { getApp } from "@/server/app";
import { shopifyInstallGet } from "@/server/handlers";

export async function GET(req: Request) {
  await connection(); // per request: it reads cookies and redirects
  return shopifyInstallGet(await getApp(), req);
}

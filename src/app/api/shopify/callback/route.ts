import { connection } from "next/server";

import { getApp } from "@/server/app";
import { shopifyCallbackGet } from "@/server/handlers";

export async function GET(req: Request) {
  await connection(); // per request: it reads cookies and redirects
  return shopifyCallbackGet(await getApp(), req);
}

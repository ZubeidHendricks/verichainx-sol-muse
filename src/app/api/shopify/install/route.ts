import { getApp } from "@/server/app";
import { shopifyInstallGet } from "@/server/handlers";

export async function GET(req: Request) {
  return shopifyInstallGet(await getApp(), req);
}

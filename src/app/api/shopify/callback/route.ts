import { getApp } from "@/server/app";
import { shopifyCallbackGet } from "@/server/handlers";

export async function GET(req: Request) {
  return shopifyCallbackGet(await getApp(), req);
}

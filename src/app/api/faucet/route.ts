import { getApp } from "@/server/app";
import { faucetPost } from "@/server/handlers";

export async function POST(req: Request) {
  return faucetPost(await getApp(), req);
}

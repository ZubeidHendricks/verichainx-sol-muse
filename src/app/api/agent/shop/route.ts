import { getApp } from "@/server/app";
import { shopPost } from "@/server/handlers";

export async function POST(req: Request) {
  return shopPost(await getApp(), req);
}

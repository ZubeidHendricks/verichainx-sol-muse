import { getApp } from "@/server/app";
import { siwsGet, siwsPost } from "@/server/handlers";

export async function GET(req: Request) {
  return siwsGet(await getApp(), req);
}

export async function POST(req: Request) {
  return siwsPost(await getApp(), req);
}

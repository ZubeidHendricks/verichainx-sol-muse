import { getApp } from "@/server/app";
import { merchantAgentPost, preflight } from "@/server/handlers";

export async function POST(req: Request) {
  return merchantAgentPost(await getApp(), req);
}

export async function OPTIONS() {
  return preflight(await getApp());
}

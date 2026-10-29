import { getApp } from "@/server/app";
import { ordersPaidPost } from "@/server/handlers";

export async function POST(req: Request) {
  return ordersPaidPost(await getApp(), req);
}

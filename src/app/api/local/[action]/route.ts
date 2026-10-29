import { getApp } from "@/server/app";
import { localPost } from "@/server/handlers";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  return localPost(await getApp(), req, (await params).action);
}

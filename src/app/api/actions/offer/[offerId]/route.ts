import { getApp } from "@/server/app";
import { actionGet, actionPost, preflight } from "@/server/handlers";

type Ctx = { params: Promise<{ offerId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return actionGet(await getApp(), (await params).offerId);
}

export async function POST(req: Request, { params }: Ctx) {
  return actionPost(await getApp(), (await params).offerId, req);
}

export async function OPTIONS() {
  return preflight(await getApp());
}

import { getApp } from "@/server/app";
import { payGet, payPost, preflight } from "@/server/handlers";

type Ctx = { params: Promise<{ offerId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return payGet(await getApp(), (await params).offerId);
}

export async function POST(req: Request, { params }: Ctx) {
  return payPost(await getApp(), (await params).offerId, req);
}

export async function OPTIONS() {
  return preflight(await getApp());
}

import { getApp } from "@/server/app";
import { offerStatusGet } from "@/server/handlers";

export async function GET(_req: Request, { params }: { params: Promise<{ offerId: string }> }) {
  return offerStatusGet(await getApp(), (await params).offerId);
}

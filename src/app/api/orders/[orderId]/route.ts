import { getApp } from "@/server/app";
import { orderGet } from "@/server/handlers";

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  return orderGet(await getApp(), (await params).orderId);
}

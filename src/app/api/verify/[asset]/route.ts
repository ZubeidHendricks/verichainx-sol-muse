import { getApp } from "@/server/app";
import { verifyAssetGet } from "@/server/handlers";

export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  return verifyAssetGet(await getApp(), (await params).asset);
}

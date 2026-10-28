import { getApp } from "@/server/app";
import { wellKnown } from "@/server/handlers";

export async function GET() {
  return wellKnown(await getApp());
}

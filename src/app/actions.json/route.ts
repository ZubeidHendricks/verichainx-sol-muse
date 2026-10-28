import { getApp } from "@/server/app";
import { actionsJson, preflight } from "@/server/handlers";

export async function GET() {
  return actionsJson(await getApp());
}

export async function OPTIONS() {
  return preflight(await getApp());
}

import { connection } from "next/server";

import { getApp } from "@/server/app";
import { actionsJson, preflight } from "@/server/handlers";

export async function GET() {
  await connection(); // config comes from the runtime environment, not the build
  return actionsJson(await getApp());
}

export async function OPTIONS() {
  return preflight(await getApp());
}

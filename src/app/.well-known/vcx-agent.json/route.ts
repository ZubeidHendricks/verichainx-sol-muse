import { connection } from "next/server";

import { getApp } from "@/server/app";
import { wellKnown } from "@/server/handlers";

export async function GET() {
  await connection(); // config comes from the runtime environment, not the build
  return wellKnown(await getApp());
}

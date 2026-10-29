import { getApp } from "@/server/app";
import { logoutPost } from "@/server/handlers";

export async function POST() {
  return logoutPost(await getApp());
}

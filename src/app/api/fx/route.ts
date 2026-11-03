import { usdRates } from "@/server/fx";

export async function GET() {
  return Response.json(await usdRates());
}

import { cacheLife } from "next/cache";

/** Currencies the price picker offers. USDC is pegged 1:1 to the US dollar, so USD needs no rate. */
export const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "INR", "BRL", "NGN", "KES"] as const;

export type Rates = { rates: Record<string, number>; asOf: string; live: boolean };

// Rough rates for when the rate service is down; the picker says they're approximate.
const FALLBACK: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, ZAR: 18, INR: 84, BRL: 5.6, NGN: 1600, KES: 129 };

/** US dollar rates from a free, keyless service, refreshed every few hours. */
export async function usdRates(): Promise<Rates> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
    if (body.result !== "success" || !body.rates) throw new Error("no rates");
    const rates = Object.fromEntries(CURRENCIES.filter((c) => body.rates![c]).map((c) => [c, body.rates![c]]));
    return { rates: { ...FALLBACK, ...rates, USD: 1 }, asOf: body.time_last_update_utc ?? "", live: true };
  } catch {
    return { rates: FALLBACK, asOf: "", live: false };
  }
}

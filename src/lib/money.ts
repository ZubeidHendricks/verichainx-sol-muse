/** USDC amounts are handled as integer base units (6 decimals) and shown as decimal strings. */
export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

export function parseUsdc(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new Error(`not a USDC amount: ${amount}`);
  return BigInt(m[1]) * SCALE + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
}

export function formatUsdc(units: bigint): string {
  const whole = units / SCALE;
  const frac = (units % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Splits a price into the merchant's share and the protocol fee. The fee rounds down. */
export function splitPrice(price: bigint, feeBps: number): { merchant: bigint; fee: bigint } {
  if (price <= 0n) throw new Error("price must be positive");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error("fee must be 0–10%");
  const fee = (price * BigInt(feeBps)) / 10_000n;
  return { merchant: price - fee, fee };
}

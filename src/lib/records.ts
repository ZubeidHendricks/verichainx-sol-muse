import { canonicalJson } from "./canonical";

/** Memo records (§7.3): `vcx1:` + canonical JSON, at most 500 bytes. The full record lives off-chain. */
export const MEMO_PREFIX = "vcx1:";
const MAX_BYTES = 500;

export type OriginMemo = { t: "origin"; asset: string; h: string; m: string };
export type OrderMemo = { t: "order"; o: string; asset: string; s: "paid" | "shipped" | "delivered"; h: string };
export type Memo = OriginMemo | OrderMemo;

export function encodeMemo(memo: Memo): string {
  const text = MEMO_PREFIX + canonicalJson(memo);
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("memo record over 500 bytes");
  return text;
}

export function decodeMemo(text: string): Memo | null {
  // RPC log lines and explorers sometimes show the memo with a length prefix like "[63] ".
  const start = text.indexOf(MEMO_PREFIX);
  if (start < 0) return null;
  try {
    const memo = JSON.parse(text.slice(start + MEMO_PREFIX.length));
    return memo && (memo.t === "origin" || memo.t === "order") ? memo : null;
  } catch {
    return null;
  }
}

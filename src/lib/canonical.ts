import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** JSON with sorted keys and no whitespace, so anyone can recompute a hash or signature. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys(obj[k])]),
    );
  }
  if (typeof value === "bigint") throw new TypeError("bigint is not canonical JSON; use a decimal string");
  return value;
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

export function hashRecord(record: unknown): string {
  return sha256Hex(canonicalJson(record));
}

import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";

import { canonicalJson, hashRecord } from "@/lib/canonical";
import { CHAINS, caip10, parseCaip10 } from "@/lib/chains";
import { newEnvelope, signEnvelope, verifyEnvelope } from "@/lib/envelope";
import { formatUsdc, parseUsdc, splitPrice } from "@/lib/money";
import { decodeMemo, encodeMemo } from "@/lib/records";

const seed = ed25519.utils.randomPrivateKey();
const from = caip10(CHAINS.solanaDevnet, bs58.encode(ed25519.getPublicKey(seed)));
const offer = { offer_id: "of_1", title: "Woven Tote", price: "129.00", currency: "USDC", chain: CHAINS.solanaDevnet,
  merchant: "lerato" };

describe("envelopes", () => {
  it("round-trips a signed offer", () => {
    const env = signEnvelope(newEnvelope("offer", from, offer), seed);
    expect(verifyEnvelope(env)).toEqual({ ok: true });
    expect(verifyEnvelope(JSON.parse(JSON.stringify(env)))).toEqual({ ok: true }); // survives the wire
  });

  it("rejects a changed price, a different signer, expiry and other chains", () => {
    const env = signEnvelope(newEnvelope("offer", from, offer), seed);
    expect(verifyEnvelope({ ...env, body: { ...offer, price: "12.90" } })).toMatchObject({ reason: "bad signature" });
    const other = signEnvelope(newEnvelope("offer", from, offer), ed25519.utils.randomPrivateKey());
    expect(verifyEnvelope(other)).toMatchObject({ reason: "bad signature" });
    expect(verifyEnvelope(env, new Date(Date.now() + 16 * 60_000))).toMatchObject({ reason: "expired" });
    expect(verifyEnvelope({ ...env, from: "hedera:testnet:0.0.123" })).toMatchObject({ ok: false });
    expect(verifyEnvelope({ ...env, sig: undefined })).toMatchObject({ reason: "unsigned" });
    expect(verifyEnvelope({ v: "other" })).toMatchObject({ reason: "malformed envelope" });
  });

  it("parses CAIP-10 ids for every chain the apps use", () => {
    expect(parseCaip10("hedera:testnet:0.0.11194128")).toEqual({ chain: "hedera:testnet", address: "0.0.11194128" });
    expect(parseCaip10(`${CHAINS.seiTestnet}:0xabc`).chain).toBe("eip155:1328");
    expect(() => parseCaip10("nonsense")).toThrow();
  });
});

describe("canonical records", () => {
  it("hashes the same regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(hashRecord({ b: 1, a: 2 })).toBe(hashRecord({ a: 2, b: 1 }));
    expect(() => canonicalJson({ n: 1n })).toThrow();
  });

  it("encodes memos with the vcx1 prefix and refuses oversized ones", () => {
    const memo = encodeMemo({ t: "origin", asset: "A", h: "ff", m: "M" });
    expect(memo).toBe('vcx1:{"asset":"A","h":"ff","m":"M","t":"origin"}');
    expect(decodeMemo(`[48] ${memo}`)).toEqual({ t: "origin", asset: "A", h: "ff", m: "M" });
    expect(decodeMemo("gm")).toBeNull();
    expect(() => encodeMemo({ t: "origin", asset: "A".repeat(600), h: "", m: "" })).toThrow(/500 bytes/);
  });
});

describe("money", () => {
  it("parses, formats and splits USDC without floats", () => {
    expect(parseUsdc("129")).toBe(129_000_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(formatUsdc(127_710_000n)).toBe("127.71");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(splitPrice(parseUsdc("129.00"), 100)).toEqual({ merchant: 127_710_000n, fee: 1_290_000n });
    expect(() => parseUsdc("1e3")).toThrow();
    expect(() => splitPrice(0n, 100)).toThrow();
    expect(() => splitPrice(1n, 5000)).toThrow();
  });
});

import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { z } from "zod";

import { canonicalJson } from "./canonical";
import { parseCaip10 } from "./chains";

/** The shared agent message format (§10). Signed over the canonical JSON of everything except `sig`. */
export const VERSION = "vcx-agent/1";

export const needBody = z.object({
  text: z.string().min(1).max(500),
  budget: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  currency: z.string().default("USDC"),
});

export const offerBody = z.object({
  offer_id: z.string(),
  title: z.string(),
  price: z.string().regex(/^\d+(\.\d{1,6})?$/),
  currency: z.string(),
  chain: z.string(),
  asset: z.string().optional(),
  merchant: z.string(),
  merchant_domain: z.string().optional(),
  pitch: z.string().optional(),
  image: z.string().optional(),
  pay_url: z.string().optional(),
  action_url: z.string().optional(),
  in_reply_to: z.string().optional(),
});

export const declineBody = z.object({ reason: z.string(), in_reply_to: z.string().optional() });

export const envelopeSchema = z.object({
  v: z.literal(VERSION),
  type: z.enum(["need", "offer", "decline"]),
  id: z.string(),
  from: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  body: z.record(z.string(), z.unknown()),
  sig: z.string().optional(),
});

export type Envelope = z.infer<typeof envelopeSchema>;
export type OfferBody = z.infer<typeof offerBody>;
export type NeedBody = z.infer<typeof needBody>;

export function signingBytes(env: Envelope): Uint8Array {
  return new TextEncoder().encode(canonicalJson({ ...env, sig: undefined })); // canonicalJson drops undefined
}

/** `secretKey` is the 32-byte ed25519 seed (or a 64-byte Solana secret key, whose first half is the seed). */
export function signEnvelope(env: Omit<Envelope, "sig">, secretKey: Uint8Array): Envelope {
  const unsigned = { ...env, sig: undefined } as Envelope;
  const sig = ed25519.sign(signingBytes(unsigned), secretKey.slice(0, 32));
  return { ...env, sig: bs58.encode(sig) };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Verifies a Solana-signed envelope: well-formed, unexpired, and signed by the key in `from`. */
export function verifyEnvelope(env: unknown, now = new Date()): VerifyResult {
  const parsed = envelopeSchema.safeParse(env);
  if (!parsed.success) return { ok: false, reason: "malformed envelope" };
  const e = parsed.data;
  if (!e.sig) return { ok: false, reason: "unsigned" };
  let chain: string, address: string;
  try {
    ({ chain, address } = parseCaip10(e.from));
  } catch {
    return { ok: false, reason: "bad sender id" };
  }
  if (!chain.startsWith("solana:")) return { ok: false, reason: `signature on ${chain} is verified by that chain's app` };
  if (Date.parse(e.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
  try {
    const pub = bs58.decode(address);
    if (pub.length !== 32 || !ed25519.verify(bs58.decode(e.sig), signingBytes(e), pub)) {
      return { ok: false, reason: "bad signature" };
    }
  } catch {
    return { ok: false, reason: "bad signature" };
  }
  return { ok: true };
}

export function newEnvelope(
  type: Envelope["type"],
  from: string,
  body: Record<string, unknown>,
  ttlMinutes = 15,
  now = new Date(),
): Omit<Envelope, "sig"> {
  return {
    v: VERSION,
    type,
    id: crypto.randomUUID(),
    from,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    body,
  };
}

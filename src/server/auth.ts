import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

import type { App } from "./app";
import { Refused } from "./catalog";

/**
 * §11.4 Sign In With Solana. Stateless: the challenge and the session are values signed with a key
 * derived from KEY_SEAL_SECRET, kept in HTTP-only cookies. The wallet's ed25519 signature over the
 * SIWS message proves it holds the key; the domain and nonce in the message must match the challenge.
 */

export const CHALLENGE_COOKIE = "vcx_siws";
export const SESSION_COOKIE = "vcx_session";
const CHALLENGE_MINUTES = 10;
const SESSION_HOURS = 12;

const key = (app: App) => createHmac("sha256", app.config.sealSecret).update("vcx-session-v1").digest();
export const mac = (app: App, data: string) => createHmac("sha256", key(app)).update(data).digest("base64url");

/** A value only this server can have made: JSON, base64url, with an HMAC tag. Not encrypted. */
export function seal(app: App, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(app, body)}`;
}

export function open<T>(app: App, token: string | undefined): T | null {
  if (!token) return null;
  const [body, tag] = token.split(".");
  if (!body || !tag) return null;
  const want = Buffer.from(mac(app, body));
  const got = Buffer.from(tag);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

type Challenge = { domain: string; nonce: string; exp: number };
type Session = { address: string; exp: number };

/** The SIWS input the wallet signs, and the signed challenge to keep in a cookie. */
export function signInChallenge(app: App, domain: string) {
  const now = app.now();
  const nonce = randomBytes(12).toString("hex");
  const exp = now.getTime() + CHALLENGE_MINUTES * 60_000;
  return {
    input: {
      domain,
      statement: "Sign in to VeriChainX to manage your shop. This doesn't move any funds.",
      uri: app.config.appUrl,
      version: "1",
      chainId: app.config.cluster === "mainnet" ? "mainnet" : "devnet",
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: new Date(exp).toISOString(),
    },
    cookie: seal(app, { domain, nonce, exp } satisfies Challenge),
  };
}

/** Checks a SIWS result against the challenge; returns the session cookie value and the address. */
export function completeSignIn(app: App, challengeCookie: string | undefined,
  out: { address: string; signedMessage: string; signature: string }) {
  const c = open<Challenge>(app, challengeCookie);
  if (!c || c.exp < app.now().getTime()) throw new Refused("the sign-in request expired; try again");
  let pub: Uint8Array;
  try {
    pub = bs58.decode(out.address);
  } catch {
    throw new Refused("not a Solana address");
  }
  const msg = Buffer.from(out.signedMessage, "base64");
  const sig = Buffer.from(out.signature, "base64");
  if (pub.length !== 32 || sig.length !== 64 || !ed25519.verify(sig, msg, pub)) throw new Refused("the signature doesn't match the wallet");
  // Wallets may wrap the text in an off-chain message header, so look for the lines rather than an exact start.
  const text = msg.toString("utf8");
  if (!text.includes(`${c.domain} wants you to sign in with your Solana account:\n${out.address}`)) {
    throw new Refused("the signed message is for a different site or account");
  }
  if (!text.includes(`Nonce: ${c.nonce}`)) throw new Refused("the signed message is from an old sign-in request");
  const session: Session = { address: out.address, exp: app.now().getTime() + SESSION_HOURS * 3_600_000 };
  return { address: out.address, cookie: seal(app, session) };
}

/** The signed-in wallet, or null. */
export function sessionAddress(app: App, cookie: string | undefined): string | null {
  const s = open<Session>(app, cookie);
  return s && s.exp > app.now().getTime() ? s.address : null;
}

export function readCookie(req: Request, name: string): string | undefined {
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
}

export function setCookie(app: App, name: string, value: string, maxAgeSeconds: number): string {
  const secure = app.config.appUrl.startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

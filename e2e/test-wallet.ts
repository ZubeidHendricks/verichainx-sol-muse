import { generateKeyPairSync } from "node:crypto";

import type { Page } from "@playwright/test";

/** A fresh ed25519 key for the test wallet, as base64 PKCS#8 and its raw 32-byte public key. */
export function newWalletKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    pkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    pub: spki.subarray(spki.length - 32).toString("base64"),
  };
}

/**
 * Registers "Test Wallet" with the Wallet Standard on every page load, holding `key`. It signs in the page
 * with WebCrypto, funds itself on first connect, and sends through the local chain's /api/local/send,
 * as a real wallet would through its RPC node.
 */
export async function installTestWallet(page: Page, key: { pkcs8: string; pub: string }) {
  await page.addInitScript(({ pkcs8, pub }) => {
    const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const b58 = (bytes: Uint8Array) => {
      let n = 0n;
      for (const b of bytes) n = n * 256n + BigInt(b);
      let s = "";
      while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
      for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
      return s;
    };
    const fromB64 = (s: string) => new Uint8Array(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
    const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const publicKey = fromB64(pub);
    const address = b58(publicKey);
    const keyP = crypto.subtle.importKey("pkcs8", fromB64(pkcs8), { name: "Ed25519" }, false, ["sign"]);
    const sign = async (msg: Uint8Array) => new Uint8Array(await crypto.subtle.sign("Ed25519", await keyP, new Uint8Array(msg)));
    const chains = ["solana:devnet"] as const;
    const account = { address, publicKey, chains, features: ["solana:signAndSendTransaction", "solana:signMessage"] };
    let funded = false;

    // Wire format: compact-u16 signature count, the signatures, then the message.
    async function signTx(tx: Uint8Array) {
      const sigCount = tx[0];
      const msgStart = 1 + 64 * sigCount;
      const msg = tx.subarray(msgStart);
      let p = msg[0] & 0x80 ? 1 : 0; // versioned message prefix
      const required = msg[p];
      p += 3;
      const accountCount = msg[p++];
      for (let i = 0; i < Math.min(required, accountCount); i++) {
        const k = msg.subarray(p + 32 * i, p + 32 * (i + 1));
        if (k.every((b, j) => b === publicKey[j])) {
          const out = new Uint8Array(tx);
          out.set(await sign(msg), 1 + 64 * i);
          return out;
        }
      }
      throw new Error("Test Wallet isn't a signer on this transaction.");
    }

    const wallet = {
      version: "1.0.0" as const,
      name: "Test Wallet",
      icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#5b3fd9"/></svg>'),
      chains,
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => {
          if (!funded) {
            const r = await fetch("/api/local/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
            if (!r.ok) throw new Error(`fund failed: ${r.status}`);
            funded = true;
          }
          return { accounts: [account] };
        } },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: { message: Uint8Array }[]) =>
          Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: await sign(i.message) }))) },
        "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: async (...inputs: { transaction: Uint8Array }[]) => Promise.all(inputs.map(async (i) => {
            const signed = await signTx(i.transaction);
            const r = await fetch("/api/local/send", { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ transaction: toB64(signed) }) });
            if (!r.ok) throw new Error((await r.json()).message ?? `send failed: ${r.status}`);
            return { signature: signed.subarray(1, 65) };
          })) },
      },
    };
    const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
  }, key);
}

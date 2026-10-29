import {
  SolanaSignAndSendTransaction, SolanaSignIn, SolanaSignMessage,
  type SolanaSignAndSendTransactionFeature, type SolanaSignInFeature, type SolanaSignMessageFeature,
} from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import bs58 from "bs58";

import { siwsMessage, type SiwsInput } from "./siws";

/** Wallet Standard chain ids (not CAIP-2): what wallets such as Phantom and Solflare advertise. */
export const walletChain = (cluster: "devnet" | "mainnet"): `solana:${string}` => (cluster === "mainnet" ? "solana:mainnet" : "solana:devnet");

export type PayWallet = Wallet & { features: StandardConnectFeature & SolanaSignAndSendTransactionFeature };

/** Wallets that can connect and sign and send on any Solana cluster (the cluster is checked at payment). */
export function canSend(w: Wallet): w is PayWallet {
  return StandardConnect in w.features && SolanaSignAndSendTransaction in w.features;
}

/** Wallets that can connect, and sign and send a transaction on this cluster. */
export function canPay(w: Wallet, chain: string): w is PayWallet {
  return StandardConnect in w.features && SolanaSignAndSendTransaction in w.features && w.chains.includes(chain as `${string}:${string}`);
}

/**
 * §5 story 4, buy in the app: connect, ask the server for the purchase transaction for this account
 * (the same Solana Pay endpoint a phone wallet uses), then the wallet signs and sends it. The server
 * has already signed as fee payer and settlement key, so the buyer's signature completes it.
 */
export async function payWithWallet(w: PayWallet, offerId: string, chain: string, fetchFn: typeof fetch = fetch,
  payBase = "") {
  const { accounts } = await w.features[StandardConnect].connect();
  const account: WalletAccount | undefined = accounts.find((a) => a.chains.includes(chain as `${string}:${string}`)) ?? accounts[0];
  if (!account) throw new Error("The wallet didn't share an account.");
  const r = await fetchFn(`${payBase}/api/pay/${offerId}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: account.address }),
  });
  // Solana Pay and Actions put both the success note and the error text in `message`.
  const body = (await r.json()) as { transaction?: string; message?: string };
  if (!r.ok || !body.transaction) throw new Error(body.message ?? `The shop couldn't prepare the payment (HTTP ${r.status}).`);
  const [out] = await w.features[SolanaSignAndSendTransaction].signAndSendTransaction({
    account, chain: chain as `${string}:${string}`,
    transaction: Uint8Array.from(atob(body.transaction), (c) => c.charCodeAt(0)),
    options: { commitment: "confirmed" },
  });
  return { signature: bs58.encode(out.signature), account: account.address, message: body.message };
}

type SignInWallet = Wallet & { features: StandardConnectFeature & Partial<SolanaSignInFeature & SolanaSignMessageFeature> };
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

/** Wallets that can sign in: the SIWS feature, or plain message signing as a fallback. */
export function canSignIn(w: Wallet): w is SignInWallet {
  return StandardConnect in w.features && (SolanaSignIn in w.features || SolanaSignMessage in w.features);
}

/** §11.4: signs the server's SIWS input; returns what POST /api/auth/siws expects. */
export async function signInWithWallet(w: SignInWallet, input: SiwsInput) {
  const signIn = w.features[SolanaSignIn];
  if (signIn) {
    const [out] = await signIn.signIn(input);
    return { address: out.account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature) };
  }
  const { accounts } = await w.features[StandardConnect].connect();
  const account = accounts[0];
  if (!account) throw new Error("The wallet didn't share an account.");
  const message = new TextEncoder().encode(siwsMessage(input, account.address));
  const [out] = await w.features[SolanaSignMessage]!.signMessage({ account, message });
  return { address: account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature) };
}

/** Signs and sends a transaction the server prepared (and already signed as fee payer) from this account. */
export async function sendWithWallet(w: PayWallet, address: string, transaction: string, chain: string) {
  const { accounts } = await w.features[StandardConnect].connect();
  const account = accounts.find((a) => a.address === address);
  if (!account) throw new Error("Switch your wallet to the account you signed in with.");
  const [out] = await w.features[SolanaSignAndSendTransaction].signAndSendTransaction({
    account, chain: chain as `${string}:${string}`,
    transaction: Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0)), options: { commitment: "confirmed" },
  });
  return bs58.encode(out.signature);
}

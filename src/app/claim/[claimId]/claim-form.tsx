"use client";

import type { Wallet } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { useActionState, useState } from "react";

import { useWallets } from "../../ui/wallets";

import { claim, type ClaimState } from "./actions";

type ConnectWallet = Wallet & { features: StandardConnectFeature };
const canConnect = (w: Wallet): w is ConnectWallet => StandardConnect in w.features;

/** The order's email, and the wallet to receive the NFT: connected, or pasted. */
export function ClaimForm({ claimId, token }: { claimId: string; token: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claim.bind(null, claimId, token), {});
  const wallets = useWallets(canConnect);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function connect(w: ConnectWallet) {
    setError(null);
    try {
      const { accounts } = await w.features[StandardConnect].connect();
      if (!accounts[0]) throw new Error("The wallet didn't share an account.");
      setAddress(accounts[0].address);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (state.signature) return <p className="status paid" role="status">Sent. The NFT is in your wallet.</p>;
  return (
    <form action={action} className="board stack" style={{ gap: 12 }}>
      <label>Email you ordered with<input name="email" type="email" required autoComplete="email" /></label>
      <label>Your Solana wallet address<input name="address" required value={address} onChange={(e) => setAddress(e.target.value)}
        className="mono" autoComplete="off" spellCheck={false} /></label>
      {wallets.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {wallets.map((w) => (
            <button key={w.name} type="button" className="btn small ghost" onClick={() => connect(w)}>Use {w.name}</button>
          ))}
        </div>
      )}
      <button className="btn pay" type="submit" disabled={pending}>{pending ? "Sending the NFT…" : "Claim the NFT"}</button>
      {(state.error || error) && <p className="notice error" role="alert">{state.error ?? error}</p>}
    </form>
  );
}

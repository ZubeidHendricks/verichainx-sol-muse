"use client";

import type { Wallet } from "@wallet-standard/base";
import { getWallets } from "@wallet-standard/app";
import { useEffect, useState } from "react";

import { canPay, payWithWallet } from "@/lib/wallet";

/** Pay from a wallet installed in this browser (Phantom, Solflare, Backpack…) via the Wallet Standard. */
export function WalletBuy({ offerId, chain }: { offerId: string; chain: string }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ error?: string; signature?: string } | null>(null);

  useEffect(() => {
    const api = getWallets();
    const update = () => setWallets(api.get().filter((w) => canPay(w, chain)));
    update();
    const offs = [api.on("register", update), api.on("unregister", update)];
    return () => offs.forEach((off) => off());
  }, [chain]);

  async function pay(w: Wallet) {
    if (!canPay(w, chain)) return;
    setBusy(w.name);
    setResult(null);
    try {
      const { signature } = await payWithWallet(w, offerId, chain);
      setResult({ signature });
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!wallets.length) {
    return <p className="small muted">No Solana wallet found in this browser. Scan the code with your phone instead.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {wallets.map((w) => (
          <button key={w.name} type="button" className="btn pay" onClick={() => pay(w)} disabled={busy !== null}>
            {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs */}
            <img src={w.icon} alt="" width={18} height={18} style={{ verticalAlign: "-3px", marginRight: 8, borderRadius: 4 }} />
            {busy === w.name ? "Approve in your wallet…" : `Pay with ${w.name}`}
          </button>
        ))}
      </div>
      {chain === "solana:devnet" && <p className="small muted" style={{ margin: 0 }}>Switch your wallet to devnet first.</p>}
      {result?.error && <p className="notice error" role="alert">{result.error}</p>}
      {result?.signature && <p className="status" role="status">Sent. Waiting for Solana to confirm it…</p>}
    </div>
  );
}

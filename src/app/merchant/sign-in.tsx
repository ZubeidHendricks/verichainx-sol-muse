"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useWallets, rememberWallet } from "@/app/ui/wallets";
import { canSignIn, signInWithWallet } from "@/lib/wallet";

export function SignIn({ address }: { address: string | null }) {
  const wallets = useWallets(canSignIn);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(w: (typeof wallets)[number]) {
    setBusy(true);
    setError(null);
    try {
      const { input } = await (await fetch("/api/auth/siws", { cache: "no-store" })).json();
      const signed = await signInWithWallet(w, input);
      const r = await fetch("/api/auth/siws", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed) });
      if (!r.ok) throw new Error((await r.json()).message ?? "Sign-in failed.");
      rememberWallet(w.name);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  if (address) {
    return (
      <p className="small">
        Signed in as <span className="mono">{address.slice(0, 4)}…{address.slice(-4)}</span>{" "}
        <button type="button" className="btn small ghost" onClick={signOut}>Sign out</button>
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {wallets.length === 0 ? (
        <p className="small muted">Install a Solana wallet such as Phantom or Solflare to sign in.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {wallets.map((w) => (
            <button key={w.name} type="button" className="btn" disabled={busy} onClick={() => signIn(w)}>
              {busy ? "Check your wallet…" : `Sign in with ${w.name}`}
            </button>
          ))}
        </div>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}

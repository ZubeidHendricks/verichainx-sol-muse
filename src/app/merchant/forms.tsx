"use client";

import { useActionState, useState, useTransition } from "react";

import { lastWallet, useWallets } from "@/app/ui/wallets";
import { canPay, canSend, sendWithWallet } from "@/lib/wallet";

import { addItem, addShop, confirmListing, resell, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="notice error" role="alert">{state.error}</p>;
  if (state.done) return <p className="status paid" role="status">{state.done}</p>;
  return null;
}

/**
 * When the server hands back a transaction (own-wallet shops), the signed-in wallet signs and sends it,
 * then the server reads the result back from the chain.
 */
function useWalletStep(address: string | null, chain: string) {
  const wallets = useWallets(canSend);
  return async (state: ActionState, itemId: string): Promise<ActionState> => {
    if (!state.transaction) return state;
    const w = lastWallet(wallets.filter((x) => canPay(x, chain)));
    if (!w || !address) return { error: "Open the wallet you signed in with, then try again." };
    try {
      await sendWithWallet(w, address, state.transaction, chain);
    } catch (e) {
      return { error: (e as Error).message };
    }
    for (let i = 0; i < 6; i++) {
      const done = await confirmListing(itemId);
      if (done.error || done.done !== "Saved.") return done;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { error: "Sent, but the chain hasn't shown the change yet. Refresh in a moment." };
  };
}

export function AddShopForm({ demo }: { demo: boolean }) {
  const [state, action, pending] = useActionState(addShop, {});
  return (
    <form action={action}>
      <label>Shop name<input name="name" required maxLength={80} placeholder="Lerato Bags" /></label>
      <label>Website domain (optional, verified by DNS)<input name="domain" maxLength={120} placeholder="leratobags.co.za" /></label>
      {demo && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="custody" value="vault" /> Let the service hold this shop&apos;s wallet (devnet demo)
        </label>
      )}
      <button className="btn" type="submit" disabled={pending}>{pending ? "Adding…" : "Add shop"}</button>
      <Result state={state} />
    </form>
  );
}

export function AddItemForm({ merchantId, vault }: { merchantId: string; vault: boolean }) {
  const [state, action, pending] = useActionState(addItem.bind(null, merchantId), {});
  return (
    <form action={action}>
      <label>Title<input name="title" required maxLength={120} placeholder="Woven Market Tote" /></label>
      <label>Description<textarea name="description" rows={2} maxLength={600} /></label>
      <label>Price in USDC<input name="price" required inputMode="decimal" placeholder="129" /></label>
      <label>Photo URLs (https, space-separated, up to 4)<input name="photos" /></label>
      {vault && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="list" defaultChecked /> List it for sale now</label>}
      <button className="btn" type="submit" disabled={pending}>{pending ? "Minting on devnet…" : "Register item"}</button>
      {!vault && <p className="small muted" style={{ margin: 0 }}>The NFT is minted to your wallet. List it from the table to start selling.</p>}
      <Result state={state} />
    </form>
  );
}

/** List, delist or check DNS, with the wallet step when the shop holds its own keys. */
export function ActionButton({ run, label, busy, itemId, address, chain }: {
  run: () => Promise<ActionState>; label: string; busy: string; itemId?: string; address: string | null; chain: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const walletStep = useWalletStep(address, chain);
  return (
    <>
      <button className="btn small ghost" type="button" disabled={pending}
        onClick={() => start(async () => setState(itemId ? await walletStep(await run(), itemId) : await run()))}>
        {pending ? busy : label}
      </button>
      {state.error && <span className="small" role="alert" style={{ color: "var(--bad)", marginLeft: 8 }}>{state.error}</span>}
    </>
  );
}

export function ResellForm({ itemId, address, chain }: { itemId: string; address: string; chain: string }) {
  const walletStep = useWalletStep(address, chain);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, fd: FormData) => walletStep(await resell(itemId, prev, fd), itemId), {});
  return (
    <form action={action} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label>Your price in USDC<input name="price" required inputMode="decimal" placeholder="150" style={{ width: 120 }} /></label>
      <button className="btn small" type="submit" disabled={pending}>{pending ? "Check your wallet…" : "List for resale"}</button>
      <Result state={state} />
    </form>
  );
}

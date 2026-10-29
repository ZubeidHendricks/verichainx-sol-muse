"use client";

import { useActionState, useTransition, useState } from "react";

import { addItem, addShop, type ActionState } from "./actions";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="notice error" role="alert">{state.error}</p>;
  if (state.done) return <p className="status paid" role="status">{state.done}</p>;
  return null;
}

export function AddShopForm() {
  const [state, action, pending] = useActionState(addShop, {});
  return (
    <form action={action}>
      <label>Shop name<input name="name" required maxLength={80} placeholder="Lerato Bags" /></label>
      <label>Website domain (optional, verified by DNS)<input name="domain" maxLength={120} placeholder="leratobags.co.za" /></label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Adding…" : "Add shop"}</button>
      <Result state={state} />
    </form>
  );
}

export function AddItemForm({ merchantId }: { merchantId: string }) {
  const [state, action, pending] = useActionState(addItem.bind(null, merchantId), {});
  return (
    <form action={action}>
      <label>Title<input name="title" required maxLength={120} placeholder="Woven Market Tote" /></label>
      <label>Description<textarea name="description" rows={2} maxLength={600} /></label>
      <label>Price in USDC<input name="price" required inputMode="decimal" placeholder="129" /></label>
      <label>Photo URLs (https, space-separated, up to 4)<input name="photos" /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="list" defaultChecked /> List it for sale now</label>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Minting on devnet…" : "Register item"}</button>
      <Result state={state} />
    </form>
  );
}

/** A one-click action (list, delist, check domain) with its result shown inline. */
export function ActionButton({ run, label, busy }: { run: () => Promise<ActionState>; label: string; busy: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <>
      <button className="btn small ghost" type="button" disabled={pending} onClick={() => start(async () => setState(await run()))}>
        {pending ? busy : label}
      </button>
      {state.error && <span className="small" role="alert" style={{ color: "var(--bad)", marginLeft: 8 }}>{state.error}</span>}
    </>
  );
}

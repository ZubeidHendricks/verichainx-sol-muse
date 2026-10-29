"use client";

import type { Wallet } from "@wallet-standard/base";
import { getWallets } from "@wallet-standard/app";
import { useEffect, useState } from "react";

const LAST = "vcx-wallet";

/** Wallets installed in this browser that pass `filter`, kept current as extensions register. */
export function useWallets<T extends Wallet>(filter: (w: Wallet) => w is T): T[] {
  const [wallets, setWallets] = useState<T[]>([]);
  useEffect(() => {
    const api = getWallets();
    const update = () => setWallets(api.get().filter(filter));
    update();
    const offs = [api.on("register", update), api.on("unregister", update)];
    return () => offs.forEach((off) => off());
  }, [filter]);
  return wallets;
}

/** The wallet the shop signed in with, so later transactions go to the same one. Per-browser convenience only. */
export function rememberWallet(name: string) {
  try { localStorage.setItem(LAST, name); } catch { /* storage blocked: the first wallet found is used */ }
}

export function lastWallet<T extends Wallet>(wallets: T[]): T | undefined {
  let name: string | null = null;
  try { name = localStorage.getItem(LAST); } catch { /* storage blocked */ }
  return wallets.find((w) => w.name === name) ?? wallets[0];
}

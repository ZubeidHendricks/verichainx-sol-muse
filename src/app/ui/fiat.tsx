"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { Rates } from "@/server/fx";

const CURRENCIES = ["USD", "EUR", "GBP", "ZAR", "INR", "BRL", "NGN", "KES"];
const KEY = "vcx_currency";

// The chosen currency lives in this browser only; every <Fiat> on the page follows the picker.
const listeners = new Set<() => void>();
let fallback = "USD"; // when the browser blocks storage
const read = () => {
  try { return localStorage.getItem(KEY) ?? fallback; } catch { return fallback; }
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  window.addEventListener("storage", f);
  return () => { listeners.delete(f); window.removeEventListener("storage", f); };
};
const useCurrency = () => useSyncExternalStore(subscribe, read, () => "USD");

let pending: Promise<Rates | null> | null = null;
const loadRates = () => (pending ??= fetch("/api/fx").then((r) => (r.ok ? r.json() : null)).catch(() => null));

function useRates(currency: string) {
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    if (currency === "USD") return;
    let on = true;
    loadRates().then((r) => { if (on) setRates(r); });
    return () => { on = false; };
  }, [currency]);
  return rates;
}

const format = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);

/** A USDC amount in the viewer's chosen fiat currency, e.g. "≈ R95,000". */
export function Fiat({ usdc }: { usdc: string | number | null | undefined }) {
  const chosen = useCurrency();
  const rates = useRates(chosen);
  const n = Number(String(usdc ?? "").replace(/[^0-9.]/g, ""));
  if (usdc == null || usdc === "" || !Number.isFinite(n)) return null;
  const rate = chosen === "USD" ? 1 : rates?.rates[chosen];
  const [currency, r] = rate ? [chosen, rate] : ["USD", 1];
  const title = currency === "USD"
    ? "USDC is pegged 1:1 to the US dollar"
    : rates?.live ? `At the exchange rate of ${rates.asOf}` : "Approximate: the exchange rate service didn't answer";
  return <span className="fiat" title={title}>≈ {format(n * r, currency)}</span>;
}

/** Picks the fiat currency prices are shown in. */
export function CurrencyPicker() {
  const chosen = useCurrency();
  return (
    <label className="currency-pick">
      <select value={chosen} aria-label="Show prices in" onChange={(e) => {
        fallback = e.target.value;
        try { localStorage.setItem(KEY, e.target.value); } catch { /* storage blocked: this page only */ }
        listeners.forEach((f) => f());
      }}>
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

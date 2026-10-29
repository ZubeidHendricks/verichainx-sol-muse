"use client";

import { useState } from "react";

import type { ShopReply } from "@/server/views";

import { RunView } from "./run-view";

type Reply = ShopReply & { run_id?: string };

const EXAMPLES = ["An everyday tote under $200", "A leather wallet, max 120 USDC", "Something hand-woven"];

export function ShopChat() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(message: string) {
    if (!message.trim() || busy) return;
    setText(message);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/agent/shop", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? `The agent stopped (HTTP ${r.status}).`);
      setReply(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <label className="eyebrow" htmlFor="need">What are you looking for?</label>
        <div className="ask-row">
          <input id="need" value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
            placeholder="A woven tote for under $200" autoComplete="off" />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>
            {busy ? "Shopping…" : "Find offers"}
          </button>
        </div>
        <div className="chips">
          {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => ask(x)} disabled={busy}>{x}</button>)}
        </div>
      </form>

      <div aria-live="polite">
        {error && <p className="notice error" style={{ marginTop: 32 }}>{error}</p>}
        {busy && !reply && <p className="muted" style={{ marginTop: 32 }}>Asking shops and checking each offer on Solana…</p>}
        {reply && <RunView reply={reply} runId={reply.run_id} />}
      </div>
    </>
  );
}

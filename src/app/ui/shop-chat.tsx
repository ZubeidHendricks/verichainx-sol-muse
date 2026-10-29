"use client";

import { useState } from "react";

import type { ShopResult } from "@/server/agents/buyer";

import { Tag } from "./tag";

type Result = ShopResult["results"][number] & { local: boolean };
type Reply = Omit<ShopResult, "results"> & { results: Result[] };

const EXAMPLES = ["An everyday tote under $200", "A leather wallet, max 120 USDC", "Something hand-woven"];

const STEP: Record<string, string> = {
  discover_merchants: "Found shops",
  request_offers: "Asked for offers",
  verify_offer: "Checked an offer",
  present_recommendations: "Ranked the shortlist",
  model_error: "Model didn't answer",
};

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
      if (!r.ok) throw new Error(body.error ?? `The agent stopped (HTTP ${r.status}).`);
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
        {reply && <Results reply={reply} />}
      </div>
    </>
  );
}

function Results({ reply }: { reply: Reply }) {
  const scripted = reply.engine === "scripted";
  return (
    <section className="run">
      <div>
        <p className="answer">{reply.answer}</p>
        {scripted && (
          <p className="notice">No AI model answered, so the built-in rules picked the steps. The checks are the same.</p>
        )}
        {reply.results.length === 0 ? (
          <p className="muted">No shop had a match. Try a broader description or a higher budget.</p>
        ) : (
          <div className="tags">
            {reply.results.map((r, i) => (
              <Tag key={`${r.offer?.offer_id}-${i}`} index={i} title={r.offer?.title ?? "Unreadable offer"}
                shop={r.offer?.merchant_domain ?? r.offer?.merchant ?? r.from} price={r.offer?.price ?? "?"}
                verdict={r.final} reason={r.model_reason ?? r.reasons[0]} evidence={r.evidence}
                offerId={r.local ? r.offer?.offer_id : undefined} asset={r.offer?.asset} />
            ))}
          </div>
        )}
      </div>
      <aside className="log" aria-label="What the agent did">
        <h2 className="eyebrow">What the agent did</h2>
        <ol>
          {reply.trace.map((t, i) => {
            const byModel = t.by && t.by !== "code";
            return (
              <li key={i} className={byModel ? "model" : undefined}>
                {STEP[t.tool] ?? t.tool}
                <span className="who">{byModel ? t.by : "code"}</span>
              </li>
            );
          })}
        </ol>
        <p className="usage">
          Engine: {reply.engine}
          {reply.usage && <><br />{reply.usage.prompt_tokens + reply.usage.completion_tokens} tokens</>}
        </p>
        {reply.notes?.map((n) => <p key={n}>{n}</p>)}
      </aside>
    </section>
  );
}

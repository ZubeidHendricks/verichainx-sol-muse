"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "@/server/chat";

import { Thread } from "./thread";

const EXAMPLES = ["An everyday tote under $200", "A leather wallet, max 120 USDC", "Something hand-woven"];

/** The shopping conversation: the shops' agents pitch, the shopper's agent checks, the shopper decides. */
export function Chat({ welcome }: { welcome: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(welcome);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > welcome.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, welcome.length]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((ms) => [...ms, { kind: "shopper", text: message }]);
    try {
      const r = await fetch("/api/agent/shop", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversation_id: conversationId }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? `The agents stopped (HTTP ${r.status}).`);
      setConversationId(body.conversation_id);
      // The server's copy of the shopper's message replaces the optimistic one.
      setMessages((ms) => [...ms.slice(0, -1), ...(body.messages as ChatMessage[])]);
    } catch (e) {
      setMessages((ms) => ms.slice(0, -1));
      setText(message);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const started = messages.some((m) => m.kind === "shopper");
  return (
    <section className="chat" aria-label="Shopping conversation">
      <div aria-live="polite">
        <Thread messages={messages} />
        {busy && <p className="typing">Shop agents are answering, and your agent is checking them on Solana…</p>}
        <div ref={end} />
      </div>
      <form className="ask composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label className="eyebrow" htmlFor="need">{started ? "Reply to the shop agents" : "What are you looking for?"}</label>
        <div className="ask-row">
          <input id="need" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoComplete="off"
            placeholder={started ? "Ask about an item, or look for something else" : "A woven tote for under $200"} />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>{busy ? "Waiting…" : "Send"}</button>
        </div>
        {!started && (
          <div className="chips">
            {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => send(x)} disabled={busy}>{x}</button>)}
          </div>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
        {conversationId && <p className="small muted"><Link href={`/c/${conversationId}`}>Link to this conversation</Link></p>}
      </form>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { CardEvent, PolicyCheck } from "@/server/db/schema";
import type { Consensus, Vote } from "@/server/procure";
import type { Scorecard } from "@/server/stores/scorecard";

import { ScoreCard } from "../../ui/score";
import { approve, move, vote, type TeamState } from "../actions";

export type BoardCard = {
  id: string; column: "sourced" | "shortlist" | "approved" | "ordered" | "rejected"; kind: "maker" | "store";
  title: string; seller: string; image: string | null; productUrl: string | null; unitPrice: string; quantity: number;
  available: number | null; label: string; reasons: string[]; policy: PolicyCheck[]; total: string | null;
  scorecard: Scorecard | null; consensus: Consensus; orderId: string | null; tx: string | null; history: CardEvent[]; request: string;
};

type Col = "sourced" | "shortlist" | "ordered";
const COLUMNS: { key: Col; title: string; hint: string }[] = [
  { key: "sourced", title: "Sourced", hint: "Everything the agent found. Options that fail a policy rule stay here." },
  { key: "shortlist", title: "Shortlist", hint: "Passes the policy. Vote, then an approver pays." },
  { key: "ordered", title: "Ordered", hint: "Paid from the company wallet; the ownership NFT is the company's." },
];
const VOTES: { v: Vote; label: string }[] = [
  { v: "must_have", label: "Must have" }, { v: "nice_to_have", label: "Nice to have" }, { v: "skip", label: "Skip" },
];
const STAMP: Record<string, string> = { recommended: "Verified", caution: "Caution", avoid: "Avoid", excluded: "Unsigned" };

/** Re-reads the board every few seconds while the tab is visible, so teammates' votes show up. */
function useLive(ms = 8000) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
}

export function Kanban({ companyId, cards, approver }: { companyId: string; cards: BoardCard[]; approver: boolean }) {
  useLive();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Col | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const rejected = cards.filter((c) => c.column === "rejected");

  const drop = (to: Col) => {
    const card = cards.find((c) => c.id === dragging);
    setDragging(null);
    setOver(null);
    if (!card || card.column === to || to === "ordered") {
      if (to === "ordered" && card) setError("Ordering happens when an approver approves and pays.");
      return;
    }
    start(async () => {
      const r = await move(companyId, card.id, to);
      setError(r.error ?? null);
    });
  };

  if (!cards.length) {
    return <p className="muted">No options yet. Ask the procurement agent for what the company needs, and its findings land here.</p>;
  }
  return (
    <section aria-label="Board" className="stack">
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="kanban">
        {COLUMNS.map((col) => {
          const here = cards.filter((c) => (col.key === "ordered" ? c.column === "ordered" || c.column === "approved" : c.column === col.key));
          return (
            <div key={col.key} className={`lane${over === col.key ? " over" : ""}`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.key); } }}
              onDragLeave={() => setOver(null)} onDrop={() => drop(col.key)}>
              <h2 className="lane-head"><span>{col.title}</span><span className="count">{here.length}</span></h2>
              <p className="small muted lane-hint">{col.hint}</p>
              <ul>
                {here.map((c) => (
                  <li key={c.id} draggable={c.column === "sourced" || c.column === "shortlist"}
                    onDragStart={() => setDragging(c.id)} onDragEnd={() => { setDragging(null); setOver(null); }}>
                    <CardView companyId={companyId} card={c} approver={approver} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {rejected.length > 0 && (
        <details className="rejected">
          <summary className="small">Rejected ({rejected.length})</summary>
          <ul>{rejected.map((c) => <li key={c.id} className="small">{c.title} · {c.seller} · {c.unitPrice}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function CardView({ companyId, card: c, approver }: { companyId: string; card: BoardCard; approver: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<TeamState>({});
  const [confirming, setConfirming] = useState(false);
  const act = (fn: () => Promise<TeamState>) => start(async () => setState(await fn()));
  const failed = c.policy.filter((p) => !p.ok);
  const open = c.column === "sourced" || c.column === "shortlist";
  const k = c.consensus;

  return (
    <article className={`docket ${c.label}`} aria-busy={pending}>
      <div className="docket-top">
        {c.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image} alt="" className="thumb" />
        )}
        <div style={{ minWidth: 0 }}>
          <h3>{c.title}</h3>
          <p className="small muted">{c.seller}{c.kind === "store" ? " · Shopify store" : ""}</p>
        </div>
        <span className={`stamp ${c.label}`}>{STAMP[c.label] ?? c.label}</span>
      </div>
      <p className="sum">
        {c.quantity} × {c.unitPrice}{c.total && <> = <strong>{c.total} USDC</strong></>}
      </p>
      {c.reasons[0] && <p className="small reason">{c.reasons[0]}</p>}
      {c.column === "ordered" ? (
        <p className="small paid-note">Paid from the company wallet. The lot&apos;s ownership NFT, with the maker&apos;s origin record, is the company&apos;s.</p>
      ) : (
        <ul className="rules" aria-label="Policy">
          {c.policy.map((p) => <li key={p.rule} className={p.ok ? "ok" : "fail"} title={p.detail}><span>{p.ok ? "✓" : "✕"}</span> {p.rule}: {p.detail}</li>)}
        </ul>
      )}
      {c.scorecard && <ScoreCard card={c.scorecard} />}

      {open && (
        <div className="votes">
          <div className="meter" role="img" aria-label={`${k.support}% support from ${k.total} vote${k.total === 1 ? "" : "s"}`}>
            <span className="must" style={{ flexGrow: k.must }} />
            <span className="nice" style={{ flexGrow: k.nice }} />
            <span className="skip" style={{ flexGrow: k.skip }} />
            {k.total === 0 && <span className="none" style={{ flexGrow: 1 }} />}
          </div>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            {k.total ? `${k.support}% support · ${k.total} vote${k.total === 1 ? "" : "s"}` : "No votes yet"}
            {k.split && <strong className="split-flag"> · Team is split</strong>}
            {k.voters.length > 0 && <span title={k.voters.map((v) => `${v.name}: ${v.vote.replace(/_/g, " ")}`).join("\n")}> · who?</span>}
          </p>
          <div className="vote-row" role="group" aria-label="Your vote">
            {VOTES.map(({ v, label }) => (
              <button key={v} type="button" className={`chip${k.mine === v ? " on" : ""}`} aria-pressed={k.mine === v} disabled={pending}
                onClick={() => act(() => vote(companyId, c.id, k.mine === v ? "clear" : v))}>{label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="actions">
        {c.column === "sourced" && failed.length === 0 && (
          <button type="button" className="btn ghost small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "shortlist"))}>Shortlist →</button>
        )}
        {c.column === "shortlist" && (
          <button type="button" className="btn ghost small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "sourced"))}>← Back</button>
        )}
        {approver && open && (
          <button type="button" className="btn ghost small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "rejected"))}>Reject</button>
        )}
        {approver && c.column === "shortlist" && c.kind === "maker" && !confirming && (
          <button type="button" className="btn pay small" disabled={pending || failed.length > 0} onClick={() => setConfirming(true)}>Approve and pay</button>
        )}
        {confirming && (
          <>
            <button type="button" className="btn pay small" disabled={pending}
              onClick={() => { setConfirming(false); act(() => approve(companyId, c.id)); }}>
              {pending ? "Paying…" : `Pay ${c.total} USDC`}
            </button>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </>
        )}
        {c.kind === "store" && c.productUrl && <a className="btn ghost small" href={c.productUrl} target="_blank" rel="noreferrer">Store page</a>}
        {c.orderId && <Link className="btn ghost small" href={`/orders/${c.orderId}`}>Order</Link>}
        {c.tx && <a className="btn ghost small" href={c.tx} target="_blank" rel="noreferrer">Transaction</a>}
      </div>
      {pending && c.column === "shortlist" && <p className="typing small">Working</p>}
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      {state.done && <p className="status paid" role="status">{state.done}</p>}
      <details className="history small">
        <summary>History</summary>
        <ol>{c.history.map((h, i) => <li key={i}><span className="muted">{new Date(h.at).toLocaleString()}</span> · {h.who}: {h.what}</li>)}</ol>
        <p className="muted">For “{c.request}”</p>
      </details>
    </article>
  );
}

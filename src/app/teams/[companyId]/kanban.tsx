"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { CardEvent, PolicyCheck } from "@/server/db/schema";
import type { Consensus, Vote } from "@/server/procure";
import type { Scorecard } from "@/server/stores/scorecard";

import { Fiat } from "../../ui/fiat";
import { ScoreCard } from "../../ui/score";
import { approve, move, vote, type TeamState } from "../actions";

export type BoardCard = {
  id: string; column: "sourced" | "shortlist" | "approved" | "ordered" | "rejected"; kind: "maker" | "store";
  title: string; seller: string; image: string | null; productUrl: string | null; unitPrice: string; quantity: number;
  available: number | null; label: string; reasons: string[]; policy: PolicyCheck[]; total: string | null;
  scorecard: Scorecard | null; consensus: Consensus; orderId: string | null; tx: string | null; history: CardEvent[]; request: string;
};

type Col = "sourced" | "shortlist" | "ordered";
const COLUMNS: { key: Col; title: string; hint: string; empty: string }[] = [
  { key: "sourced", title: "Sourced", hint: "Passes the policy. Shortlist the ones worth a vote.", empty: "Nothing new that passes the policy." },
  { key: "shortlist", title: "Shortlist", hint: "The team votes; an approver pays.", empty: "Drag an option here, or press Shortlist on it." },
  { key: "ordered", title: "Ordered", hint: "Paid from the company wallet. The ownership NFT is the company's.", empty: "Nothing ordered yet." },
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

const fails = (c: BoardCard) => c.policy.filter((p) => !p.ok);

export function Kanban({ companyId, cards, approver }: { companyId: string; cards: BoardCard[]; approver: boolean }) {
  useLive();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Col | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const rejected = cards.filter((c) => c.column === "rejected");
  // Options that fail a rule can't be paid for, so they wait below the lanes instead of crowding them.
  const blocked = cards.filter((c) => c.column === "sourced" && fails(c).length > 0);

  const drop = (to: Col) => {
    const card = cards.find((c) => c.id === dragging);
    setDragging(null);
    setOver(null);
    if (!card || card.column === to) return;
    if (to === "ordered") { setError("Orders are placed when an approver presses Approve and pay."); return; }
    start(async () => {
      const r = await move(companyId, card.id, to);
      setError(r.error ?? null);
    });
  };

  if (!cards.length) {
    return (
      <section className="board-empty">
        <p>Nothing on the board yet.</p>
        <p className="small muted">Ask the procurement agent above. Every option it finds lands here, already checked against your policy.</p>
      </section>
    );
  }
  return (
    <section aria-label="Board" className="stack">
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="kanban">
        {COLUMNS.map((col) => {
          const here = cards.filter((c) => (col.key === "ordered" ? c.column === "ordered" || c.column === "approved"
            : c.column === col.key && !blocked.includes(c)));
          return (
            <div key={col.key} className={`lane ${col.key}${over === col.key ? " over" : ""}`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.key); } }}
              onDragLeave={() => setOver(null)} onDrop={() => drop(col.key)}>
              <h2 className="lane-head"><span>{col.title}</span><span className="count">{here.length}</span></h2>
              <p className="lane-hint">{col.hint}</p>
              {here.length === 0 ? <p className="lane-empty">{col.empty}</p> : (
                <ul>
                  {here.map((c) => (
                    <li key={c.id} draggable={c.column === "sourced" || c.column === "shortlist"}
                      onDragStart={() => setDragging(c.id)} onDragEnd={() => { setDragging(null); setOver(null); }}>
                      <CardView companyId={companyId} card={c} approver={approver} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {blocked.length > 0 && (
        <details className="blocked">
          <summary><strong>{blocked.length} {blocked.length === 1 ? "option doesn't" : "options don't"} pass the policy</strong>
            <span className="muted"> · the agent found them, but the company wallet can&apos;t pay for them</span></summary>
          <ul>
            {blocked.map((c) => (
              <li key={c.id}>
                {c.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt="" className="thumb" />
                )}
                <div>
                  <p className="b-title">{c.title} <span className="muted">· {c.seller}</span></p>
                  <p className="b-why">{fails(c).map((p) => p.detail).join(" ")}</p>
                </div>
                <span className="b-price">{c.quantity} × {c.unitPrice}</span>
                {c.kind === "store" && c.productUrl && <a className="btn ghost small" href={c.productUrl} target="_blank" rel="noreferrer">Store page</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {rejected.length > 0 && (
        <details className="blocked">
          <summary><strong>Rejected ({rejected.length})</strong></summary>
          <ul>{rejected.map((c) => <li key={c.id}><div><p className="b-title">{c.title} <span className="muted">· {c.seller} · {c.unitPrice}</span></p></div></li>)}</ul>
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
  const failed = fails(c);
  const open = c.column === "sourced" || c.column === "shortlist";
  const ordered = c.column === "ordered" || c.column === "approved";
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
          <p className="seller">{c.seller}{c.scorecard && <> · <span className="score-n">{c.scorecard.overall}</span>/100</>}</p>
        </div>
        <span className={`stamp ${c.label}`}>{STAMP[c.label] ?? c.label}</span>
      </div>

      <div className="sum">
        <span className="qty">{c.quantity} × {c.unitPrice}</span>
        {c.total && <span className="total">{c.total} <small>USDC</small><Fiat usdc={c.total} /></span>}
      </div>

      {ordered
        ? <p className="paid-note">Paid from the company wallet. The ownership NFT, with the maker&apos;s origin record, is the company&apos;s.</p>
        : c.reasons[0] && <p className="reason">{c.reasons[0]}</p>}

      {!ordered && (
        <p className={`policy-line ${failed.length ? "fail" : "ok"}`}>
          {failed.length ? `Fails ${failed.map((p) => p.rule.toLowerCase()).join(", ")}` : "Passes the company policy"}
        </p>
      )}

      {open && (
        <div className="votes">
          <div className="vote-head">
            <div className="meter" role="img" aria-label={`${k.support}% support from ${k.total} vote${k.total === 1 ? "" : "s"}`}>
              <span className="must" style={{ flexGrow: k.must }} />
              <span className="nice" style={{ flexGrow: k.nice }} />
              <span className="skip" style={{ flexGrow: k.skip }} />
              {k.total === 0 && <span className="none" style={{ flexGrow: 1 }} />}
            </div>
            <span className="small muted" title={k.voters.map((v) => `${v.name}: ${v.vote.replace(/_/g, " ")}`).join("\n") || undefined}>
              {k.total ? `${k.support}% · ${k.total} vote${k.total === 1 ? "" : "s"}` : "No votes"}
            </span>
          </div>
          {k.split && <p className="split-flag">The team is split on this one.</p>}
          <div className="vote-row" role="group" aria-label="Your vote">
            {VOTES.map(({ v, label }) => (
              <button key={v} type="button" className={`chip ${v}${k.mine === v ? " on" : ""}`} aria-pressed={k.mine === v} disabled={pending}
                onClick={() => act(() => vote(companyId, c.id, k.mine === v ? "clear" : v))}>{label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="actions">
        {approver && c.column === "shortlist" && c.kind === "maker" && !confirming && (
          <button type="button" className="btn pay small" disabled={pending || failed.length > 0} onClick={() => setConfirming(true)}>Approve and pay</button>
        )}
        {confirming && (
          <>
            <button type="button" className="btn pay small" disabled={pending}
              onClick={() => { setConfirming(false); act(() => approve(companyId, c.id)); }}>
              Pay {c.total} USDC
            </button>
            <button type="button" className="btn ghost small" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </>
        )}
        {c.column === "sourced" && failed.length === 0 && (
          <button type="button" className="btn small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "shortlist"))}>Shortlist</button>
        )}
        {c.column === "shortlist" && !confirming && (
          <button type="button" className="btn ghost small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "sourced"))}>Back</button>
        )}
        {approver && open && !confirming && (
          <button type="button" className="btn text small" disabled={pending} onClick={() => act(() => move(companyId, c.id, "rejected"))}>Reject</button>
        )}
        {c.orderId && <Link className="btn ghost small" href={`/orders/${c.orderId}`}>Order</Link>}
        {c.tx && <a className="btn ghost small" href={c.tx} target="_blank" rel="noreferrer">Transaction</a>}
      </div>
      {pending && <p className="typing small">{c.column === "shortlist" ? "Working" : "Saving"}</p>}
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      {state.done && <p className="status paid" role="status">{state.done}</p>}

      <details className="more">
        <summary>Checks and history</summary>
        <ul className="rules" aria-label="Policy">
          {c.policy.map((p) => <li key={p.rule} className={p.ok ? "ok" : "fail"}><span>{p.ok ? "✓" : "✕"}</span> {p.rule}: {p.detail}</li>)}
        </ul>
        {c.scorecard && <ScoreCard card={c.scorecard} />}
        <ol className="history">{c.history.map((h, i) => <li key={i}><span className="muted">{new Date(h.at).toLocaleString()}</span> · {h.who}: {h.what}</li>)}</ol>
        <p className="muted">For “{c.request}”</p>
      </details>
    </article>
  );
}

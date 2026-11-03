import Link from "next/link";

import type { ShopReply } from "@/server/views";

import { Tag } from "./tag";
import { engineLabel } from "@/lib/engine";

const STEP: Record<string, string> = {
  discover_merchants: "Found shops",
  request_offers: "Asked for offers",
  verify_offer: "Checked an offer",
  present_recommendations: "Ranked the shortlist",
  model_error: "Model didn't answer",
};

/** One shopping-agent run: the answer, the offers as tags, and the steps it took. Live and saved runs share it. */
export function RunView({ reply, runId }: { reply: ShopReply; runId?: string }) {
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
                offerId={r.local ? r.offer?.offer_id : undefined} asset={r.offer?.asset} image={r.offer?.image} />
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
          Engine: {engineLabel(reply.engine)}
          {reply.usage && <><br />{reply.usage.prompt_tokens + reply.usage.completion_tokens} tokens</>}
        </p>
        {reply.notes?.map((n) => <p key={n}>{n}</p>)}
        {runId && <p><Link href={`/runs/${runId}`}>Link to this run</Link></p>}
      </aside>
    </section>
  );
}

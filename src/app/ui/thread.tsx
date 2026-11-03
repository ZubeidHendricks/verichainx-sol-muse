import Link from "next/link";

import type { ChatMessage } from "@/server/chat";
import { formatPrice } from "@/server/stores/catalog";

import { Tag } from "./tag";
import { engineLabel } from "@/lib/engine";

const STEP: Record<string, string> = {
  discover_merchants: "Sent your request to the shop agents",
  request_offers: "Collected their pitches",
  verify_offer: "Checked an offer on Solana",
  present_recommendations: "Ranked them for you",
  model_error: "A model didn't answer",
};

/**
 * The conversation: shops' sales agents on the left, the shopper on the right, and the shopper's own agent as
 * notes pinned between them. A rep's offers hang under its pitch as swing tags, stamped by the shopper's agent.
 */
export function Thread({ messages }: { messages: ChatMessage[] }) {
  return (
    <ol className="thread">
      {messages.map((m, i) => <li key={i} className={`msg ${m.kind}`}><Message m={m} index={i} /></li>)}
    </ol>
  );
}

function Message({ m, index }: { m: ChatMessage; index: number }) {
  if (m.kind === "shopper") return <p className="bubble">{m.text}</p>;
  if (m.kind === "stores") {
    return (
      <>
        <p className="who">Also in Shopify stores <span className="seal na">found and checked by your agent</span></p>
        <div className="tags">
          {m.results.map((r, j) => (
            <Tag key={r.product.id} index={index + j} title={r.product.title} shop={r.product.store.public_domain}
              price={formatPrice(r.product.price_minor, r.product.currency)} currency=""
              verdict={r.recommendation} reason={r.reasons.join("; ")} reasonLabel="Store check" evidence={r.evidence}
              image={r.product.photo ?? undefined} scorecard={r.scorecard} storeUrl={r.product.url ?? r.product.checkout_url} />
          ))}
        </div>
      </>
    );
  }
  if (m.kind === "rep") {
    return (
      <>
        <p className="who">
          <span className="shop">{m.shop}</span> · sales agent
          <span className={`seal ${m.verified ? "ok" : m.known ? "na" : "bad"}`}>
            {m.verified ? "verified shop" : m.known ? "shop not verified yet" : "unknown seller"}
          </span>
        </p>
        <p className="bubble">{m.text}</p>
        {m.note && <p className="aside"><strong>Your agent: </strong>{m.note}</p>}
        {m.offers.length > 0 && (
          <div className="tags">
            {m.offers.map((r, j) => (
              <Tag key={`${r.offer?.offer_id}-${j}`} index={index + j} title={r.offer?.title ?? "Unreadable offer"}
                shop={r.offer?.merchant_domain ?? r.offer?.merchant ?? r.from} price={r.offer?.price ?? "?"}
                verdict={r.final} reason={r.model_reason ?? r.reasons[0]} reasonLabel="Your agent" evidence={r.evidence}
                offerId={r.local ? r.offer?.offer_id : undefined} asset={r.offer?.asset} image={r.offer?.image}
                scorecard={r.scorecard} />
            ))}
          </div>
        )}
      </>
    );
  }
  const scripted = m.engine === "scripted";
  return (
    <div className="note">
      <p className="who">Your agent{m.engine && <span className="engine">{engineLabel(m.engine)}</span>}</p>
      <p>{m.text}</p>
      {scripted && <p className="small muted">No AI model answered, so built-in rules ran the steps. The checks are the same.</p>}
      {m.notes?.map((n) => <p key={n} className="small muted">{n}</p>)}
      {m.trace && (
        <details className="log">
          <summary>What I checked{m.usage && ` · ${m.usage.prompt_tokens + m.usage.completion_tokens} tokens`}</summary>
          <ol>
            {m.trace.map((t, i) => {
              const byModel = t.by && t.by !== "code";
              return <li key={i} className={byModel ? "model" : undefined}>{STEP[t.tool] ?? t.tool}<span className="who">{byModel ? t.by : "code"}</span></li>;
            })}
          </ol>
          {m.runId && <p><Link href={`/runs/${m.runId}`}>This step on its own page</Link></p>}
        </details>
      )}
    </div>
  );
}

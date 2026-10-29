import Link from "next/link";

import type { Evidence, Recommendation } from "@/server/agents/verify";

/** Plain-language verdicts, shared by the shop results and the offer page. */
export const VERDICT: Record<Recommendation, string> = {
  recommended: "Verified",
  caution: "Caution",
  avoid: "Avoid",
  excluded: "Unsigned",
};

export function Marks({ evidence }: { evidence: Evidence[] }) {
  return (
    <ul className="marks" aria-label="Checks">
      {evidence.map((e) => (
        <li key={e.id} className={`mark ${e.ok === true ? "ok" : e.ok === false ? "fail" : "na"}`} title={`${e.check}: ${e.detail}`}>
          {e.id} {e.check}
        </li>
      ))}
    </ul>
  );
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <ul className="evidence">
      {evidence.map((e) => (
        <li key={e.id}>
          <span className={`mark ${e.ok === true ? "ok" : e.ok === false ? "fail" : "na"}`}>{e.id}</span>
          <span className="check">{e.check}</span>
          <span>{e.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export type TagProps = {
  index: number;
  title: string;
  shop: string;
  price: string;
  verdict: Recommendation;
  reason?: string;
  /** Who wrote the reason, shown before it. */
  reasonLabel?: string;
  evidence: Evidence[];
  offerId?: string;
  asset?: string;
  image?: string;
};

/** One offer as a swing tag: the verdict stamped on, the checks as hallmarks along the bottom. */
export function Tag(p: TagProps) {
  return (
    <article className="tag-wrap">
      <div className="tag" style={{ "--i": p.index } as React.CSSProperties}>
        <span className={`stamp ${p.verdict}`}>{VERDICT[p.verdict]}</span>
        <h3>{p.title}</h3>
        <p className="shop">{p.shop}</p>
        <div className="price-row">
          <p className="price">{p.price}<small>USDC</small></p>
          {p.image && /^https?:\/\//.test(p.image) && (
            // eslint-disable-next-line @next/next/no-img-element -- shop photos can be on any host
            <img className="thumb" src={p.image} alt="" width={64} height={64} loading="lazy" />
          )}
        </div>
        {p.reason && <p className="reason">{p.reasonLabel && <strong>{p.reasonLabel}: </strong>}{p.reason}</p>}
        <Marks evidence={p.evidence} />
        <div className="actions">
          {p.offerId && p.verdict !== "excluded" && (
            <Link className={`btn small ${p.verdict === "recommended" ? "pay" : "ghost"}`} href={`/o/${p.offerId}`}>
              {p.verdict === "avoid" ? "See why" : "View and pay"}
            </Link>
          )}
          {p.asset && <Link className="btn small ghost" href={`/i/${p.asset}`}>Check the NFT</Link>}
        </div>
      </div>
    </article>
  );
}

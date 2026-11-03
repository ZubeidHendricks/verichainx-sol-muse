import type { Metadata } from "next";

import { StartCompanyForm } from "./forms";

export const metadata: Metadata = { title: "Teams" };

export default function Page() {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For companies</p>
        <h1 className="display" style={{ fontSize: "clamp(30px, 5vw, 54px)", margin: "8px 0 12px" }}>A procurement agent your team can overrule</h1>
        <p>
          Tell the agent what the company needs and how many. It sources from makers here and from Shopify stores, checks
          every offer against Solana, and tests each against your spending policy. Your team votes on a shared board, and
          only an approver can pay. Paying moves the money and the order&apos;s ownership NFT in one transaction, so the
          company holds proof of what it bought and from whom.
        </p>
      </section>
      <div className="split">
        <section className="panel stack">
          <h2 className="eyebrow">Start a company board</h2>
          <StartCompanyForm />
        </section>
        <section className="stack small muted">
          <h2 className="eyebrow">How it works</h2>
          <ol className="steps">
            <li><strong>Ask.</strong> &ldquo;40 woven tote bags for our conference, 6,000 USDC.&rdquo; The agent runs on Muse Spark.</li>
            <li><strong>Check.</strong> Each offer gets the shopper checks (seller, NFT holder, origin record, photos, price) plus your policy: verified sellers only, stock for the quantity, the per-order and monthly limits.</li>
            <li><strong>Vote.</strong> Options that pass land on the shortlist. Teammates mark them must-have, nice-to-have or skip.</li>
            <li><strong>Approve.</strong> An approver pays from the company wallet. Code checks the policy again first, whatever the votes say.</li>
          </ol>
          <p>Devnet only: the company wallet is held by the service and starts with 10,000 test USDC.</p>
        </section>
      </div>
    </div>
  );
}

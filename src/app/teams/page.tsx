import type { Metadata } from "next";

import { StartCompanyForm } from "./forms";

export const metadata: Metadata = { title: "Teams" };

export default function Page() {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For companies</p>
        <h1 className="display sub">A procurement agent your team can overrule</h1>
        <p>
          Tell the agent what the company needs and how many. It sources from makers and Shopify stores, checks every offer
          against Solana and your spending policy, and puts the options on a board your team votes on. Only an approver can
          pay, and the company gets the order&apos;s ownership NFT as proof of what it bought and from whom.
        </p>
      </section>
      <ol className="flow" aria-label="How it works">
        <li><span>Ask</span>&ldquo;40 woven tote bags for our conference, 6,000 USDC.&rdquo; The agent runs on Muse Spark.</li>
        <li><span>Check</span>Seller, NFT holder, origin record, photos and price, plus your policy: verified sellers, stock, per-order and monthly limits.</li>
        <li><span>Vote</span>Options that pass go on the board. Teammates mark them must have, nice to have or skip.</li>
        <li><span>Approve</span>An approver pays from the company wallet. Code checks the policy again first, whatever the votes say.</li>
      </ol>
      <section className="panel stack start-board">
        <h2 className="eyebrow">Start a company board</h2>
        <StartCompanyForm />
        <p className="small muted" style={{ margin: 0 }}>Devnet only: the company wallet is held by the service and starts with 10,000 test USDC.</p>
      </section>
    </div>
  );
}

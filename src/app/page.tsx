import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { greeting } from "@/server/chat";

import { Chat } from "./ui/chat";

export default function Home() {
  return (
    <>
      <div className="home-top">
        <section className="hero">
          <p className="eyebrow">Agent-to-agent shopping · Muse Spark · Solana</p>
          <h1 className="display">Shops&apos; agents sell. Yours checks.</h1>
          <p>
            Every shop here has a sales agent that pitches to you. Your agent, on Meta&apos;s Muse Spark, works only for you
            and checks each pitch on Solana before you pay. Payment and the item&apos;s ownership NFT change hands in one
            transaction.
          </p>
          <ul className="marks hero-marks" aria-label="What your agent checks">
            <li className="mark ok">seller</li>
            <li className="mark ok">NFT holder</li>
            <li className="mark ok">origin record</li>
            <li className="mark ok">photos</li>
            <li className="mark ok">price</li>
          </ul>
        </section>
        <Link href="/teams" className="company-card">
          <p className="eyebrow">Buying for a company?</p>
          <p className="cc-title">Give your team a procurement agent</p>
          <div className="mini-board" aria-hidden>
            <span><i /><i /><i /></span>
            <span><i className="pick" /></span>
            <span><i className="done" /></span>
          </div>
          <p className="small">Bulk orders, a spending policy checked in code, team votes, and an approver who pays.</p>
          <span className="cc-go">Start a company board →</span>
        </Link>
      </div>
      <Suspense fallback={<p className="muted">Calling the shop agents…</p>}>
        <Welcome />
      </Suspense>
    </>
  );
}

async function Welcome() {
  await connection(); // the greeting depends on which shops are listed now
  return <Chat welcome={await greeting(await getApp())} />;
}

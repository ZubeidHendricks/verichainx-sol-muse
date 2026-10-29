import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { greeting } from "@/server/chat";

import { Chat } from "./ui/chat";

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Agent-to-agent shopping · Solana</p>
        <h1 className="display">Shops&apos; agents sell. Yours checks.</h1>
        <p>
          Every shop here has a sales agent that will pitch to you. Your own agent works only for you: it checks each
          pitch on Solana (who really holds the item&apos;s ownership NFT, where it was made, the seller) before you pay.
          Payment and the NFT change hands in one transaction.
        </p>
      </section>
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

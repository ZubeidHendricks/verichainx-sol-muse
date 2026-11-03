import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Fiat } from "@/app/ui/fiat";
import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { orderPage } from "@/server/views";

export const metadata: Metadata = { title: "Order" };

export default function Page({ params }: { params: Promise<{ orderId: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Looking up the order on Solana…</p>}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Promise<{ orderId: string }> }) {
  await connection(); // offers, holders and orders change on-chain; always render per request
  const { orderId } = await params;
  const v = await orderPage(await getApp(), orderId).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  const paid = v.order.status === "paid";
  return (
    <section className="stack" style={{ maxWidth: 720 }}>
      <div>
        <p className="eyebrow">Order {v.order.id}</p>
        <h1 className="display title">{paid ? "Paid" : "Waiting for payment"}</h1>
        <p style={{ fontSize: 18 }}>
          {v.item.title} from {v.merchant.domain ?? v.merchant.name}, {v.price} USDC <Fiat usdc={v.price} />.
          {paid ? " The ownership NFT is in the buyer's wallet." : " Refresh this page after the wallet signs."}
        </p>
      </div>
      <dl className="facts">
        <dt>Buyer</dt><dd className="mono">{v.order.buyer}</dd>
        {v.order.tx && <><dt>Transaction</dt><dd><a href={v.order.tx}>View on Solana Explorer</a></dd></>}
        {v.item.asset && <><dt>NFT</dt><dd><Link href={`/i/${v.item.asset}`}>Check the ownership NFT</Link></dd></>}
      </dl>
      <ol className="small muted">
        {v.order.events.map((e, i) => <li key={i}>{e.status} · {new Date(e.at).toUTCString()}</li>)}
      </ol>
    </section>
  );
}

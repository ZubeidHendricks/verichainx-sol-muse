import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { assetReport } from "@/server/views";

export const metadata: Metadata = { title: "Ownership NFT" };

export default function Page({ params }: { params: Promise<{ asset: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Reading the NFT from Solana…</p>}>
      <Asset params={params} />
    </Suspense>
  );
}

async function Asset({ params }: { params: Promise<{ asset: string }> }) {
  await connection(); // offers, holders and orders change on-chain; always render per request
  const { asset } = await params;
  const app = await getApp();
  const r = await assetReport(app, asset).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  const holder = r.owner_merchant
    ? `${r.owner_merchant.domain ?? r.owner_merchant.name}${r.owner_merchant.verified ? " (verified shop)" : " (shop not verified yet)"}`
    : "a wallet that isn't a shop here";
  const record = r.origin?.record as Record<string, unknown> | null | undefined;

  return (
    <div className="split">
      <section className="stack">
        <div>
          <p className="eyebrow">Ownership NFT · Metaplex Core</p>
          <h1 className="title">{r.item?.title ?? r.name}</h1>
          <p style={{ fontSize: 18, maxWidth: "58ch" }}>
            Held by {holder}. {r.listed ? "It is listed for sale through VeriChainX." : "It is not listed for sale."}
          </p>
        </div>
        <dl className="facts">
          <dt>NFT</dt><dd><a className="mono" href={r.links.asset}>{r.asset}</a></dd>
          <dt>Holder</dt><dd className="mono">{r.owner}</dd>
          {r.item && <><dt>Status</dt><dd><span className={`pill ${r.item.status}`}>{r.item.status}</span></dd></>}
        </dl>
      </section>

      <aside className="panel">
        <h2 className="eyebrow">Origin record</h2>
        {!r.origin ? (
          <p>This NFT has no origin record, so there&apos;s nothing to check it against.</p>
        ) : (
          <div className="stack">
            <p className={r.origin.recomputes ? "status paid" : "status"} style={{ marginTop: 0 }}>
              {r.origin.recomputes
                ? "The record's hash matches the hash stored on the NFT."
                : "The record we hold doesn't match the hash on the NFT."}
            </p>
            <dl className="facts">
              {record && Object.entries(record).filter(([k, v]) => !["v", "merchant"].includes(k) && (typeof v === "string" || typeof v === "number")).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}><dt>{k.replaceAll("_", " ")}</dt><dd>{String(v)}</dd></div>
              ))}
              <dt>hash</dt><dd className="mono">{r.origin.registration_hash}</dd>
            </dl>
            {r.links.origin_tx && <p className="small"><a href={r.links.origin_tx}>Registration transaction</a></p>}
          </div>
        )}
      </aside>
    </div>
  );
}

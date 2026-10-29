import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { getApp } from "@/server/app";
import { domainProof } from "@/server/catalog";
import { merchantBoard } from "@/server/views";

import { checkDomain, delist, list } from "./actions";
import { ActionButton, AddItemForm, AddShopForm } from "./forms";

export const metadata: Metadata = { title: "Sell" };

export default function Page() {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For shops</p>
        <h1 className="display" style={{ fontSize: "clamp(30px, 5vw, 54px)", margin: "8px 0 12px" }}>Register what you make</h1>
        <p>
          Each item gets an ownership NFT with its origin record. While you hold it and it&apos;s listed, only your shop can
          sell it: an offer for it from anyone else is flagged to shoppers.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Loading shops…</p>}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  await connection(); // shops change at runtime; never prerender them
  const shops = await merchantBoard(await getApp());
  const demo = process.env.MERCHANT_DEMO === "1";
  return (
    <>
      {!demo && (
        <p className="notice">Selling is switched off on this server. Shop sign-in with a Solana wallet is coming; until then
          set MERCHANT_DEMO=1 to try it on devnet.</p>
      )}
      <div className="split">
        <div className="stack">
          {shops.length === 0 && <p className="muted">No shops yet. Add the first one.</p>}
          {shops.map((m) => (
            <section key={m.id} className="panel stack">
              <div>
                <h2 className="display" style={{ fontSize: 24, margin: 0 }}>{m.name}</h2>
                <p className="small muted" style={{ margin: "4px 0 0" }}>
                  {m.domain ? <>{m.domain} · {m.verified ? "verified" : "not verified yet"}</> : "no domain"} ·{" "}
                  <a href={m.walletLink}>wallet</a>
                </p>
              </div>
              {m.domain && !m.verified && (
                <div className="small">
                  <p style={{ margin: "0 0 6px" }}>To verify {m.domain}, add this DNS TXT record, then check it:</p>
                  <p className="mono" style={{ margin: "0 0 8px" }}>{domainProof(m).name} → {domainProof(m).value}</p>
                  <ActionButton run={checkDomain.bind(null, m.id)} label="Check DNS" busy="Checking…" />
                </div>
              )}
              {m.items.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Item</th><th>Price</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {m.items.map((i) => (
                        <tr key={i.id}>
                          <td>{i.asset ? <Link href={`/i/${i.asset}`}>{i.title}</Link> : i.title}</td>
                          <td className="mono">{i.price}</td>
                          <td><span className={`pill ${i.status}`}>{i.status}</span></td>
                          <td>
                            {(i.status === "draft" || i.status === "delisted") && <ActionButton run={list.bind(null, i.id)} label="List" busy="Listing…" />}
                            {i.status === "listed" && <ActionButton run={delist.bind(null, i.id)} label="Delist" busy="Delisting…" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>Register an item</summary>
                <div style={{ marginTop: 12 }}><AddItemForm merchantId={m.id} /></div>
              </details>
            </section>
          ))}
        </div>
        <aside className="panel">
          <h2 className="eyebrow">Add a shop</h2>
          <AddShopForm />
          <p className="small muted">On devnet the service keeps a wallet for your shop. Bringing your own wallet comes with sign-in.</p>
        </aside>
      </div>
    </>
  );
}

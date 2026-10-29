import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { walletChain } from "@/lib/wallet";
import { getApp } from "@/server/app";
import { SESSION_COOKIE, sessionAddress } from "@/server/auth";
import { domainProof } from "@/server/catalog";
import { merchantBoard } from "@/server/views";

import { checkDomain, setListing } from "./actions";
import { ActionButton, AddItemForm, AddShopForm, ResellForm } from "./forms";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sell" };

export default function Page() {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For shops</p>
        <h1 className="display" style={{ fontSize: "clamp(30px, 5vw, 54px)", margin: "8px 0 12px" }}>Register what you make</h1>
        <p>
          Each item gets an ownership NFT with its origin record, in your wallet. While you hold it and it&apos;s listed,
          only you can sell it: an offer for it from anyone else is flagged to shoppers. Bought something here? You can
          resell it the same way.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Loading your shops…</p>}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  await connection(); // shops and sessions change per request; never prerender them
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const app = await getApp();
  const address = sessionAddress(app, sessionCookie);
  const { shops, held } = await merchantBoard(app, address);
  const demo = process.env.MERCHANT_DEMO === "1";
  const chain = walletChain(app.config.cluster);

  return (
    <>
      <SignIn address={address} />
      {held.length > 0 && address && (
        <section className="panel stack">
          <h2 className="eyebrow">Items in your wallet</h2>
          {held.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}><Link href={`/i/${i.asset}`}>{i.title}</Link> <span className="small muted">· bought for {i.paid} USDC</span></p>
              <ResellForm itemId={i.id} address={address} chain={chain} />
            </div>
          ))}
        </section>
      )}
      <div className="split">
        <div className="stack">
          {shops.length === 0 && (
            <p className="muted">{address ? "You don't have a shop yet. Add one to register items." : "Sign in to see your shops."}</p>
          )}
          {shops.map((m) => (
            <section key={m.id} className="panel stack">
              <div>
                <h2 className="display" style={{ fontSize: 24, margin: 0 }}>{m.name}</h2>
                <p className="small muted" style={{ margin: "4px 0 0" }}>
                  {m.domain ? <>{m.domain} · {m.verified ? "verified" : "not verified yet"}</> : "no domain"} ·{" "}
                  {m.custody === "vault" ? "service-held wallet (demo)" : "your wallet"} · <a href={m.walletLink}>explorer</a>
                </p>
              </div>
              {m.domain && !m.verified && (
                <div className="small">
                  <p style={{ margin: "0 0 6px" }}>To verify {m.domain}, add this DNS TXT record, then check it:</p>
                  <p className="mono" style={{ margin: "0 0 8px" }}>{domainProof(m).name} → {domainProof(m).value}</p>
                  <ActionButton run={checkDomain.bind(null, m.id)} label="Check DNS" busy="Checking…" address={address} chain={chain} />
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
                            {(i.status === "draft" || i.status === "delisted") && (
                              <ActionButton run={setListing.bind(null, i.id, "list")} label="List" busy="Listing…" itemId={i.id} address={address} chain={chain} />
                            )}
                            {i.status === "listed" && (
                              <ActionButton run={setListing.bind(null, i.id, "delist")} label="Delist" busy="Delisting…" itemId={i.id} address={address} chain={chain} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>Register an item</summary>
                <div style={{ marginTop: 12 }}><AddItemForm merchantId={m.id} vault={m.custody === "vault"} /></div>
              </details>
            </section>
          ))}
        </div>
        {address && (
          <aside className="panel">
            <h2 className="eyebrow">Add a shop</h2>
            <AddShopForm demo={demo} />
          </aside>
        )}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Fiat } from "@/app/ui/fiat";
import { walletChain } from "@/lib/wallet";
import { getApp } from "@/server/app";
import { SESSION_COOKIE, sessionAddress } from "@/server/auth";
import { domainProof } from "@/server/catalog";
import { shopifyConfig } from "@/server/shopify";
import { merchantBoard } from "@/server/views";

import { checkDomain, importShopify, markOrder, setListing } from "./actions";
import { ActionButton, AddItemForm, AddShopForm, ResellForm } from "./forms";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: "Sell" };

type Search = { shopify?: string; imported?: string; reason?: string };

export default function Page({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <div className="board stack">
      <section className="hero">
        <p className="eyebrow">For shops</p>
        <h1 className="display sub">Register what you make</h1>
        <p>
          Each item gets an ownership NFT with its origin record, in your wallet. While you hold it and it&apos;s listed,
          only you can sell it: an offer for it from anyone else is flagged to shoppers. Bought something here? You can
          resell it the same way.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Loading your shops…</p>}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ searchParams }: { searchParams: Promise<Search> }) {
  await connection(); // shops and sessions change per request; never prerender them
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const q = await searchParams;
  const app = await getApp();
  const address = sessionAddress(app, sessionCookie);
  const { shops, held } = await merchantBoard(app, address);
  const demo = process.env.MERCHANT_DEMO === "1";
  const chain = walletChain(app.config.cluster);
  const shopify = Boolean(shopifyConfig());

  return (
    <>
      <SignIn address={address} />
      {q.shopify === "connected" && (
        <p className="notice" role="status">Your Shopify store is connected. {q.imported ?? 0} products registered.</p>
      )}
      {q.shopify === "failed" && <p className="notice error" role="alert">Shopify didn&apos;t connect: {q.reason}</p>}
      {q.shopify === "sign-in" && <p className="notice" role="status">Sign in with your wallet first, then connect your store.</p>}
      {held.length > 0 && address && (
        <section className="panel stack">
          <h2 className="eyebrow">Items in your wallet</h2>
          {held.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 8 }}>
              <p style={{ margin: 0 }}><Link href={`/i/${i.asset}`}>{i.title}</Link> <span className="small muted">· bought for {i.paid} USDC <Fiat usdc={i.paid} /></span></p>
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
              {m.orders.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Order</th><th>Item</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {m.orders.map((o) => (
                        <tr key={o.id}>
                          <td><Link className="mono" href={`/orders/${o.id}`}>{o.id}</Link></td>
                          <td>{o.title} <span className="small muted">· {o.price} USDC <Fiat usdc={o.price} /></span></td>
                          <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                          <td>
                            {o.status === "paid" && (
                              <ActionButton run={markOrder.bind(null, o.id, "shipped")} label="Mark shipped" busy="Anchoring…" address={address} chain={chain} />
                            )}
                            {o.status === "shipped" && (
                              <ActionButton run={markOrder.bind(null, o.id, "delivered")} label="Mark delivered" busy="Anchoring…" address={address} chain={chain} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {m.shopify && (
                <div className="small stack" style={{ gap: 8 }}>
                  <p style={{ margin: 0 }}>
                    Shopify: {m.shopify} ·{" "}
                    <ActionButton run={importShopify.bind(null, m.id)} label="Register new products" busy="Registering…" address={address} chain={chain} />
                  </p>
                  {m.claims.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>When an order of a registered product is paid, its claim link shows up here.</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Order</th><th>Item</th><th>Claim link for the buyer</th></tr></thead>
                        <tbody>
                          {m.claims.map((c) => (
                            <tr key={c.id}>
                              <td>{c.orderName}</td>
                              <td>{c.title}</td>
                              <td>{c.claimed ? <span className="pill sold">claimed</span> : <a className="mono" href={c.url}>{c.url}</a>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
          <aside className="panel stack">
            <div>
              <h2 className="eyebrow">Add a shop</h2>
              <AddShopForm demo={demo} />
            </div>
            {shopify && (
              <div>
                <h2 className="eyebrow">Or connect a Shopify store</h2>
                <form action="/api/shopify/install" method="get">
                  <label>Store address<input name="shop" required placeholder="yourstore.myshopify.com" /></label>
                  <button className="btn ghost" type="submit">Connect with Shopify</button>
                </form>
                <p className="small muted">Your products are registered with their photos, and each paid order gets a link for the
                  buyer to claim the item&apos;s NFT.</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  );
}

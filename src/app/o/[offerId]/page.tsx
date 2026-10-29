import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { freshOffer } from "@/app/actions";
import { EvidenceList, VERDICT } from "@/app/ui/tag";
import { PayStatus } from "@/app/ui/pay-status";
import { getApp } from "@/server/app";
import { NotFound } from "@/server/catalog";
import { offerPage } from "@/server/views";

export const metadata: Metadata = { title: "Offer" };

export default function Page({ params }: { params: Promise<{ offerId: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Checking this offer on Solana…</p>}>
      <Offer params={params} />
    </Suspense>
  );
}

async function Offer({ params }: { params: Promise<{ offerId: string }> }) {
  await connection(); // offers, holders and orders change on-chain; always render per request
  const { offerId } = await params;
  const app = await getApp();
  const view = await offerPage(app, offerId).catch((e) => { if (e instanceof NotFound) notFound(); throw e; });
  const { offer, item, merchant, verdict, problem, pay } = view;
  const canPay = !problem && (verdict.recommendation === "recommended" || verdict.recommendation === "caution");
  const expired = problem === "offer expired" && item.status === "listed";

  return (
    <div className="split">
      <section className="stack">
        <div>
          <p className="eyebrow">{merchant.domain ?? merchant.name}{merchant.verified ? " · verified shop" : " · shop not verified yet"}</p>
          <h1 className="display title">{item.title}</h1>
          <p className="display" style={{ fontSize: 34, margin: 0 }}>{offer.price} <span className="eyebrow">USDC</span></p>
          {item.description && <p style={{ maxWidth: "58ch" }}>{item.description}</p>}
        </div>
        <div className="panel">
          <h2 className="eyebrow">
            Checks · <span className={`stamp ${verdict.recommendation}`} style={{ position: "static", display: "inline-block", marginLeft: 6 }}>
              {VERDICT[verdict.recommendation]}</span>
          </h2>
          <EvidenceList evidence={verdict.evidence} />
          {verdict.reasons.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{verdict.reasons.join(" ")}</p>}
        </div>
        {item.asset && <p className="small"><Link href={`/i/${item.asset}`}>See the ownership NFT and its origin record</Link></p>}
      </section>

      <aside className="panel stack" aria-label="Pay">
        <h2 className="eyebrow">Pay</h2>
        {expired ? (
          <>
            <p>This offer has expired. Offers last 15 minutes so the price and the checks stay current.</p>
            <form action={freshOffer.bind(null, item.id)}><button className="btn pay" type="submit">Get a fresh offer</button></form>
          </>
        ) : item.status === "sold" ? (
          <p>This item has been sold. Its ownership NFT is with the buyer now.</p>
        ) : problem ? (
          <p>You can&apos;t pay for this offer: {problem}.</p>
        ) : !canPay ? (
          <p>Payment is turned off for this offer because it failed a check above.</p>
        ) : (
          <>
            <p className="small">
              Scan with a Solana wallet such as Phantom or Solflare. You sign one transaction: {offer.price} USDC goes to the
              shop ({view.feeBps / 100}% service fee included), and the item&apos;s NFT comes to your wallet. If either part
              fails, nothing moves.
            </p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: pay.qrSvg }} role="img" aria-label="Solana Pay QR code" />
            <p><a className="btn pay" href={pay.solanaPay}>Open in wallet</a></p>
            {pay.blink && <p className="small"><a href={pay.blink}>Pay with a Blink</a></p>}
            {!pay.isPublic && (
              <p className="small muted">Wallets fetch the transaction from this server, so a phone wallet needs the app on a public
                URL (set APP_URL to your tunnel).</p>
            )}
            <PayStatus offerId={offer.id} />
          </>
        )}
      </aside>
    </div>
  );
}

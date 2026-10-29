import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { explorerTx } from "@/lib/chains";
import { getApp } from "@/server/app";
import { claimView } from "@/server/shopify";

import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Claim your item" };

type Props = { params: Promise<{ claimId: string }>; searchParams: Promise<{ t?: string }> };

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="muted">Looking up your order…</p>}>
      <Claim {...props} />
    </Suspense>
  );
}

async function Claim({ params, searchParams }: Props) {
  await connection();
  const [{ claimId }, { t = "" }] = await Promise.all([params, searchParams]);
  const app = await getApp();
  const v = await claimView(app, claimId, t);
  if (!v) notFound();
  return (
    <div className="split">
      <section className="stack">
        <div>
          <p className="eyebrow">{v.shop} · order {v.orderName}</p>
          <h1 className="display title">{v.item.title}</h1>
          <p style={{ maxWidth: "58ch" }}>
            Your order comes with the item&apos;s ownership NFT: the maker&apos;s record of where it came from. Keep it in your
            wallet to prove it&apos;s genuine, or to resell it later.
          </p>
        </div>
        {v.item.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- shop photos can be on any host
          <img className="photo" src={v.item.photo} alt={v.item.title} width={420} height={420} />
        )}
      </section>
      <aside className="panel stack" aria-label="Claim">
        <h2 className="eyebrow">Claim</h2>
        {v.txSig ? (
          <p>
            Claimed. The NFT is in wallet <span className="mono">{v.claimedBy}</span>.{" "}
            <a href={explorerTx(v.txSig, app.config.cluster)}>Transaction</a>
            {v.item.asset && <> · <Link href={`/i/${v.item.asset}`}>Check the NFT</Link></>}
          </p>
        ) : v.expired ? (
          <p>This claim has expired. Contact {v.shop}.</p>
        ) : v.locked ? (
          <p>This claim is locked after too many wrong emails. Contact {v.shop}.</p>
        ) : (
          <ClaimForm claimId={v.id} token={t} />
        )}
      </aside>
    </div>
  );
}

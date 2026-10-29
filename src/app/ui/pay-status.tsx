"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = { order: null | { id: string; status: string; buyer: string; tx: string | null } };

/** Polls the offer's newest order until the payment lands. */
export function PayStatus({ offerId }: { offerId: string }) {
  const [s, setS] = useState<Status>({ order: null });

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await fetch(`/api/offers/${offerId}/status`, { cache: "no-store" });
        if (r.ok) {
          const next: Status = await r.json();
          if (!stop) setS(next);
          if (next.order?.status === "paid") return;
        }
      } catch { /* try again on the next tick */ }
      if (!stop) setTimeout(poll, 3000);
    }
    poll();
    return () => { stop = true; };
  }, [offerId]);

  const o = s.order;
  if (!o) return <p className="status muted" aria-live="polite">Waiting for a wallet to open the transaction…</p>;
  if (o.status === "paid") {
    return (
      <p className="status paid" aria-live="polite">
        Paid. The NFT is in the buyer&apos;s wallet. <Link href={`/orders/${o.id}`}>View the order</Link>
        {o.tx && <> · <a href={o.tx}>transaction</a></>}
      </p>
    );
  }
  return <p className="status" aria-live="polite">A wallet has the transaction. Waiting for it to be signed…</p>;
}

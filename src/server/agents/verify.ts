import { and, count, eq, inArray, min } from "drizzle-orm";

import { hashRecord } from "@/lib/canonical";
import { parseCaip10 } from "@/lib/chains";
import { offerBody, verifyEnvelope, type Envelope, type OfferBody } from "@/lib/envelope";
import { parseUsdc } from "@/lib/money";
import { attribute } from "@/lib/solana/items";

import type { App } from "../app";
import { schema } from "../db";

/** Replica language (§9), shared in spirit with GlobalChain Muse's lexicon. */
const REPLICA_TERMS = ["1:1", "mirror quality", "aaa grade", "aaa quality", "replica", "inspired by the original",
  "designer inspired", "super copy", "dupe", "unbranded version", "same factory"];

export function replicaTerms(text: string): string[] {
  const t = text.toLowerCase();
  return REPLICA_TERMS.filter((w) => t.includes(w));
}

export type Evidence = { id: string; check: string; ok: boolean | null; detail: string };
export type Recommendation = "recommended" | "caution" | "avoid" | "excluded";
export type Verdict = {
  offer: OfferBody | null;
  from: string;
  recommendation: Recommendation;
  seller_risk: number;
  verified_seller: boolean;
  evidence: Evidence[];
  reasons: string[];
};

/**
 * §9: checks one offer envelope. Seller identity and ownership are hard gates: an offer that fails
 * them can never be "recommended", whatever any model later says (§8.1 guardrail).
 */
export async function verifyOffer(app: App, env: Envelope): Promise<Verdict> {
  const evidence: Evidence[] = [];
  const add = (check: string, ok: boolean | null, detail: string) => {
    evidence.push({ id: `E${evidence.length + 1}`, check, ok, detail });
  };
  const sig = verifyEnvelope(env, app.now());
  const parsed = offerBody.safeParse(env.body);
  if (!sig.ok || !parsed.success) {
    add("signature", false, sig.ok ? "offer body is malformed" : `offer signature: ${sig.reason}`);
    return { offer: parsed.success ? parsed.data : null, from: env.from, recommendation: "excluded", seller_risk: 100,
      verified_seller: false, evidence, reasons: ["The offer isn't validly signed."] };
  }
  const o = parsed.data;
  add("signature", true, "signed by the sending agent's key");

  const agentKey = parseCaip10(env.from).address;
  const [byAgent] = await app.db.select().from(schema.merchants).where(eq(schema.merchants.agentPubkey, agentKey));
  let risk = 0;
  let gate: string | null = null; // a reason that forces "avoid"
  const cautions: string[] = [];

  // Seller identity: is this agent a merchant we know, speaking for the wallet it names?
  if (!byAgent) {
    add("seller", false, "agent key isn't registered with any merchant");
    risk += 40;
    cautions.push("Unknown seller agent.");
  } else if (o.seller && o.seller !== byAgent.wallet) {
    add("seller", false, "offer names a payout wallet that isn't the registered merchant's");
    gate = "The offer's payout wallet doesn't belong to the merchant who signed it.";
  } else {
    const verified = Boolean(byAgent.domainVerifiedAt);
    add("seller", verified, verified ? `verified seller ${byAgent.domain}` : `${byAgent.name}: domain not verified yet`);
    if (!verified) { risk += 20; cautions.push("The seller's domain isn't verified yet."); }
  }
  const sellerWallet = byAgent?.wallet ?? o.seller;

  // Ownership: the chain decides who can sell this item.
  if (!o.asset) {
    add("ownership", null, "no ownership NFT offered");
    risk += 15;
    cautions.push("No ownership NFT comes with this item.");
  } else {
    const asset = await app.chain.getAsset(o.asset);
    if (!asset) {
      add("ownership", false, "the NFT doesn't exist on chain");
      gate ??= "The item's NFT doesn't exist.";
    } else if (holderMismatch(await holderOf(app, asset.owner), byAgent?.id, asset.owner, sellerWallet)) {
      const holder = await holderOf(app, asset.owner);
      add("ownership", false, `NFT belongs to someone else${holder ? ` (${holder.domain ?? holder.name})` : ""}`);
      gate ??= "NFT belongs to someone else: this listing copies another seller's item.";
    } else {
      const d = asset.transferDelegate?.authority;
      const listed = d?.type === "Address" && d.address === app.keys.settlement.publicKey;
      add("ownership", listed, listed ? "NFT is in the seller's wallet and listed for atomic sale" : "NFT is the seller's but not listed for sale");
      if (!listed) gate ??= "The item isn't listed for sale on chain.";

      // Origin record: the hash on the asset must match a record we can recompute.
      const h = attribute(asset, "registration_hash");
      const [rec] = h ? await app.db.select().from(schema.records).where(eq(schema.records.hash, h)) : [];
      if (!h) {
        add("origin", null, "no origin record on the NFT");
        cautions.push("No origin record.");
      } else if (!rec || hashRecord(rec.payload) !== h) {
        add("origin", false, "the NFT's origin hash doesn't match any record");
        gate ??= "The origin record doesn't match.";
      } else {
        add("origin", true, `origin record ${rec.sig.slice(0, 8)}… recomputes to the NFT's hash`);
        const originPrice = (rec.payload as { origin_price?: string }).origin_price;
        if (originPrice && parseUsdc(o.price) * 10n < parseUsdc(originPrice) * 4n) {
          add("price", false, `asking ${o.price} against an origin price of ${originPrice}`);
          risk += 25;
          cautions.push("Priced far below the original.");
        }
      }
    }
  }

  const terms = replicaTerms(`${o.title} ${o.pitch ?? ""}`);
  if (terms.length) {
    add("listing", false, `replica language: ${terms.join(", ")}`);
    risk += 30;
    gate ??= `The listing uses replica language (${terms.join(", ")}).`;
  } else {
    add("listing", true, "no replica language");
  }

  // Seller history: how long the shop has been here and what it has sold (§9 seller risk).
  if (byAgent && !gate) {
    const h = await sellerHistory(app, byAgent.id);
    const days = Math.max(0, Math.floor((app.now().getTime() - byAgent.createdAt.getTime()) / 86_400_000));
    const since = days === 0 ? "joined today" : `joined ${days} day${days === 1 ? "" : "s"} ago`;
    if (h.sales > 0) {
      add("history", true, `${h.sales} completed sale${h.sales === 1 ? "" : "s"}; ${since}`);
    } else {
      add("history", null, `no completed sales yet; ${since}`);
      if (days < NEW_SHOP_DAYS) risk += 10;
    }
  } else if (!byAgent) {
    add("history", false, "no sales history here");
  }
  add("photos", null, "photo comparison not run yet");

  const seller_risk = Math.min(100, risk);
  const recommendation: Recommendation = gate ? "avoid" : cautions.length || seller_risk >= 40 ? "caution" : "recommended";
  return {
    offer: o, from: env.from, recommendation, seller_risk,
    verified_seller: Boolean(byAgent?.domainVerifiedAt) && !gate,
    evidence, reasons: gate ? [gate] : cautions,
  };
}

const NEW_SHOP_DAYS = 7;
const SOLD = ["paid", "shipped", "delivered"] as const;

/** Completed sales by a merchant, from paid orders on its offers. */
export async function sellerHistory(app: App, merchantId: string) {
  const [row] = await app.db.select({ sales: count(), first: min(schema.orders.createdAt) }).from(schema.orders)
    .innerJoin(schema.offers, eq(schema.orders.offerId, schema.offers.id))
    .where(and(eq(schema.offers.merchantId, merchantId), inArray(schema.orders.status, [...SOLD])));
  return { sales: Number(row?.sales ?? 0), firstSale: row?.first ?? null };
}

async function holderOf(app: App, wallet: string) {
  const [m] = await app.db.select().from(schema.merchants).where(eq(schema.merchants.wallet, wallet));
  return m;
}

/**
 * The NFT's holder must be the offer's seller. If a registered merchant holds it, only that merchant's
 * own agent may offer it, so a copier can't borrow the real wallet as their "seller".
 */
function holderMismatch(holder: { id: string } | undefined, agentMerchantId: string | undefined, owner: string,
  sellerWallet: string | undefined): boolean {
  if (holder) return holder.id !== agentMerchantId;
  return owner !== sellerWallet;
}

/** §8.1 guardrail, applied in code to whatever ranking an engine (scripted or LLM) proposes. */
export function enforceGuardrail(v: Verdict, proposed: Recommendation): Recommendation {
  const failedHardGate = v.evidence.some((e) => (e.check === "seller" || e.check === "ownership") && e.ok === false);
  if (v.recommendation === "excluded") return "excluded";
  if (v.recommendation === "avoid") return "avoid";
  if (proposed === "recommended" && (failedHardGate || v.recommendation === "caution")) return v.recommendation;
  return proposed;
}

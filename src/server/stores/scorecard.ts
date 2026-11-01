// The scorecard: beyond the label (can it be trusted at all?), how good the buy is. Five parts, each 0-100
// with a one-line note saying where the number came from, and an overall score that ranks results
// within a label. Computed here from the checks, never by the model; a score can't lift a label.
import type { Recommendation, Verdict } from "../agents/verify";
import type { StoreProduct } from "./catalog";
import type { DropshipCheck } from "./dropship";

export type ScoreKey = "authentic" | "seller" | "quality" | "value" | "delivery";
export type ScoreRow = { key: ScoreKey; label: string; score: number | null; note: string };
export type Scorecard = { overall: number; grade: "Excellent" | "Good" | "Fair" | "Poor"; rows: ScoreRow[] };

const LABELS: Record<ScoreKey, string> = { authentic: "Authentic", seller: "Seller", quality: "Quality", value: "Value", delivery: "Delivery" };
const WEIGHTS: Record<ScoreKey, number> = { authentic: 0.3, seller: 0.25, quality: 0.25, value: 0.1, delivery: 0.1 };

const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
const row = (key: ScoreKey, score: number | null, note: string): ScoreRow => ({ key, label: LABELS[key], score: score === null ? null : clamp(score), note });
const years = (n: number) => `${Math.floor(n)} year${Math.floor(n) === 1 ? "" : "s"}`;

export function scorecard(rows: ScoreRow[], recommendation: Recommendation): Scorecard {
  const known = rows.filter((r) => r.score !== null);
  const weight = known.reduce((s, r) => s + WEIGHTS[r.key], 0);
  let overall = weight ? known.reduce((s, r) => s + r.score! * WEIGHTS[r.key], 0) / weight : 0;
  // The label still rules: nothing to avoid scores above 20.
  if (recommendation === "avoid" || recommendation === "excluded") overall = Math.min(overall, 20);
  overall = clamp(overall);
  const grade = overall >= 85 ? "Excellent" : overall >= 70 ? "Good" : overall >= 50 ? "Fair" : "Poor";
  return { overall, grade, rows };
}

// What the listing says about how the thing is made: materials named, specs, a real description.
const MATERIALS =
  /\b(cotton|organic|polyester|nylon|spandex|elastane|lycra|wool|merino|cashmere|linen|silk|leather|suede|denim|fleece|bamboo|recycled|stainless steel|steel|aluminium|aluminum|titanium|brass|copper|sterling silver|silver|gold|ceramic|glass|oak|walnut|wood|canvas|rubber|gore-tex|down|composition|fabric|material)\b/i;
export function listingDetail(text: string, specs: string[] = []) {
  const all = `${text} ${specs.join(" ")}`;
  let s = 35;
  const notes: string[] = [];
  // Name a real material when there is one, not just the word "fabric".
  const named = [...all.matchAll(new RegExp(MATERIALS, "gi"))].map((m) => m[0].toLowerCase());
  if (named.length) {
    s += 25;
    const real = named.find((m) => !/^(composition|fabric|material)$/.test(m));
    notes.push(real ? `materials named (${real})` : "materials listed");
  }
  if (specs.length >= 3) {
    s += 20;
    notes.push(`${specs.length} specs listed`);
  }
  if (text.length >= 250) {
    s += 20;
    notes.push("full description");
  } else if (text.length < 80) notes.push("short description");
  return { score: clamp(s), note: notes.join(", ") || "little detail in the listing" };
}

// Price against the typical (median) price of the other results in the same currency.
export function valueRow(price: number, peers: number[], dropship = false): ScoreRow {
  if (peers.length < 3) return row("value", null, "Not enough similar results to compare prices");
  const sorted = [...peers].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const diff = (median - price) / median;
  const pct = Math.round(Math.abs(diff) * 100);
  let note = pct < 5 ? "About the typical price of similar results" : `${pct}% ${diff > 0 ? "below" : "above"} the typical price of similar results`;
  let s = Math.max(10, 55 + diff * 50);
  if (dropship) {
    s -= 15;
    note += "; supplier items like this usually sell for less elsewhere";
  }
  return row("value", s, note);
}

export function storeScorecard(
  p: StoreProduct,
  c: {
    recommendation: Recommendation;
    domain_age_years: number | null;
    partner: unknown;
    brand: string | null;
    brand_own_store: boolean;
    replica: boolean;
    dropship: DropshipCheck;
  },
  peerPrices: number[],
): Scorecard {
  const own = !p.store.public_domain.endsWith(".myshopify.com");
  const ds = c.dropship;

  const authentic = c.replica
    ? row("authentic", 0, "Listing uses replica or copy-seller wording")
    : c.partner
      ? row("authentic", 95, "Registered VeriChainX maker: items can be verified on Solana")
      : c.brand && c.brand_own_store
        ? row("authentic", 95, `Sold by ${c.brand}'s own store`)
        : c.brand
          ? row("authentic", 45, `${c.brand} item from a reseller; whether it's authorised can't be checked`)
          : ds.level === "likely"
            ? row("authentic", 45, "Generic supplier product sold under the store's name")
            : ds.level === "possible"
              ? row("authentic", 70, "The store's own label, with some signs of a supplier product")
              : row("authentic", 85, "The store's own label; no signs of resold supplier stock");

  let seller = 40;
  const sNotes: string[] = [];
  if (own) seller += 15;
  else {
    seller -= 15;
    sNotes.push("no domain of its own");
  }
  const age = c.domain_age_years;
  if (age !== null) {
    seller += age >= 5 ? 30 : age >= 2 ? 22 : age >= 1 ? 12 : -10;
    sNotes.push(age >= 1 ? `domain ${years(age)} old` : "domain under a year old");
  } else if (own) sNotes.push("domain age unknown");
  if (p.store.refund_policy) {
    seller += 10;
    sNotes.push("refund policy");
  } else sNotes.push("no refund policy listed");
  if (c.partner) seller += 10;

  const detail = listingDetail(p.description, p.specs);
  let quality: ScoreRow;
  if (p.rating && p.rating.count > 0) {
    // Reviews shrunk toward 4.0 by 15 votes, so 5.0 from 3 reviews doesn't beat 4.7 from 2,000.
    const shrunk = (p.rating.value * p.rating.count + 4.0 * 15) / (p.rating.count + 15);
    let r = ((shrunk - 3) / 2) * 100;
    let note = `${p.rating.value.toFixed(1)}/5 from ${p.rating.count.toLocaleString("en-US")} review${p.rating.count === 1 ? "" : "s"}; ${detail.note}`;
    if (ds.level === "likely") {
      // Dropship stores often import reviews from the supplier's marketplace listing.
      r = (r + 50) / 2;
      note += "; reviews may be imported from a supplier";
    }
    quality = row("quality", r * 0.7 + detail.score * 0.3, note);
  } else {
    quality = row("quality", Math.min(detail.score, 65), `No reviews yet; ${detail.note}`);
  }

  const d = ds.delivery;
  const delivery = d
    ? row(
        "delivery",
        (d.max_days <= 5 ? 90 : d.max_days <= 8 ? 78 : d.max_days <= 12 ? 60 : d.max_days <= 20 ? 40 : 20) - (d.overseas ? 10 : 0),
        `About ${d.min_days}–${d.max_days} days by the shipping policy${d.abroad_max_days ? `, up to ${d.abroad_max_days} abroad` : ""}${d.overseas ? "; ships from overseas" : ""}`,
      )
    : row("delivery", null, "Shipping time not stated");

  return scorecard(
    [authentic, row("seller", seller, sNotes.join(", ")), quality, valueRow(p.price_minor, peerPrices, ds.level === "likely"), delivery],
    c.recommendation,
  );
}

/** A VeriChainX maker's offer: authenticity from the chain checks, seller from the seller risk. */
export function makerScorecard(v: Verdict, recommendation: Recommendation, peerPricesMinor: number[]): Scorecard {
  const passed = (check: string) => v.evidence.filter((e) => e.check === check).every((e) => e.ok !== false)
    && v.evidence.some((e) => e.check === check && e.ok === true);
  const marks = [
    passed("ownership") ? "seller holds the NFT" : "NFT not confirmed",
    passed("origin") ? "origin record anchored" : "no origin record",
    passed("photos") ? "photos match the registered ones" : null,
  ].filter(Boolean).join(", ");
  const authenticScore = (passed("ownership") ? 50 : 0) + (passed("origin") ? 35 : 0) + (passed("photos") ? 15 : 0);
  const sellerOk = passed("signature") && v.known_seller;
  const o = v.offer;
  const detail = listingDetail(`${o?.title ?? ""} ${o?.pitch ?? ""}`);
  return scorecard(
    [
      row("authentic", authenticScore, marks),
      sellerOk
        ? row("seller", 100 - v.seller_risk, `${v.verified_seller ? "verified shop" : "shop not verified yet"}; seller risk ${v.seller_risk}/100`)
        : row("seller", 0, "Not a registered shop's agent"),
      row("quality", Math.min(detail.score, 70), `No shopper reviews on VeriChainX yet; ${detail.note}`),
      o ? valueRow(Math.round(Number(o.price) * 100), peerPricesMinor) : row("value", null, "No price"),
      row("delivery", null, "Delivery time set by the maker; ask its agent"),
    ],
    recommendation,
  );
}

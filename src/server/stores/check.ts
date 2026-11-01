// Checks for real stores found in Shopify's catalog. There is no NFT or origin record to check, so the
// label rests on what can be known about the store: its own domain and how long it has existed, the
// product's reviews, a published refund policy, replica wording, signs of dropshipping (dropship.ts), and
// whether the store is a registered VeriChainX maker. As with network offers, the label is computed here, never by the model.
import { and, eq, isNotNull } from "drizzle-orm";

import type { App } from "../app";
import { schema } from "../db";
import { replicaTerms, type Evidence, type Recommendation } from "../agents/verify";
import type { StoreProduct } from "./catalog";
import { dropshipCheck, dropshipReason, storeFacts, type DropshipCheck, type StoreFacts } from "./dropship";

export type StoreCheck = {
  recommendation: Recommendation;
  evidence: Evidence[];
  reasons: string[];
  domain_age_years: number | null;
  partner: { merchant_id: string; name: string } | null;
  brand: string | null;
  brand_own_store: boolean;
  replica: boolean;
  dropship: DropshipCheck;
};

const YEAR = 365.25 * 24 * 3600 * 1000;
const ages = new Map<string, Promise<number | null>>();

// Second-level suffixes under which a registrable domain has three labels (shop.co.za, not co.za).
const SECOND_LEVEL = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;

export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  return labels.slice(SECOND_LEVEL.test(host.toLowerCase()) ? -3 : -2).join(".");
}

// Registration date from RDAP (the successor to WHOIS), cached per domain. Null when unknown.
export function domainAgeYears(domain: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  const apex = registrableDomain(domain);
  if (!ages.has(apex)) {
    ages.set(
      apex,
      // rdap.org redirects to the registry's own RDAP server; it refuses requests without a User-Agent.
      fetcher(`https://rdap.org/domain/${apex}`, {
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
        headers: { "User-Agent": "VeriChainX/1.0 (shopper agent; domain age check)", Accept: "application/rdap+json" },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const reg = d?.events?.find((e: { eventAction: string }) => e.eventAction === "registration")?.eventDate;
          return reg ? (Date.now() - new Date(reg).getTime()) / YEAR : null;
        })
        .catch(() => null),
    );
  }
  return ages.get(apex)!;
}

async function partnerFor(app: App, domain: string) {
  const [m] = await app.db.select({ id: schema.merchants.id, name: schema.merchants.name }).from(schema.merchants)
    .where(and(eq(schema.merchants.domain, domain), isNotNull(schema.merchants.domainVerifiedAt)));
  return m ? { merchant_id: m.id, name: m.name } : null;
}

// Brands that are widely copied. A listing naming one, from a store that isn't the brand's own, can't be
// confirmed as an authorised seller from public data.
const BRANDS: [string, RegExp][] = [
  ["Nike", /\bnike\b|\bjordan\b/i],
  ["Adidas", /\badidas\b|\byeezy\b/i],
  ["Puma", /\bpuma\b/i],
  ["New Balance", /\bnew balance\b/i],
  ["The North Face", /\bnorth face\b/i],
  ["Gucci", /\bgucci\b/i],
  ["Louis Vuitton", /\blouis vuitton\b|\bLV\b/],
  ["Prada", /\bprada\b/i],
  ["Chanel", /\bchanel\b/i],
  ["Hermès", /\bherm[eè]s\b|\bbirkin\b/i],
  ["Balenciaga", /\bbalenciaga\b/i],
  ["Dior", /\bdior\b/i],
  ["Supreme", /\bsupreme\b/i],
  ["Ralph Lauren", /\bralph lauren\b/i],
  ["Moncler", /\bmoncler\b/i],
  ["Canada Goose", /\bcanada goose\b/i],
  ["Rolex", /\brolex\b/i],
  ["Ray-Ban", /\bray-?ban\b/i],
  ["Apple", /\b(airpods|iphone|apple watch)\b/i],
];
// Phrases sellers of copies use; harmless alone, telling next to a famous brand.
const COPY_HINTS = /\b(premium quality|top quality|high quality copy|first copy|master copy|original quality|best quality)\b/i;

export function brandIn(text: string) {
  return BRANDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

export async function checkStore(
  app: App,
  p: StoreProduct,
  deps: { age?: (d: string) => Promise<number | null>; partner?: (d: string) => Promise<StoreCheck["partner"]>; facts?: (p: StoreProduct) => Promise<StoreFacts> } = {},
): Promise<StoreCheck> {
  const domain = p.store.public_domain;
  const ownDomain = !domain.endsWith(".myshopify.com");
  const [age, partner, facts] = await Promise.all([
    ownDomain ? (deps.age ?? domainAgeYears)(domain) : Promise.resolve(null),
    (deps.partner ?? ((d: string) => partnerFor(app, d)))(domain).catch(() => null),
    (deps.facts ?? ((x: StoreProduct) => storeFacts(x)))(p).catch((): StoreFacts => ({ product: null, catalog: null, shipping: null })),
  ]);
  const dropship = dropshipCheck(p, facts);
  const text = `${p.title} ${p.description}`;
  const brand = brandIn(text);
  const brandKey = brand?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  // The brand's own store (nike.com, adidas.co.za) is authorised by definition.
  const brandOwnStore = Boolean(brand && domain.replace(/[^a-z]/g, "").includes(brandKey));
  const brandRisk = Boolean(brand && !brandOwnStore);
  const replicaWord = replicaTerms(text)[0];
  const copyHint = !replicaWord && brandRisk && COPY_HINTS.test(text);
  const replica = Boolean(replicaWord || copyHint);
  const evidence: Evidence[] = [
    { id: "STORE", check: "seller", ok: true, detail: `Listed in Shopify's catalog by ${p.store.name}`, source: p.store.url ?? undefined },
    ownDomain
      ? { id: "DOMAIN", check: "seller", ok: true, detail: `Sells from its own domain, ${domain}` }
      : { id: "DOMAIN", check: "seller", ok: false, detail: "No domain of its own (only a myshopify.com address)" },
  ];
  if (ownDomain) {
    evidence.push(
      age === null
        ? { id: "AGE", check: "risk", ok: null, detail: "Domain age unknown" }
        : { id: "AGE", check: "risk", ok: age >= 1, detail: age >= 1 ? `Domain registered ${Math.floor(age)} year${Math.floor(age) === 1 ? "" : "s"} ago` : "Domain registered less than a year ago" },
    );
  }
  evidence.push(
    p.store.refund_policy
      ? { id: "POLICY", check: "risk", ok: true, detail: "Publishes a refund policy", source: p.store.refund_policy }
      : { id: "POLICY", check: "risk", ok: null, detail: "No refund policy in the catalog listing" },
    p.rating
      ? { id: "REVIEWS", check: "risk", ok: p.rating.value >= 4 && p.rating.count >= 10, detail: `Rated ${p.rating.value.toFixed(1)}/5 from ${p.rating.count.toLocaleString("en-US")} review${p.rating.count === 1 ? "" : "s"}` }
      : { id: "REVIEWS", check: "risk", ok: null, detail: "No reviews yet" },
    replica
      ? { id: "TEXT", check: "risk", ok: false, detail: copyHint ? `Names ${brand} with wording copy sellers use ("${text.match(COPY_HINTS)?.[0]}")` : `Listing uses replica wording ("${replicaWord}")` }
      : { id: "TEXT", check: "risk", ok: true, detail: "No replica wording in the listing" },
    ...(brand
      ? [
          brandOwnStore
            ? ({ id: "BRAND", check: "seller", ok: true, detail: `${brand}'s own store` } as Evidence)
            : ({ id: "BRAND", check: "seller", ok: null, detail: `Sells ${brand}-branded items but isn't ${brand}'s own store; whether it's an authorised seller can't be checked` } as Evidence),
        ]
      : []),
    ...dropship.evidence,
    partner
      ? { id: "ORIGIN", check: "origin", ok: true, detail: `Registered VeriChainX maker (${partner.name}): its items can be verified on Solana` }
      : { id: "ORIGIN", check: "origin", ok: null, detail: "No ownership NFT: buy on the store's own checkout" },
  );

  const reasons: string[] = [];
  let recommendation: Recommendation;
  if (replica) {
    recommendation = "avoid";
    reasons.push(copyHint ? `${brand} item described with copy-seller wording` : "listing uses replica wording");
  } else if (dropship.level === "likely" || brandRisk || !ownDomain || (age !== null && age < 1) || (p.rating && p.rating.value < 3.5)) {
    recommendation = "caution";
    if (dropship.level === "likely") reasons.push(dropshipReason(dropship));
    if (brandRisk) reasons.push(`${brand} item from a store that isn't ${brand}'s; authorisation unconfirmed`);
    if (!ownDomain) reasons.push("no domain of its own");
    if (age !== null && age < 1) reasons.push("domain under a year old");
    if (p.rating && p.rating.value < 3.5) reasons.push(`rated ${p.rating.value.toFixed(1)}/5`);
  } else if (age !== null && age >= 1 && p.store.refund_policy) {
    recommendation = "recommended";
    reasons.push(`own domain for ${Math.floor(age)}+ years`, "refund policy published");
    if (p.rating && p.rating.count >= 10) reasons.push(`rated ${p.rating.value.toFixed(1)}/5 by ${p.rating.count.toLocaleString("en-US")}`);
  } else {
    recommendation = "caution";
    if (age === null) reasons.push("domain age unknown");
    if (!p.store.refund_policy) reasons.push("no refund policy listed");
  }
  if (dropship.level === "possible" && recommendation !== "avoid") reasons.push(dropshipReason(dropship));
  return { recommendation, evidence, reasons, domain_age_years: age, partner, brand, brand_own_store: brandOwnStore, replica, dropship };
}

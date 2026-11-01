// Dropship signals for a Shopify store. Every Shopify store publishes its products as JSON
// (/products/<handle>.json, /products.json) and its shipping policy as a page; the tells of a store that
// resells a supplier's stock are in those: supplier apps named as the vendor, a "Ships From" option, the
// default "My Store" vendor, supplier boilerplate in the description, and long or overseas shipping.
// Dropshipping is legal, so this lowers the label to caution at most; it never blocks a purchase.
import type { Evidence } from "../agents/verify";
import type { StoreProduct } from "./catalog";

export type StoreFacts = {
  product: { vendor: string; tags: string[]; options: string[]; body: string } | null;
  catalog: { count: number; vendors: string[]; types: string[] } | null;
  shipping: string | null; // shipping policy as plain text
};

export type Delivery = { min_days: number; max_days: number; abroad_max_days: number | null; overseas: boolean };

export type DropshipCheck = { level: "likely" | "possible" | "none"; points: number; evidence: Evidence[]; delivery: Delivery | null };

const UA = "Mozilla/5.0 (compatible; VeriChainX/1.0; shopper agent)";
const catalogs = new Map<string, Promise<StoreFacts["catalog"]>>();
const policies = new Map<string, Promise<string | null>>();

// Supplier and sourcing apps that stores import products from; they often end up as the vendor or a tag.
const SUPPLIERS =
  /\b(ali\s?express|aliexpress|cj\s?dropshipping|cjdropshipping|zendrop|dsers|spocket|autods|hypersku|shipwill|shopwill|syncee|modalyst|oberlo|eprolo|doba|wholesale2b|sell the trend|dropified|buckydrop|banggood|dhgate|alibaba|1688|temu|taobao|tmall|dropship\w*)\b/i;
const DEFAULT_VENDORS = /^(my store|default vendor|vendor|store|shop|unknown|none)$/i;
// Category names that catch-all "general stores" use instead of real product types.
const GENERIC_TYPES = /^(hot sales?|gift ideas?|daily necessities|tools? & gadgets|funnel[- ]?(test|page)s?|.*&\s?gift ideas)$/i;
// Wording copied from supplier listings into the description.
const BOILERPLATE = [
  /manual(ly)? measure(ment|d)?/i,
  /allow\s*\d+\s*(?:-|~|to)\s*\d+\s*(cm|mm)\s*(error|difference|deviation)/i,
  /package (includes?|contents?)\s*:?\s*1\s*[x×*]/i,
  /colou?r(s)? may (be )?(slightly )?(differ|vary).{0,40}(monitor|screen|display|light)/i,
  /\b100% (brand )?new and high quality\b/i,
];
const OVERSEAS = /\b(ships?|shipped|dispatched|sent) (directly )?from (china|hong kong|our (overseas|international|global) (warehouse|suppliers?|partners?)|overseas|asia)\b|\b(overseas|international) (warehouse|suppliers?)\b/i;

async function getJson(url: string, fetcher: typeof fetch) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": UA, Accept: "application/json" } });
  return r.ok ? r.json() : null;
}

export const textOf = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Fetches what the store publishes. Each part is null when the store doesn't serve it (some turn the
// JSON off); a missing part is never held against the store.
export async function storeFacts(p: StoreProduct, fetcher: typeof fetch = fetch): Promise<StoreFacts> {
  const base = `https://${p.store.public_domain}`;
  const product = p.handle
    ? getJson(`${base}/products/${encodeURIComponent(p.handle)}.json`, fetcher)
        .then((d) =>
          d?.product
            ? {
                vendor: String(d.product.vendor ?? ""),
                tags: (Array.isArray(d.product.tags) ? d.product.tags : String(d.product.tags ?? "").split(",")).map((t: string) => t.trim()).filter(Boolean),
                options: (d.product.options ?? []).map((o: { name: string }) => o.name),
                body: textOf(String(d.product.body_html ?? "")).slice(0, 4000),
              }
            : null,
        )
        .catch(() => null)
    : Promise.resolve(null);
  if (!catalogs.has(base)) {
    catalogs.set(
      base,
      getJson(`${base}/products.json?limit=250`, fetcher)
        .then((d) => {
          const ps: { vendor?: string; product_type?: string }[] = d?.products ?? [];
          if (!ps.length) return null;
          const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
          return { count: ps.length, vendors: uniq(ps.map((x) => x.vendor)), types: uniq(ps.map((x) => x.product_type)) };
        })
        .catch(() => null),
    );
  }
  const policyUrl = p.store.shipping_policy ?? `${base}/policies/shipping-policy`;
  if (!policies.has(policyUrl)) {
    policies.set(
      policyUrl,
      fetcher(policyUrl, { signal: AbortSignal.timeout(6000), redirect: "follow", headers: { "User-Agent": UA } })
        .then(async (r) => (r.ok ? textOf(await r.text()) : null))
        // Store pages wrap the policy in the theme; keep the part from the heading on.
        .then((t) => (t ? t.slice(Math.max(0, t.search(/shipping policy/i))).slice(0, 6000) : null))
        .catch(() => null),
    );
  }
  const [prod, catalog, shipping] = await Promise.all([product, catalogs.get(base)!, policies.get(policyUrl)!]);
  return { product: prod, catalog, shipping };
}

// Delivery time from a shipping policy: processing plus transit, in days. Weeks count as 7 days and
// business days are taken as days (close enough for a label). Ranges on lines about international
// orders are kept apart, so a domestic estimate isn't stretched by the worldwide one.
export function deliveryFrom(text: string | null): Delivery | null {
  if (!text) return null;
  const range = /(\d{1,2})\s*(?:-|–|—|~|to)\s*(\d{1,2})\s*(business |working )?(days?|weeks?)|(?:within|in)\s+(\d{1,2})\s*(business |working )?(days?|weeks?)/gi;
  const processing: number[][] = [];
  const domestic: number[][] = [];
  const abroad: number[][] = [];
  for (const m of text.matchAll(range)) {
    const week = /week/i.test(m[4] ?? m[7] ?? "");
    const lo = Number(m[1] ?? m[5]) * (week ? 7 : 1);
    const hi = Number(m[2] ?? m[5]) * (week ? 7 : 1);
    if (!hi || hi > 90 || lo > hi) continue;
    // What the range is about: the words before it, back to the start of its sentence.
    const window = text.slice(Math.max(0, m.index! - 80), m.index!);
    // (A full stop ends a sentence only when a space follows, so prices like £15.99 don't.)
    const end = [...window.matchAll(/[.!?](?=\s)/g)].pop();
    const before = end ? window.slice(end.index! + 1) : window;
    // Holiday and peak-season delays aren't the normal delivery time.
    if (/holiday|delay|peak|christmas|black friday/i.test(before)) continue;
    if (/process|handl|prepar|fulfil|dispatch(ed)? within|ships? within|ready to ship/i.test(before)) processing.push([lo, hi]);
    else if (/international|worldwide|rest of (the )?world|outside (the )?(us|usa|uk|eu|country)|overseas/i.test(before)) abroad.push([lo, hi]);
    else domestic.push([lo, hi]);
  }
  const transit = domestic.length ? domestic : abroad;
  if (!transit.length) return null;
  const pMin = processing.length ? Math.min(...processing.map((r) => r[0])) : 0;
  // The first processing time stated is the usual one; later ones tend to be for exceptions.
  const pMax = processing.length ? processing[0][1] : 0;
  return {
    min_days: pMin + Math.min(...transit.map((r) => r[0])),
    max_days: pMax + Math.max(...transit.map((r) => r[1])),
    abroad_max_days: domestic.length && abroad.length ? pMax + Math.max(...abroad.map((r) => r[1])) : null,
    overseas: OVERSEAS.test(text),
  };
}

export function dropshipCheck(p: StoreProduct, facts: StoreFacts): DropshipCheck {
  const ev: Evidence[] = [];
  let points = 0;
  const add = (n: number, id: string, text: string, source?: string) => {
    points += n;
    ev.push({ id, check: "dropship", ok: false, detail: text, source });
  };
  const options = [...p.options, ...(facts.product?.options ?? [])];
  const vendor = facts.product?.vendor ?? "";
  const supplier = [vendor, ...(facts.product?.tags ?? []), ...(facts.catalog?.vendors ?? []), ...(facts.catalog?.types ?? [])].map((x) => x.match(SUPPLIERS)?.[0]).find(Boolean);
  const body = `${p.description} ${facts.product?.body ?? ""}`;
  const delivery = deliveryFrom(facts.shipping);
  const base = `https://${p.store.public_domain}`;

  if (options.some((o) => /ships?\s*from|ship from|warehouse/i.test(o))) add(2, "SHIPSFROM", 'Has a "Ships From" option, typical of products imported from a supplier');
  if (supplier) add(2, "SUPPLIER", `Store's product data names a dropship supplier ("${supplier}")`, `${base}/products.json`);
  if (vendor && DEFAULT_VENDORS.test(vendor.trim())) add(1, "VENDOR", `Vendor is left as "${vendor.trim()}", Shopify's default`);
  const generic = facts.catalog?.types.filter((t) => GENERIC_TYPES.test(t)) ?? [];
  if (generic.length) add(1, "GENERAL", `Catalog uses catch-all categories (${generic.slice(0, 2).map((t) => `"${t}"`).join(", ")}), typical of a general store`, `${base}/products.json`);
  const boiler = BOILERPLATE.map((re) => body.match(re)?.[0]).filter(Boolean);
  if (boiler.length) add(1, "BOILERPLATE", `Description has supplier wording ("${boiler[0]}")`);
  if (delivery?.overseas) add(2, "OVERSEAS", "Shipping policy says orders ship from overseas", p.store.shipping_policy ?? undefined);
  else if (delivery && delivery.max_days >= 14) add(1, "SLOW", `Shipping policy quotes up to ${delivery.max_days} days for delivery`, p.store.shipping_policy ?? undefined);
  if (p.list_price_minor && p.list_price_minor >= p.price_minor * 1.5) add(0.5, "MARKDOWN", `"Was" price is ${Math.round((1 - p.price_minor / p.list_price_minor) * 100)}% higher than the sale price`);

  const level = points >= 2 ? "likely" : points >= 1 ? "possible" : "none";
  if (level === "none") {
    const looked = [facts.product && "product data", facts.catalog && "catalog", facts.shipping && "shipping policy"].filter(Boolean);
    ev.push({ id: "DROPSHIP", check: "dropship", ok: looked.length ? true : null, detail: looked.length ? `No dropship signs in the store's ${looked.join(", ")}` : "Store's product data and shipping policy weren't available to check" });
  } else {
    // Weak signals alone are shown as neutral, not failures.
    if (level === "possible") for (const e of ev) e.ok = null;
    ev.unshift({ id: "DROPSHIP", check: "dropship", ok: level === "likely" ? false : null, detail: level === "likely" ? "Likely dropshipped: the store resells a supplier's stock" : "Possibly dropshipped" });
  }
  return { level, points, evidence: ev, delivery };
}

const SHORT: Record<string, string> = {
  SHIPSFROM: '"Ships From" option',
  SUPPLIER: "supplier named in its product data",
  VENDOR: "default vendor",
  GENERAL: "general-store catalog",
  BOILERPLATE: "supplier wording",
  OVERSEAS: "ships from overseas",
  SLOW: "long delivery",
  MARKDOWN: "inflated 'was' price",
};

// "likely dropshipped: ships from overseas, supplier wording"
export function dropshipReason(d: DropshipCheck) {
  const why = d.evidence.filter((e) => SHORT[e.id]).map((e) => SHORT[e.id]);
  return `${d.level} dropshipped${why.length ? `: ${why.slice(0, 2).join(", ")}` : ""}`;
}

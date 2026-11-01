// Any Shopify product page, by URL: the same StoreProduct the catalog search returns, built from what
// the store itself publishes (/products/<handle>.json for the product, the page for its currency and
// review rating, /policies/refund-policy for returns). Lets another developer's agent check a product
// it found anywhere, not only through our search.
import type { StoreProduct } from "./catalog";

const UA = "Mozilla/5.0 (compatible; VeriChainX/1.0; shopper agent)";

type ShopifyJson = {
  product: {
    id: number;
    title: string;
    handle: string;
    body_html: string | null;
    vendor: string;
    options: { name: string }[];
    images: { src: string }[];
    variants: { id: number; title: string; price: string; compare_at_price: string | null; available?: boolean }[];
  };
};

const minor = (s: string | null | undefined) => (s ? Math.round(Number(s) * 100) : null);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The page's currency and aggregate rating, from Shopify's currency script and the JSON-LD a theme or
// review app embeds. Either can be missing.
export function pageExtras(html: string) {
  const currency = html.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/)?.[1] ?? html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null;
  const value = html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/)?.[1];
  const count = html.match(/"(?:reviewCount|ratingCount)"\s*:\s*"?(\d+)"?/)?.[1];
  return { currency, rating: value && count ? { value: Number(value), count: Number(count) } : null };
}

export async function productFromUrl(raw: string, fetcher: typeof fetch = fetch): Promise<StoreProduct> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Use an https:// product link");
  // Only public store domains: no IP addresses, localhost or internal names (this runs on our server).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal|lan|home|arpa)$/i.test(url.hostname)) {
    throw new Error("Use a public store's product link");
  }
  const handle = url.pathname.match(/\/products\/([^/?#]+)/)?.[1];
  if (!handle) throw new Error("That isn't a Shopify product link (expected …/products/<name>)");
  const base = `https://${url.hostname}`;
  const get = (path: string, accept = "application/json") => fetcher(`${base}${path}`, { signal: AbortSignal.timeout(8000), redirect: "follow", headers: { "User-Agent": UA, Accept: accept } });

  const [json, page, refund] = await Promise.all([
    get(`/products/${handle}.json`).then((r) => (r.ok ? (r.json() as Promise<ShopifyJson>) : null)).catch(() => null),
    get(`/products/${handle}`, "text/html").then((r) => (r.ok ? r.text() : "")).catch(() => ""),
    get("/policies/refund-policy", "text/html").then((r) => r.ok).catch(() => false),
  ]);
  if (!json?.product) throw new Error("The store didn't return product data for that link; it may not be a Shopify store");
  const p = json.product;
  const want = url.searchParams.get("variant");
  const available = p.variants.filter((v) => v.available !== false);
  const v = p.variants.find((x) => String(x.id) === want) ?? available[0] ?? p.variants[0];
  const extras = pageExtras(page);
  const host = url.hostname.replace(/^www\./, "");
  const list = minor(v.compare_at_price);
  const price = minor(v.price)!;
  return {
    id: `store:${v.id}`,
    product_id: String(p.id),
    variant_id: String(v.id),
    handle: p.handle,
    title: p.title,
    variant_title: v.title && v.title !== "Default Title" ? v.title : null,
    description: text(p.body_html ?? "").slice(0, 500),
    options: p.options.map((o) => o.name),
    specs: [],
    price_minor: price,
    currency: extras.currency ?? "USD",
    list_price_minor: list && list > price ? list : null,
    photo: p.images[0]?.src ?? null,
    url: `${base}/products/${p.handle}`,
    checkout_url: `${base}/cart/${v.id}:1`,
    store: { name: host, domain: host, public_domain: host, url: base, refund_policy: refund ? `${base}/policies/refund-policy` : null, shipping_policy: null },
    rating: extras.rating,
  };
}

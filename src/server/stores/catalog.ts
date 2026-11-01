// Real products from real stores: Shopify's Global Catalog, searched over the Universal Commerce
// Protocol (https://shopify.dev/docs/agents/catalog/catalog-mcp). No API key; each request names the
// agent's UCP profile. These items have no ownership NFT; the shopper buys on the store's own checkout.
import { z } from "zod";

export const CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
// Shopify's published example profile, until VeriChainX hosts its own at a public URL.
const DEFAULT_PROFILE = "https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json";

export type StoreProduct = {
  id: string; // stable id for the agent: "store:<variant gid tail>"
  product_id: string;
  variant_id: string;
  handle: string | null;
  title: string;
  variant_title: string | null;
  description: string;
  // Option names ("Size", "Ships From") and the catalog's structured specs and features.
  options: string[];
  specs: string[];
  price_minor: number;
  currency: string;
  list_price_minor: number | null;
  photo: string | null;
  url: string | null;
  checkout_url: string;
  store: { name: string; domain: string; public_domain: string; url: string | null; refund_policy: string | null; shipping_policy: string | null };
  rating: { value: number; count: number } | null;
};

export type CatalogQuery = { query: string; maxPriceUsd?: number; shipsTo?: string; size?: string; limit?: number };

const money = z.object({ amount: z.number(), currency: z.string() });
const variant = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    url: z.string().nullish(),
    price: money,
    list_price: money.nullish(),
    checkout_url: z.string(),
    availability: z.object({ available: z.boolean().optional() }).passthrough().nullish(),
    seller: z
      .object({ name: z.string().nullish(), domain: z.string().nullish(), url: z.string().nullish(), links: z.array(z.object({ type: z.string().nullish(), url: z.string() }).passthrough()).nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();
const product = z
  .object({
    id: z.string(),
    title: z.string(),
    handle: z.string().nullish(),
    description: z.union([z.string(), z.object({ plain: z.string().nullish(), html: z.string().nullish() }).passthrough()]).nullish(),
    url: z.string().nullish(),
    media: z.array(z.object({ type: z.string().nullish(), url: z.string() }).passthrough()).nullish(),
    rating: z.object({ value: z.number(), count: z.number() }).passthrough().nullish(),
    options: z.array(z.object({ name: z.string() }).passthrough()).nullish(),
    metadata: z.object({ tech_specs: z.array(z.string()).nullish(), top_features: z.array(z.string()).nullish() }).passthrough().nullish(),
    variants: z.array(variant).nullish(),
  })
  .passthrough();

const host = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};
const clean = (u: string) => {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith("utm_") || k === "_gsid") url.searchParams.delete(k);
    return url.toString();
  } catch {
    return u;
  }
};
const tail = (gid: string) => gid.split("/").pop() ?? gid;
const plain = (d: z.infer<typeof product>["description"]) =>
  (typeof d === "string" ? d : (d?.plain ?? d?.html ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);

// Picks the variant in the shopper's size when there is one, else the cheapest available.
function pickVariant(variants: z.infer<typeof variant>[], size?: string) {
  const available = variants.filter((v) => v.availability?.available !== false);
  if (!available.length) return null;
  if (size) {
    const want = size.trim().toLowerCase();
    const sized = available.find((v) => (v.title ?? "").toLowerCase().split(/\s*[/|,-]\s*/).includes(want));
    if (sized) return sized;
  }
  return available.reduce((a, b) => (b.price.amount < a.price.amount ? b : a));
}

export function toStoreProduct(raw: unknown, size?: string): StoreProduct | null {
  const p = product.safeParse(raw);
  if (!p.success || !p.data.variants?.length) return null;
  const v = pickVariant(p.data.variants, size);
  if (!v) return null;
  const seller = v.seller ?? {};
  const domain = seller.domain ?? host(v.checkout_url) ?? "unknown";
  // The product link usually sits on the variant; drop the catalog's tracking parameters.
  const page = p.data.url ?? v.url ?? null;
  const link = (type: RegExp) => seller.links?.find((l) => type.test(l.type ?? l.url))?.url ?? null;
  return {
    id: `store:${tail(v.id)}`,
    product_id: p.data.id,
    variant_id: v.id,
    handle: p.data.handle ?? null,
    title: p.data.title,
    // Many stores repeat the product name as the variant title; only keep it when it says more.
    variant_title: v.title && v.title !== "Default Title" && !v.title.toLowerCase().includes(p.data.title.toLowerCase()) ? v.title : null,
    description: plain(p.data.description),
    options: (p.data.options ?? []).map((o) => o.name),
    specs: [...(p.data.metadata?.tech_specs ?? []), ...(p.data.metadata?.top_features ?? [])].slice(0, 12),
    price_minor: v.price.amount,
    currency: v.price.currency,
    list_price_minor: v.list_price && v.list_price.amount > v.price.amount ? v.list_price.amount : null,
    photo: p.data.media?.find((m) => !m.type || m.type === "image")?.url ?? null,
    url: page ? clean(page) : null,
    checkout_url: v.checkout_url,
    // The shop's own domain, as shoppers see it, comes from its product or checkout link; the catalog's
    // seller domain is often the *.myshopify.com one.
    store: {
      name: seller.name ?? domain,
      domain,
      public_domain: host(page) ?? host(v.checkout_url) ?? domain,
      url: seller.url ?? null,
      refund_policy: link(/refund|return/i),
      shipping_policy: link(/shipping/i),
    },
    rating: p.data.rating ? { value: p.data.rating.value, count: p.data.rating.count } : null,
  };
}

export async function searchCatalog(q: CatalogQuery, fetcher: typeof fetch = fetch): Promise<{ products: StoreProduct[]; total: number | null }> {
  const filters: Record<string, unknown> = { available: true };
  if (q.maxPriceUsd) filters.price = { max: Math.round(q.maxPriceUsd * 100) };
  if (q.shipsTo) filters.ships_to = { country: q.shipsTo.toUpperCase() };
  const res = await fetcher(CATALOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_catalog",
        arguments: {
          meta: { "ucp-agent": { profile: process.env.UCP_AGENT_PROFILE || DEFAULT_PROFILE } },
          catalog: {
            query: q.size ? `${q.query} size ${q.size}` : q.query,
            filters,
            context: { currency: "USD", ...(q.shipsTo ? { address_country: q.shipsTo.toUpperCase() } : {}) },
            pagination: { limit: Math.min(Math.max(q.limit ?? 8, 1), 20) },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Shopify catalog: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Shopify catalog: ${data.error.message ?? JSON.stringify(data.error)}`);
  const result = data.result ?? {};
  if (result.isError) throw new Error(`Shopify catalog: ${JSON.stringify(result.content).slice(0, 200)}`);
  const content = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
  const products = (content.products ?? []).map((p: unknown) => toStoreProduct(p, q.size)).filter(Boolean) as StoreProduct[];
  return { products, total: content.pagination?.total_count ?? null };
}

export function formatPrice(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
}

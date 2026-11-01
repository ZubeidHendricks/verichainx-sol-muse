import type { App } from "../app";

import { searchCatalog, type CatalogQuery, type StoreProduct } from "./catalog";
import { checkStore, type StoreCheck } from "./check";
import { storeFacts, type StoreFacts } from "./dropship";
import { storeScorecard, type Scorecard } from "./scorecard";

/**
 * Real stores next to the shops' agents: the shopper's agent searches Shopify's Global Catalog itself (stores
 * there have no agent of their own) and checks each one with the store rules. No NFT: these are bought on the
 * store's own checkout.
 */
export type StoreSearch = {
  search(q: CatalogQuery): Promise<{ products: StoreProduct[] }>;
  facts(p: StoreProduct): Promise<StoreFacts>;
  age?(domain: string): Promise<number | null>;
};

export const liveStoreSearch: StoreSearch = { search: (q) => searchCatalog(q), facts: (p) => storeFacts(p) };

export type StoreResult = {
  product: StoreProduct;
  recommendation: StoreCheck["recommendation"];
  reasons: string[];
  evidence: StoreCheck["evidence"];
  scorecard: Scorecard;
};

const ORDER = { recommended: 0, caution: 1, avoid: 2, excluded: 3 } as const;
const FILLER = new Set(["a", "an", "the", "for", "with", "and", "or", "of", "to", "in", "on", "my", "me", "i", "need", "want",
  "looking", "find", "get", "buy", "under", "below", "less", "than", "max", "around", "some", "something", "please", "can",
  "you", "show", "any", "do", "have", "is", "are", "it", "that", "this", "usd", "usdc", "dollars"]);

/** The product words of a shopper's message, or null when it isn't a request for something (a question, a reply). */
export function storeQuery(text: string): string | null {
  if (/\?\s*$/.test(text.trim())) return null;
  const words = (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter((w) => !FILLER.has(w));
  return words.length ? words.slice(0, 8).join(" ") : null;
}

/** Searches, checks every store, and ranks by label, then score. Errors (the catalog down) return nothing. */
export async function searchStores(app: App, text: string, budgetUsd?: number, limit = 4): Promise<StoreResult[]> {
  const stores = app.stores;
  const query = storeQuery(text);
  if (!stores || !query) return [];
  let products: StoreProduct[];
  try {
    products = (await stores.search({ query, maxPriceUsd: budgetUsd, limit: 8 })).products;
  } catch {
    return [];
  }
  const checked = await Promise.all(products.map(async (product) => ({
    product,
    check: await checkStore(app, product, { facts: (p) => stores.facts(p), age: stores.age }),
  })));
  return checked.map(({ product, check }) => {
    const peers = checked.filter((c) => c.product !== product && c.product.currency === product.currency).map((c) => c.product.price_minor);
    return { product, recommendation: check.recommendation, reasons: check.reasons, evidence: check.evidence,
      scorecard: storeScorecard(product, check, peers) };
  }).sort((a, b) => ORDER[a.recommendation] - ORDER[b.recommendation] || b.scorecard.overall - a.scorecard.overall)
    .slice(0, limit);
}

import { and, eq } from "drizzle-orm";

import { caip10, solanaChain } from "@/lib/chains";
import { needBody, newEnvelope, signEnvelope, verifyEnvelope, type Envelope } from "@/lib/envelope";
import { parseUsdc } from "@/lib/money";

import type { App } from "../app";
import { makeOffer, type Item, type Merchant } from "../catalog";
import { schema } from "../db";
import { unseal } from "../sealed";

const STOP = new Set(["a", "an", "the", "for", "with", "and", "or", "of", "to", "in", "on", "my", "me", "i", "need",
  "want", "looking", "find", "get", "buy", "under", "below", "less", "than", "max", "around", "some", "something"]);

export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((w) => !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(es|s)$/, ""));
}

/** How well an item matches a need: the share of the need's keywords found in the item's text. */
export function relevance(need: string, item: Pick<Item, "title" | "description">): number {
  const want = keywords(need);
  if (!want.length) return 0;
  const have = new Set(keywords(`${item.title} ${item.description}`));
  return want.filter((w) => have.has(w)).length / want.length;
}

function pitch(item: Item, m: Merchant): string {
  return `${item.title} from ${m.domain ?? m.name}. Registered at origin with an on-chain record; the ownership NFT moves to you in the same transaction as payment.`;
}

/**
 * §8.2: the merchant agents this host runs. Each answers a need from its own catalogue with signed
 * offers, or declines. Price and asset come from the database; only the pitch is free text.
 */
export async function answerNeed(app: App, need: Envelope): Promise<Envelope[]> {
  const v = verifyEnvelope(need, app.now());
  if (!v.ok && v.reason !== "unsigned") throw new Error(`need envelope: ${v.reason}`);
  const body = needBody.parse(need.body);
  const budget = body.budget ? parseUsdc(body.budget) : undefined;

  const rows = await app.db.select({ item: schema.items, merchant: schema.merchants })
    .from(schema.items).innerJoin(schema.merchants, eq(schema.items.merchantId, schema.merchants.id))
    .where(and(eq(schema.items.status, "listed")));

  const byMerchant = new Map<string, { merchant: Merchant; items: Item[] }>();
  for (const r of rows) {
    const e = byMerchant.get(r.merchant.id) ?? { merchant: r.merchant, items: [] };
    e.items.push(r.item);
    byMerchant.set(r.merchant.id, e);
  }

  const out: Envelope[] = [];
  const chain = solanaChain(app.config.cluster);
  for (const { merchant, items } of byMerchant.values()) {
    const fits = items
      .filter((i) => relevance(body.text, i) >= 0.5 && (budget === undefined || i.priceUnits <= budget))
      .sort((a, b) => relevance(body.text, b) - relevance(body.text, a))
      .slice(0, 2);
    if (!fits.length) {
      if (!merchant.agentSecretSealed) continue;
      out.push(signEnvelope(newEnvelope("decline", caip10(chain, merchant.agentPubkey),
        { reason: budget !== undefined && items.some((i) => relevance(body.text, i) >= 0.5) ? "over budget" : "nothing that fits",
          in_reply_to: need.id }, 15, app.now()), unseal(merchant.agentSecretSealed, app.config.sealSecret)));
      continue;
    }
    for (const item of fits) {
      const offer = await makeOffer(app, item.id, { pitch: pitch(item, merchant), inReplyTo: need.id });
      out.push(offer.envelope as Envelope);
    }
  }
  return out;
}

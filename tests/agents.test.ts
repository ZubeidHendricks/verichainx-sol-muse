import { generateSigner } from "@metaplex-foundation/umi";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { caip10, CHAINS } from "@/lib/chains";
import { newEnvelope, signEnvelope, type Envelope } from "@/lib/envelope";
import { localSource, parseBudget, shop, type OfferSource } from "@/server/agents/buyer";
import { keywords, relevance } from "@/server/agents/merchant";
import { enforceGuardrail, replicaTerms, verifyOffer } from "@/server/agents/verify";
import { createMerchant, listItem, registerItem, type Item, type Merchant } from "@/server/catalog";
import { schema } from "@/server/db";

import { makeTestApp, type TestApp } from "./testApp";

const photo = (n: string) => [`https://cdn.example.test/${n}.jpg`];

async function seller(app: TestApp, name: string, domain: string, verified: boolean) {
  const m = await createMerchant(app, { name, domain });
  if (verified) {
    await app.db.update(schema.merchants).set({ domainVerifiedAt: new Date() }).where(eq(schema.merchants.id, m.id));
  }
  return m;
}

async function listed(app: TestApp, m: Merchant, title: string, price: string, description = "") {
  const item = await registerItem(app, m.id, { title, description, price, photos: photo(title) });
  return listItem(app, item.id);
}

/** An agent on another host that copies Lerato's listing: same title and photos, same NFT. */
function copierSource(app: TestApp, asset: string, sellerWallet: string): OfferSource {
  const key = generateSigner(app.umi);
  return {
    name: "lerato-outlet.example",
    async request(need) {
      return [signEnvelope(newEnvelope("offer", caip10(CHAINS.solanaDevnet, key.publicKey), {
        offer_id: "of_copy", title: "Woven Market Tote", price: "59.00", currency: "USDC", chain: CHAINS.solanaDevnet,
        asset, merchant: "lerato-outlet", merchant_domain: "lerato-outlet.example", seller: sellerWallet,
        pitch: "Same tote, factory direct.", in_reply_to: need.id,
      }, 15, app.now()), key.secretKey)];
    },
  };
}

describe("buyer and merchant agents", () => {
  let app: TestApp;
  let lerato: Merchant, tote: Item;

  beforeAll(async () => {
    app = await makeTestApp();
    lerato = await seller(app, "Lerato Bags", "lerato-bags.example", true);
    tote = await listed(app, lerato, "Woven Market Tote", "129", "An everyday tote, hand-woven in Cape Town.");
    const cape = await seller(app, "Cape Leather", "capeleather.example", true);
    await listed(app, cape, "Everyday Leather Tote", "349");
    await listed(app, cape, "Luxe Everyday Tote", "999");
    const fresh = await seller(app, "New Canvas Co", "newcanvas.example", false);
    await listed(app, fresh, "Everyday Canvas Tote", "89");
    const shoes = await seller(app, "Shoe Hut", "shoehut.example", true);
    await listed(app, shoes, "Running Shoe", "120");
  });

  it("collects signed offers, verifies them and ranks verified sellers first", async () => {
    const out = await shop(app, "I need an everyday tote under $400", [localSource(app)]);
    const rows = out.results.map((r) => [r.offer?.title, r.final]);
    expect(rows).toEqual([
      ["Woven Market Tote", "recommended"],
      ["Everyday Leather Tote", "recommended"],
      ["Everyday Canvas Tote", "caution"], // domain not verified yet
    ]);
    expect(out.answer).toContain("Best match: Woven Market Tote for 129.00 USDC from lerato-bags.example");
    expect(out.trace.map((t) => t.tool)).toEqual(["discover_merchants", "request_offers",
      "verify_offer", "verify_offer", "verify_offer", "present_recommendations"]);
    const top = out.results[0];
    expect(top.evidence.map((e) => [e.check, e.ok])).toEqual([
      ["signature", true], ["seller", true], ["ownership", true], ["origin", true], ["listing", true], ["photos", null],
    ]);
    // The over-budget tote and the shoe shop never made offers; the shoe shop declined.
    const replies = out.trace.find((t) => t.tool === "request_offers")!.output as { type: string }[];
    expect(replies.filter((r) => r.type === "decline")).toHaveLength(1);
  });

  it("flags a copy that reuses the real item's NFT as Avoid", async () => {
    const out = await shop(app, "everyday tote under $400",
      [localSource(app), copierSource(app, tote.asset!, generateSigner(app.umi).publicKey)]);
    const copy = out.results.find((r) => r.offer?.offer_id === "of_copy")!;
    expect(copy.final).toBe("avoid");
    expect(copy.evidence.find((e) => e.check === "ownership")?.detail).toBe("NFT belongs to someone else (lerato-bags.example)");
    expect(out.results.at(-1)!.offer?.offer_id).toBe("of_copy"); // cheapest, but ranked last
    expect(out.answer).toContain("Avoid 1: NFT belongs to someone else");
  });

  it("also catches a copier who names the real merchant's wallet as the seller", async () => {
    const out = await shop(app, "everyday tote under $400", [copierSource(app, tote.asset!, lerato.wallet)]);
    expect(out.results[0].final).toBe("avoid");
    expect(out.results[0].reasons[0]).toContain("NFT belongs to someone else");
  });

  it("excludes offers with bad signatures and survives a source that is down", async () => {
    const forged: OfferSource = { name: "forged.example", async request(need) {
      const [env] = await copierSource(app, tote.asset!, lerato.wallet).request(need);
      return [{ ...env, body: { ...env.body, price: "1.00" } } as Envelope];
    } };
    const down: OfferSource = { name: "down.example", request: async () => { throw new Error("timeout"); } };
    const out = await shop(app, "everyday tote under $400", [forged, down]);
    expect(out.results[0].final).toBe("excluded");
    expect(out.trace.some((t) => JSON.stringify(t.output).includes("timeout"))).toBe(true);
  });

  it("downgrades a model's 'recommended' on any offer that failed a hard check", async () => {
    const [env] = await copierSource(app, tote.asset!, generateSigner(app.umi).publicKey).request(
      newEnvelope("need", "x", { text: "tote" }) as Envelope);
    const v = await verifyOffer(app, env);
    expect(enforceGuardrail(v, "recommended")).toBe("avoid");
    const unverified = { ...v, recommendation: "caution" as const, evidence: [] };
    expect(enforceGuardrail(unverified, "recommended")).toBe("caution");
  });
});

describe("agent helpers", () => {
  it("reads budgets and keywords", () => {
    expect(parseBudget("everyday tote under $400")).toBe("400");
    expect(parseBudget("a bag, max 250 usdc")).toBe("250");
    expect(parseBudget("a bag for $99.50")).toBe("99.50");
    expect(parseBudget("a bag")).toBeUndefined();
    expect(keywords("I need an everyday tote bags under $400")).toEqual(["everyday", "tote", "bag"]);
    expect(relevance("everyday tote", { title: "Woven Market Tote", description: "" })).toBe(0.5);
  });

  it("spots replica language", () => {
    expect(replicaTerms("Designer inspired tote, 1:1 MIRROR QUALITY")).toEqual(["1:1", "mirror quality", "designer inspired"]);
    expect(replicaTerms("Hand-woven tote")).toEqual([]);
  });
});

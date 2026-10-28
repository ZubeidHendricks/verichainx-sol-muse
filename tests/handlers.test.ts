import { signTransaction } from "@metaplex-foundation/umi";
import { beforeEach, describe, expect, it } from "vitest";

import { createMerchant, listItem, makeOffer, registerItem } from "@/server/catalog";
import { actionGet, actionPost, actionsJson, orderGet, payGet, payPost } from "@/server/handlers";

import { makeTestApp, type TestApp } from "./testApp";

const post = (body: unknown) => new Request("https://sol.example.test/x", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("Solana Pay and Actions endpoints", () => {
  let app: TestApp, offerId: string;

  beforeEach(async () => {
    app = await makeTestApp();
    const m = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
    const item = await registerItem(app, m.id, {
      title: "Woven Market Tote", description: "Hand-woven, brass maker's tag.", price: "129",
      photos: ["https://cdn.example.test/tote-1.jpg"],
    });
    await listItem(app, item.id);
    offerId = (await makeOffer(app, item.id)).id;
  });

  it("describes the offer as a Blink with live checks and Actions headers", async () => {
    const res = await actionGet(app, offerId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Blockchain-Ids")).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    const body = await res.json();
    expect(body).toMatchObject({ type: "action", title: "Woven Market Tote", label: "Buy for 129.00 USDC",
      icon: "https://cdn.example.test/tote-1.jpg" });
    expect(body.description).toContain("✓ Origin record matches");
    expect(body.description).toContain("✓ NFT is in the seller's wallet");
    expect(body.description).toContain("domain not verified yet");
    expect(body.disabled).toBeUndefined();
    expect(body.links.actions[0].href).toBe(`/api/actions/offer/${offerId}`);
  });

  it("buys through the Blink, then the order endpoint confirms it", async () => {
    const res = await actionPost(app, offerId, post({ account: app.buyer.publicKey }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("transaction");
    const tx = app.umi.transactions.deserialize(Buffer.from(body.transaction, "base64"));
    app.local.submit(await signTransaction(tx, [app.buyer]));
    const orderId = body.links.next.action.description.match(/Order (\S+)\./)[1];
    const order = await (await orderGet(app, orderId)).json();
    expect(order).toMatchObject({ status: "paid", buyer: app.buyer.publicKey });
    // Once sold, the Blink shows as disabled with the reason.
    const after = await (await actionGet(app, offerId)).json();
    expect(after.disabled).toBe(true);
    expect(after.error.message).toBe("item isn't listed");
  });

  it("serves Solana Pay with the same transaction shape", async () => {
    expect(await (await payGet(app, offerId)).json()).toMatchObject({ label: "lerato-bags.example · Woven Market Tote" });
    const body = await (await payPost(app, offerId, post({ account: app.buyer.publicKey }))).json();
    expect(body.message).toContain("129.00 USDC");
    expect(typeof body.transaction).toBe("string");
  });

  it("answers bad requests with a message, not a stack", async () => {
    expect((await payPost(app, offerId, post({}))).status).toBe(400);
    expect((await payPost(app, offerId, new Request("https://x.test", { method: "POST", body: "nope" }))).status).toBe(400);
    const missing = await actionGet(app, "of_missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "no offer of_missing" });
  });

  it("publishes actions.json rules", async () => {
    expect((await actionsJson(app).json()).rules[0]).toEqual({ pathPattern: "/o/*", apiPath: "/api/actions/offer/*" });
  });
});

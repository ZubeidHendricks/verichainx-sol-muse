import { generateSigner, signTransaction, transactionBuilder } from "@metaplex-foundation/umi";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { hashRecord } from "@/lib/canonical";
import { verifyEnvelope, type Envelope } from "@/lib/envelope";
import { parseUsdc } from "@/lib/money";
import { attribute } from "@/lib/solana/items";
import { memoInstruction } from "@/lib/solana/memo";
import { encodeMemo } from "@/lib/records";
import { orderMemo } from "@/lib/solana/purchase";
import {
  createMerchant, delistItem, domainProof, getItem, listItem, makeOffer, registerItem, registrationRecord, verifyDomain,
  type Item, type Merchant,
} from "@/server/catalog";
import { schema } from "@/server/db";
import { advanceOrder, refreshOrder, startPurchase, submitPurchase } from "@/server/pay";
import { verifyOffer } from "@/server/agents/verify";

import { makeTestApp, type TestApp } from "./testApp";

const PHOTOS = ["https://cdn.example.test/tote-1.jpg", "https://cdn.example.test/tote-2.jpg"];

describe("register, offer, pay, confirm", () => {
  let app: TestApp, merchant: Merchant, item: Item;

  beforeEach(async () => {
    app = await makeTestApp();
    merchant = await createMerchant(app, { name: "Lerato Bags", domain: "Lerato-Bags.example" });
    item = await registerItem(app, merchant.id, { title: "Woven Market Tote", price: "129", photos: PHOTOS });
    item = await listItem(app, item.id);
  });

  /** What the buyer's wallet does with the base64 transaction from Solana Pay or a Blink. */
  async function walletSigns(transaction: string, wallet = app.buyer) {
    const tx = app.umi.transactions.deserialize(Buffer.from(transaction, "base64"));
    app.local.submit(await signTransaction(tx, [wallet]));
  }

  it("registers the item with an origin record anyone can recompute", async () => {
    const onChain = app.local.asset(item.asset!);
    expect(onChain.owner).toBe(merchant.wallet);
    expect(attribute(onChain, "registration_hash")).toBe(item.registrationHash);
    expect(hashRecord(registrationRecord(merchant, item))).toBe(item.registrationHash);
    const [record] = await app.db.select().from(schema.records).where(eq(schema.records.sig, item.originSig!));
    expect(record.hash).toBe(item.registrationHash);
    expect(merchant.custody).toBe("vault");
    expect(merchant.domain).toBe("lerato-bags.example");
  });

  it("sells the item: one wallet signature, then the order confirms by reference", async () => {
    const offer = await makeOffer(app, item.id, { pitch: "Hand-woven, brass maker's tag." });
    expect(verifyEnvelope(offer.envelope)).toEqual({ ok: true });
    const start = await startPurchase(app, offer.id, app.buyer.publicKey);
    expect(start.message).toContain("129.00 USDC from lerato-bags.example");

    // The wallet asks twice (Solana Pay and Blink clients do): same pending order.
    const again = await startPurchase(app, offer.id, app.buyer.publicKey);
    expect(again.order.id).toBe(start.order.id);

    expect((await refreshOrder(app, start.order.id)).status).toBe("pending");
    await walletSigns(start.transaction);
    const paid = await refreshOrder(app, start.order.id);
    expect(paid.status).toBe("paid");
    expect(paid.events.map((e) => e.status)).toEqual(["pending", "paid"]);
    expect(app.local.asset(item.asset!).owner).toBe(app.buyer.publicKey);
    expect(app.local.tokenBalance(merchant.wallet, app.config.usdcMint)).toBe(parseUsdc("127.71"));
    expect((await getItem(app, item.id)).status).toBe("sold");
    await expect(startPurchase(app, offer.id, generateSigner(app.umi).publicKey)).rejects.toThrow("item isn't listed");

    // The seller ships, then delivers; each step is a memo on chain carrying the order's hash.
    await expect(advanceOrder(app, paid.id, "delivered")).rejects.toThrow("can't be marked delivered");
    const shipped = await advanceOrder(app, paid.id, "shipped");
    const delivered = await advanceOrder(app, paid.id, "delivered");
    expect(delivered.events.map((e) => e.status)).toEqual(["pending", "paid", "shipped", "delivered"]);
    const memos = app.local.history.flatMap((t) => t.memos);
    expect(memos).toContain(encodeMemo({ t: "order", o: paid.id, asset: item.asset!, s: "shipped", h: paid.orderHash }));
    expect(shipped.events.at(-1)?.sig).toBeTruthy();

    // The sale now counts toward the shop's history on its next offer.
    const next = await listItem(app, (await registerItem(app, merchant.id, { title: "Small Tote", price: "79", photos: PHOTOS })).id);
    const v = await verifyOffer(app, (await makeOffer(app, next.id)).envelope as Envelope);
    expect(v.evidence.find((e) => e.check === "history")).toMatchObject({ ok: true, detail: "1 completed sale; joined today" });
  });

  it("lets an agent pay from its own wallet for its owner, within a spending cap, relaying only this order's purchase", async () => {
    const offer = await makeOffer(app, item.id);
    const owner = generateSigner(app.umi).publicKey;
    await expect(startPurchase(app, offer.id, app.buyer.publicKey, { recipient: owner, maxPriceUnits: parseUsdc("100") }))
      .rejects.toThrow("over the spending cap of 100.00 USDC");
    const start = await startPurchase(app, offer.id, app.buyer.publicKey, { recipient: owner, maxPriceUnits: parseUsdc("150") });
    expect(start.message).toContain(`goes to ${owner}`);

    // Unsigned by the agent, or someone else's transaction: refused.
    await expect(submitPurchase(app, start.order.id, start.transaction)).rejects.toThrow("isn't fully signed");
    const other = await startPurchase(app, offer.id, app.buyer.publicKey);
    const tx = app.umi.transactions.deserialize(Buffer.from(other.transaction, "base64"));
    const otherSigned = Buffer.from(app.umi.transactions.serialize(await signTransaction(tx, [app.buyer]))).toString("base64");
    await expect(submitPurchase(app, start.order.id, otherSigned)).rejects.toThrow("isn't this order's purchase");

    const mine = app.umi.transactions.deserialize(Buffer.from(start.transaction, "base64"));
    const signed = Buffer.from(app.umi.transactions.serialize(await signTransaction(mine, [app.buyer]))).toString("base64");
    await submitPurchase(app, start.order.id, signed);
    const paid = await refreshOrder(app, start.order.id);
    expect(paid.status).toBe("paid");
    expect(app.local.asset(item.asset!).owner).toBe(owner);
  });

  it("adds seller risk for a new shop with no sales", async () => {
    const v = await verifyOffer(app, (await makeOffer(app, item.id)).envelope as Envelope);
    expect(v.evidence.find((e) => e.check === "history")).toMatchObject({ ok: null, detail: "no completed sales yet; joined today" });
    expect(v.seller_risk).toBe(30); // unverified domain 20, new shop 10
  });

  it("ignores a transaction that only mentions the reference", async () => {
    const offer = await makeOffer(app, item.id);
    const { order } = await startPurchase(app, offer.id, app.buyer.publicKey);
    // Someone posts our memo text in their own transaction that touches the reference key.
    const fake = memoInstruction("spoof", [app.buyer]).add(transactionBuilder([{
      instruction: { programId: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo" as never,
        keys: [{ pubkey: order.reference as never, isSigner: false, isWritable: false }],
        data: new TextEncoder().encode(orderMemo({
          orderId: order.id, asset: item.asset!, merchant: merchant.wallet, buyer: order.buyerWallet,
          usdcMint: app.config.usdcMint, treasury: app.config.treasury, price: offer.priceUnits, feeBps: 100,
          reference: order.reference, orderHash: order.orderHash,
        })) },
      signers: [], bytesCreatedOnChain: 0 }]));
    await app.chain.send(fake.setFeePayer(app.buyer));
    expect((await app.chain.findByReference(order.reference))).toHaveLength(1);
    expect((await refreshOrder(app, order.id)).status).toBe("pending"); // the NFT never moved
  });

  it("refuses expired, tampered and delisted offers, and bad accounts", async () => {
    const offer = await makeOffer(app, item.id);
    await expect(startPurchase(app, offer.id, "not-an-address")).rejects.toThrow("Solana address");
    await expect(startPurchase(app, offer.id, merchant.wallet)).rejects.toThrow("own item");

    const env = offer.envelope as Envelope;
    await app.db.update(schema.offers).set({ envelope: { ...env, body: { ...env.body, price: "1.00" } } })
      .where(eq(schema.offers.id, offer.id));
    await expect(startPurchase(app, offer.id, app.buyer.publicKey)).rejects.toThrow("bad signature");

    const cheap = await makeOffer(app, item.id);
    await app.db.update(schema.offers).set({ priceUnits: 1n }).where(eq(schema.offers.id, cheap.id));
    await expect(startPurchase(app, cheap.id, app.buyer.publicKey)).rejects.toThrow("doesn't match");

    const fresh = await makeOffer(app, item.id);
    app.clock.now = new Date(app.clock.now.getTime() + 16 * 60_000);
    await expect(startPurchase(app, fresh.id, app.buyer.publicKey)).rejects.toThrow("expired");

    app.clock.now = new Date();
    const last = await makeOffer(app, item.id);
    await delistItem(app, item.id);
    await expect(startPurchase(app, last.id, app.buyer.publicKey)).rejects.toThrow("isn't listed");
  });

  it("stops a copier whose own signed offer points at someone else's asset", async () => {
    // The copier's database row claims Lerato's asset, and the copier's agent signs a valid offer for it.
    const copier = await createMerchant(app, { name: "Copy Shop", domain: "lerato-bags-outlet.example" });
    await app.db.update(schema.items).set({ merchantId: copier.id }).where(eq(schema.items.id, item.id));
    const offer = await makeOffer(app, item.id);
    expect(verifyEnvelope(offer.envelope)).toEqual({ ok: true });
    // The chain says Lerato's wallet holds the NFT, so the service won't sign a sale paying the copier.
    await expect(startPurchase(app, offer.id, app.buyer.publicKey)).rejects.toThrow("NFT belongs to someone else");
    expect(app.local.tokenBalance(copier.wallet, app.config.usdcMint)).toBe(0n);
  });
});

describe("domain verification", () => {
  it("verifies a domain whose TXT record names the merchant's wallet", async () => {
    const app = await makeTestApp();
    const m = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
    const proof = domainProof(m);
    expect(proof).toEqual({ name: "_vcx.lerato-bags.example", value: `vcx-verify=${m.wallet}` });
    await expect(verifyDomain(app, m.id, async () => { throw new Error("ENOTFOUND"); })).rejects.toThrow("no TXT record");
    await expect(verifyDomain(app, m.id, async () => [["vcx-verify=someone-else"]])).rejects.toThrow("should be");
    // Long TXT values arrive split into chunks.
    const v = await verifyDomain(app, m.id, async () => [["v=spf1 -all"], [proof.value.slice(0, 20), proof.value.slice(20)]]);
    expect(v.domainVerifiedAt).not.toBeNull();
  });
});

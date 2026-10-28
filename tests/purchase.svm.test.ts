import { generateSigner, signTransaction, type Signer } from "@metaplex-foundation/umi";
import { beforeEach, describe, expect, it } from "vitest";

import { hashRecord } from "@/lib/canonical";
import { parseUsdc } from "@/lib/money";
import { attribute, buildDelistItem, buildListItem, buildMerchantCollection, buildRegisterItem, ownershipCheck }
  from "@/lib/solana/items";
import { buildPurchase, preparePurchase, type PurchaseTerms } from "@/lib/solana/purchase";
import { decodeMemo } from "@/lib/records";

import { LocalChain } from "./svm";

/**
 * Runs the real programs (SPL Token, ATA, Memo and mainnet Metaplex Core) in LiteSVM, so these tests
 * show what the chain accepts, not just what we build.
 */
describe("purchase on a local chain", () => {
  let chain: LocalChain;
  let k: Record<"feePayer" | "settlement" | "anchor" | "vault" | "merchant" | "buyer" | "treasury" | "copier", Signer>;
  let usdc: string, collection: string, asset: string;
  const registrationHash = hashRecord({ title: "Woven Market Tote", photos: ["p1", "p2"] });

  beforeEach(async () => {
    chain = new LocalChain();
    const u = chain.umi;
    k = {
      feePayer: generateSigner(u), settlement: generateSigner(u), anchor: generateSigner(u), vault: generateSigner(u),
      merchant: generateSigner(u), buyer: generateSigner(u), treasury: generateSigner(u), copier: generateSigner(u),
    };
    chain.fund(k.feePayer, k.anchor, k.merchant, k.buyer, k.copier);
    usdc = await chain.createUsdc(k.feePayer, [
      { owner: k.buyer.publicKey, amount: parseUsdc("500") }, { owner: k.treasury.publicKey, amount: 0n },
    ]);
    const col = generateSigner(u);
    await chain.send(buildMerchantCollection(u, {
      collection: col, name: "Lerato Bags", uri: "https://example.test/c.json", updateAuthority: k.vault, payer: k.feePayer,
    }), k.feePayer);
    collection = col.publicKey;
    const a = generateSigner(u);
    const register = buildRegisterItem(u, {
      asset: a, collection, collectionAuthority: k.vault, payer: k.feePayer, anchor: k.anchor,
      owner: k.merchant.publicKey, name: "Woven Market Tote #a1", uri: "https://example.test/a1.json",
      registrationHash, merchant: "lerato", merchantDomain: "lerato-bags.example",
    });
    // Indexers read the record from the memo instruction's data, so that is what we check.
    const memo = register.getInstructions().at(-1)!;
    expect(decodeMemo(new TextDecoder().decode(memo.data))).toEqual({
      t: "origin", asset: a.publicKey, h: registrationHash, m: "lerato",
    });
    expect(memo.keys).toEqual([{ pubkey: k.anchor.publicKey, isSigner: true, isWritable: false }]);
    await chain.send(register, k.feePayer);
    asset = a.publicKey;
    await chain.send(buildListItem(u, {
      asset: { publicKey: asset }, collection, owner: k.merchant, settlement: k.settlement.publicKey, payer: k.feePayer,
    }), k.feePayer);
  });

  const terms = (over: Partial<PurchaseTerms> = {}): PurchaseTerms => ({
    orderId: "ord_1", asset, collection, merchant: k.merchant.publicKey, buyer: k.buyer.publicKey, usdcMint: usdc,
    treasury: k.treasury.publicKey, price: parseUsdc("129"), feeBps: 100, reference: generateSigner(chain.umi).publicKey,
    orderHash: "cd".repeat(32), ...over,
  });

  async function buy(t: PurchaseTerms, wallet: Signer = k.buyer) {
    const { tx } = await preparePurchase(chain.umi, t, k.feePayer, k.settlement, chain.blockhash(), chain.asset(t.asset));
    return chain.submit(await signTransaction(tx, [wallet])); // the wallet adds the last signature
  }

  it("registers the item with its origin record and lists it", () => {
    const a = chain.asset(asset);
    expect(a.owner).toBe(k.merchant.publicKey);
    expect(attribute(a, "registration_hash")).toBe(registrationHash);
    expect(ownershipCheck(a, [k.merchant.publicKey], k.settlement.publicKey)).toEqual({ ok: true });
  });

  it("moves USDC, the fee and the NFT in one transaction", async () => {
    await buy(terms());
    expect(chain.asset(asset).owner).toBe(k.buyer.publicKey);
    expect(chain.tokenBalance(k.merchant.publicKey, usdc)).toBe(parseUsdc("127.71"));
    expect(chain.tokenBalance(k.treasury.publicKey, usdc)).toBe(parseUsdc("1.29"));
    expect(chain.tokenBalance(k.buyer.publicKey, usdc)).toBe(parseUsdc("371"));
    // Core hands the transfer delegate back to the new owner, so the service can't move it again.
    const after = chain.asset(asset);
    expect(ownershipCheck(after, [k.merchant.publicKey], k.settlement.publicKey))
      .toEqual({ ok: false, reason: "NFT belongs to someone else" });
    await expect(buy(terms({ orderId: "ord_2", merchant: k.buyer.publicKey }), k.copier)).rejects.toThrow();
  });

  it("does nothing at all when the buyer can't pay", async () => {
    await expect(buy(terms({ price: parseUsdc("501") }))).rejects.toThrow(/transaction failed/);
    expect(chain.asset(asset).owner).toBe(k.merchant.publicKey);
    expect(chain.tokenBalance(k.merchant.publicKey, usdc)).toBe(0n);
    expect(chain.tokenBalance(k.buyer.publicKey, usdc)).toBe(parseUsdc("500"));
  });

  it("can't sell a delisted item", async () => {
    await chain.send(buildDelistItem(chain.umi, { asset, collection, owner: k.merchant, payer: k.feePayer }), k.feePayer);
    expect(ownershipCheck(chain.asset(asset), [k.merchant.publicKey], k.settlement.publicKey))
      .toEqual({ ok: false, reason: "item isn't listed for sale" });
    await expect(buy(terms())).rejects.toThrow("item isn't listed for sale");
    // Unlike the copy case, the chain enforces this one too: the delegate is gone.
    const raw = buildPurchase(chain.umi, terms(), k.feePayer, k.settlement).setBlockhash(chain.blockhash()).build(chain.umi);
    const signed = await signTransaction(raw, [k.feePayer, k.settlement, k.buyer]);
    expect(() => chain.submit(signed)).toThrow(/transaction failed/);
  });

  it("a copier can't get paid for someone else's item", async () => {
    // The service refuses to sign: the asset's on-chain owner isn't the merchant being paid.
    const t = terms({ merchant: k.copier.publicKey });
    await expect(buy(t)).rejects.toThrow("NFT belongs to someone else");
    expect(chain.asset(asset).owner).toBe(k.merchant.publicKey);
  });

  it("the chain alone would accept that copy, which is why the owner check exists", async () => {
    // Core lets the transfer delegate move a listed asset whoever is paid.
    const t = terms({ merchant: k.copier.publicKey });
    const raw = buildPurchase(chain.umi, t, k.feePayer, k.settlement).setBlockhash(chain.blockhash()).build(chain.umi);
    chain.submit(await signTransaction(raw, [k.feePayer, k.settlement, k.buyer]));
    expect(chain.asset(asset).owner).toBe(k.buyer.publicKey);
    expect(chain.tokenBalance(k.copier.publicKey, usdc)).toBe(parseUsdc("127.71"));
  });

  it("supports resale: the new owner lists and sells on, and the origin record travels", async () => {
    await buy(terms());
    const next = generateSigner(chain.umi);
    await chain.mintUsdc(usdc, k.feePayer, next.publicKey, parseUsdc("200"));
    await chain.send(buildListItem(chain.umi, {
      asset: chain.asset(asset), collection, owner: k.buyer, settlement: k.settlement.publicKey, payer: k.feePayer,
    }), k.feePayer);
    await buy(terms({ orderId: "ord_r", merchant: k.buyer.publicKey, buyer: next.publicKey, price: parseUsdc("200") }), next);
    expect(chain.asset(asset).owner).toBe(next.publicKey);
    expect(chain.tokenBalance(k.buyer.publicKey, usdc)).toBe(parseUsdc("371") + parseUsdc("198"));
    expect(chain.tokenBalance(k.treasury.publicKey, usdc)).toBe(parseUsdc("3.29"));
    expect(attribute(chain.asset(asset), "registration_hash")).toBe(registrationHash);
  });
});

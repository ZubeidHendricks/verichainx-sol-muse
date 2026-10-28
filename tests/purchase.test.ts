import { generateSigner, publicKey, type Signer } from "@metaplex-foundation/umi";
import { transferTokensChecked, findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import { describe, expect, it } from "vitest";

import { parseUsdc } from "@/lib/money";
import { decodeMemo } from "@/lib/records";
import {
  TemplateMismatch,
  assertPurchaseTemplate,
  buildPurchase,
  preparePurchase,
  type CurrentAsset,
  type PurchaseTerms,
} from "@/lib/solana/purchase";
import { memoInstruction } from "@/lib/solana/memo";
import { makeUmi } from "@/lib/solana/umi";

const umi = makeUmi("http://127.0.0.1:8899"); // building and signing never touch the network
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const key = () => generateSigner(umi).publicKey as string;

function setup(overrides: Partial<PurchaseTerms> = {}) {
  const feePayer = generateSigner(umi);
  const settlement = generateSigner(umi);
  const terms: PurchaseTerms = {
    orderId: "ord_1", asset: key(), collection: key(), merchant: key(), buyer: key(), usdcMint: key(),
    treasury: key(), price: parseUsdc("129.00"), feeBps: 100, reference: key(), orderHash: "ab".repeat(32),
    ...overrides,
  };
  return { feePayer, settlement, terms };
}

/** The asset as the chain would report it right before signing. */
const listed = (s: ReturnType<typeof setup>, over: Partial<CurrentAsset> = {}): CurrentAsset => ({
  publicKey: publicKey(s.terms.asset),
  owner: publicKey(s.terms.merchant),
  transferDelegate: { authority: { type: "Address", address: s.settlement.publicKey }, offset: 0n },
  updateAuthority: s.terms.collection ? { type: "Collection", address: publicKey(s.terms.collection) } : { type: "None" },
  ...over,
} as CurrentAsset);

const check = (s: ReturnType<typeof setup>, msg = buildPurchase(umi, s.terms, s.feePayer, s.settlement)
  .setBlockhash(BLOCKHASH).build(umi).message) =>
  assertPurchaseTemplate(umi, msg, s.terms, s.feePayer.publicKey, s.settlement.publicKey);

describe("purchase transaction", () => {
  it("pays the merchant and the fee, moves the NFT and records the order in one transaction", async () => {
    const s = setup();
    const { transaction, tx } = await preparePurchase(umi, s.terms, s.feePayer, s.settlement, BLOCKHASH, listed(s));
    const programs = tx.message.instructions.map((ix) => tx.message.accounts[ix.programIndex]);
    expect(programs).toEqual([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
      "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
    ]);
    // 1% of 129 USDC goes to the treasury.
    const amounts = tx.message.instructions.slice(1, 3).map((ix) =>
      new DataView(ix.data.buffer, ix.data.byteOffset + 1, 8).getBigUint64(0, true));
    expect(amounts).toEqual([127_710_000n, 1_290_000n]);
    // The reference key rides on the merchant transfer, read-only and unsigned, for Solana Pay.
    expect(tx.message.instructions[1].accountIndexes.map((i) => tx.message.accounts[i])).toContain(s.terms.reference);
    expect(decodeMemo(new TextDecoder().decode(tx.message.instructions[4].data))).toMatchObject({
      t: "order", o: "ord_1", asset: s.terms.asset, s: "paid",
    });
    // Fee payer and settlement key have signed; the buyer's slot is left for their wallet.
    const signed = tx.signatures.map((sig) => sig.some((b) => b !== 0));
    const order = tx.message.accounts.slice(0, tx.message.header.numRequiredSignatures);
    expect(Object.fromEntries(order.map((k, i) => [k, signed[i]]))).toEqual({
      [s.feePayer.publicKey]: true, [s.settlement.publicKey]: true, [s.terms.buyer]: false,
    });
    expect(umi.transactions.deserialize(Buffer.from(transaction, "base64")).message.blockhash).toBe(BLOCKHASH);
  });

  it("drops the fee leg when the fee is zero and adds a priority fee when asked", () => {
    const s = setup({ feeBps: 0, priorityMicroLamports: 5_000n });
    const msg = buildPurchase(umi, s.terms, s.feePayer, s.settlement).setBlockhash(BLOCKHASH).build(umi).message;
    expect(msg.instructions).toHaveLength(5);
    expect(() => check(s, msg)).not.toThrow();
  });

  it("works for an asset outside a collection", () => {
    expect(() => check(setup({ collection: undefined }))).not.toThrow();
  });
});

describe("owner check before signing", () => {
  it.each([
    ["the NFT is in another wallet", { owner: publicKey(key()) }, /someone else/],
    ["the item isn't listed", { transferDelegate: undefined }, /isn't listed/],
    ["someone else is the delegate", { transferDelegate: { authority: { type: "Address", address: publicKey(key()) } } }, /isn't listed/],
    ["the asset is in another collection", { updateAuthority: { type: "Collection", address: publicKey(key()) } }, /collection/],
    ["the read is of another asset", { publicKey: publicKey(key()) }, /asset read/],
  ])("refuses to sign when %s", async (_label, over, why) => {
    const s = setup();
    await expect(preparePurchase(umi, s.terms, s.feePayer, s.settlement, BLOCKHASH, listed(s, over as Partial<CurrentAsset>)))
      .rejects.toThrow(why);
  });
});

describe("settlement key template guard", () => {
  const tamper = (s: ReturnType<typeof setup>, edit: (t: PurchaseTerms) => PurchaseTerms) => {
    const msg = buildPurchase(umi, edit(s.terms), s.feePayer, s.settlement).setBlockhash(BLOCKHASH).build(umi).message;
    return () => check(s, msg);
  };

  it.each([
    ["a lower price", (t: PurchaseTerms) => ({ ...t, price: t.price - 1n })],
    ["a different asset", (t: PurchaseTerms) => ({ ...t, asset: key() })],
    ["a different recipient", (t: PurchaseTerms) => ({ ...t, merchant: key() })],
    ["a different buyer", (t: PurchaseTerms) => ({ ...t, buyer: key() })],
    ["no fee", (t: PurchaseTerms) => ({ ...t, feeBps: 0 })],
    ["a different order", (t: PurchaseTerms) => ({ ...t, orderId: "ord_2" })],
    ["another mint", (t: PurchaseTerms) => ({ ...t, usdcMint: key() })],
  ])("refuses %s", (_label, edit) => {
    expect(tamper(setup(), edit)).toThrow(TemplateMismatch);
  });

  it("refuses an extra instruction that spends from the fee payer", () => {
    const s = setup();
    const drain = transferTokensChecked(umi, {
      source: findAssociatedTokenPda(umi, { owner: s.feePayer.publicKey, mint: publicKey(s.terms.usdcMint) }),
      mint: publicKey(s.terms.usdcMint), destination: publicKey(key()), authority: s.feePayer as Signer,
      amount: 1n, decimals: 6,
    });
    const msg = buildPurchase(umi, s.terms, s.feePayer, s.settlement).add(drain).setBlockhash(BLOCKHASH).build(umi).message;
    expect(() => check(s, msg)).toThrow(/extra instructions/);
  });

  it("refuses a second memo or a memo the settlement key signs", () => {
    const s = setup();
    const msg = buildPurchase(umi, s.terms, s.feePayer, s.settlement)
      .add(memoInstruction("hello", [s.settlement]))
      .setBlockhash(BLOCKHASH).build(umi).message;
    expect(() => check(s, msg)).toThrow(TemplateMismatch);
  });

  it("refuses a message paid for by someone else", () => {
    const s = setup();
    const other = generateSigner(umi);
    const msg = buildPurchase(umi, s.terms, other, s.settlement).setBlockhash(BLOCKHASH).build(umi).message;
    expect(() => check(s, msg)).toThrow(/fee payer/);
  });
});

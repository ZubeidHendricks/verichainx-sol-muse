import {
  createNoopSigner,
  publicKey,
  signTransaction,
  transactionBuilder,
  type Context,
  type PublicKey,
  type Signer,
  type Transaction,
  type TransactionMessage,
} from "@metaplex-foundation/umi";
import { MPL_CORE_PROGRAM_ID, transferV1, type AssetV1 } from "@metaplex-foundation/mpl-core";
import {
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_COMPUTE_BUDGET_PROGRAM_ID,
  SPL_MEMO_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  createIdempotentAssociatedToken,
  findAssociatedTokenPda,
  setComputeUnitPrice,
  transferTokensChecked,
} from "@metaplex-foundation/mpl-toolbox";

import { USDC_DECIMALS, splitPrice } from "../money";
import { ownershipCheck } from "./items";
import { memoInstruction } from "./memo";
import { encodeMemo, type OrderMemo } from "../records";

/** Everything a purchase is built from. All of it comes from the database, never from the LLM or the client. */
export type PurchaseTerms = {
  orderId: string;
  asset: string;
  collection?: string;
  merchant: string; // current owner of the asset and the USDC recipient
  buyer: string; // pays the USDC and signs
  /** Who gets the NFT, when not the buyer: a bot pays from its own wallet for its owner. */
  recipient?: string;
  usdcMint: string;
  treasury: string;
  price: bigint; // USDC base units
  feeBps: number;
  reference: string; // Solana Pay reference key
  orderHash: string;
  priorityMicroLamports?: bigint; // mainnet only
};

type Umi = Pick<Context, "eddsa" | "programs" | "payer" | "identity" | "transactions">;

function ata(umi: Umi, owner: string, mint: string): PublicKey {
  return findAssociatedTokenPda(umi, { owner: publicKey(owner), mint: publicKey(mint) })[0];
}

export function orderMemo(t: PurchaseTerms): string {
  const memo: OrderMemo = { t: "order", o: t.orderId, asset: t.asset, s: "paid", h: t.orderHash };
  return encodeMemo(memo);
}

/** §7.4: one transaction that pays the merchant, pays the fee and moves the NFT, or does nothing. */
export function buildPurchase(umi: Umi, t: PurchaseTerms, feePayer: Signer, settlement: Signer) {
  const buyer = createNoopSigner(publicKey(t.buyer));
  const mint = publicKey(t.usdcMint);
  const { merchant: toMerchant, fee } = splitPrice(t.price, t.feeBps);

  let b = transactionBuilder().setFeePayer(feePayer).useV0();
  if (t.priorityMicroLamports) b = b.add(setComputeUnitPrice(umi, { microLamports: t.priorityMicroLamports }));
  b = b
    .add(createIdempotentAssociatedToken(umi, {
      payer: feePayer, ata: ata(umi, t.merchant, t.usdcMint), owner: publicKey(t.merchant), mint,
    }))
    .add(transferTokensChecked(umi, {
      source: ata(umi, t.buyer, t.usdcMint), mint, destination: ata(umi, t.merchant, t.usdcMint),
      authority: buyer, amount: toMerchant, decimals: USDC_DECIMALS,
    }).addRemainingAccounts({ pubkey: publicKey(t.reference), isSigner: false, isWritable: false }));
  if (fee > 0n) {
    b = b.add(transferTokensChecked(umi, {
      source: ata(umi, t.buyer, t.usdcMint), mint, destination: ata(umi, t.treasury, t.usdcMint),
      authority: buyer, amount: fee, decimals: USDC_DECIMALS,
    }));
  }
  return b
    .add(transferV1(umi, {
      asset: publicKey(t.asset),
      collection: t.collection ? publicKey(t.collection) : undefined,
      payer: feePayer,
      authority: settlement,
      newOwner: publicKey(t.recipient ?? t.buyer),
    }))
    .add(memoInstruction(orderMemo(t)));
}

export class TemplateMismatch extends Error {}

const TRANSFER_CHECKED = 12;
const CREATE_IDEMPOTENT = 1;
const CORE_TRANSFER_V1 = 14;
const SET_CU_PRICE = 3;

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

/**
 * §7.4 / §15: the settlement key signs only a message that is exactly the purchase template for these
 * terms. This decodes the compiled message independently of the builder, so a builder bug can't slip
 * an extra transfer past it.
 */
export function assertPurchaseTemplate(
  umi: Umi, msg: TransactionMessage, t: PurchaseTerms, feePayer: string, settlement: string,
): void {
  const fail = (why: string): never => { throw new TemplateMismatch(why); };
  if (msg.addressLookupTables.length) fail("lookup tables are not allowed");
  if (msg.accounts[0] !== feePayer) fail("unexpected fee payer");

  const { numRequiredSignatures: nSig, numReadonlySignedAccounts: nRoSig } = msg.header;
  const signers = msg.accounts.slice(0, nSig);
  const expectedSigners = new Set([feePayer, settlement, t.buyer]);
  if (signers.length !== expectedSigners.size || !signers.every((s) => expectedSigners.has(s))) {
    fail("unexpected signers");
  }
  const settlementIdx = msg.accounts.indexOf(publicKey(settlement));
  if (settlementIdx < nSig - nRoSig) fail("settlement key must be read-only");

  const ixs = msg.instructions.map((ix) => ({
    program: msg.accounts[ix.programIndex],
    accounts: ix.accountIndexes.map((i) => msg.accounts[i]),
    data: ix.data,
  }));
  const usesSettlement = ixs.filter((ix) => ix.accounts.includes(publicKey(settlement)));
  if (usesSettlement.length !== 1 || usesSettlement[0].program !== MPL_CORE_PROGRAM_ID) {
    fail("settlement key used outside the NFT transfer");
  }

  const { merchant: toMerchant, fee } = splitPrice(t.price, t.feeBps);
  const buyerAta = ata(umi, t.buyer, t.usdcMint);
  const merchantAta = ata(umi, t.merchant, t.usdcMint);
  const next = (() => { let i = 0; return () => ixs[i++] ?? fail("missing instruction"); })();
  let ix = next();

  if (ix.program === SPL_COMPUTE_BUDGET_PROGRAM_ID) {
    if (ix.data[0] !== SET_CU_PRICE || ix.data.length !== 9) fail("only a compute unit price is allowed");
    if (u64(ix.data, 1) > 1_000_000n) fail("priority fee too high");
    ix = next();
  }

  if (ix.program !== SPL_ASSOCIATED_TOKEN_PROGRAM_ID || ix.data[0] !== CREATE_IDEMPOTENT) fail("expected merchant ATA");
  if (ix.accounts[0] !== feePayer || ix.accounts[1] !== merchantAta || ix.accounts[2] !== t.merchant
      || ix.accounts[3] !== t.usdcMint) fail("merchant ATA accounts");

  const checkTransfer = (dest: PublicKey, amount: bigint, withReference: boolean) => {
    ix = next();
    if (ix.program !== SPL_TOKEN_PROGRAM_ID || ix.data[0] !== TRANSFER_CHECKED || ix.data.length !== 10) {
      fail("expected a USDC transfer");
    }
    if (u64(ix.data, 1) !== amount || ix.data[9] !== USDC_DECIMALS) fail("wrong USDC amount");
    const want = [buyerAta, t.usdcMint, dest, t.buyer, ...(withReference ? [t.reference] : [])];
    if (ix.accounts.length !== want.length || ix.accounts.some((a, i) => a !== want[i])) fail("USDC transfer accounts");
  };
  checkTransfer(merchantAta, toMerchant, true);
  if (fee > 0n) checkTransfer(ata(umi, t.treasury, t.usdcMint), fee, false);

  ix = next();
  if (ix.program !== MPL_CORE_PROGRAM_ID || ix.data[0] !== CORE_TRANSFER_V1) fail("expected the NFT transfer");
  const collection = t.collection ?? MPL_CORE_PROGRAM_ID;
  if (ix.accounts[0] !== t.asset || ix.accounts[1] !== collection || ix.accounts[2] !== feePayer
      || ix.accounts[3] !== settlement || ix.accounts[4] !== (t.recipient ?? t.buyer)) fail("NFT transfer accounts");

  ix = next();
  if (ix.program !== SPL_MEMO_PROGRAM_ID || ix.accounts.length
      || new TextDecoder().decode(ix.data) !== orderMemo(t)) fail("order memo");
  if (ixs.indexOf(ix) !== ixs.length - 1) fail("extra instructions");
}

export type CurrentAsset = Pick<AssetV1, "publicKey" | "owner" | "transferDelegate" | "updateAuthority">;

/**
 * Builds the purchase, checks it against the template, and signs it as fee payer and settlement key.
 * The buyer's signature slot is left empty for their wallet. Returns the base64 transaction for
 * Solana Pay and Actions.
 *
 * `current` must be read from the chain just before this call. The chain does not tie the NFT leg to
 * the USDC leg: Core lets the transfer delegate move a listed asset whoever is paid, and the
 * settlement key is the delegate on every listed asset. So this owner check is what stops a copier
 * from being paid for someone else's item.
 */
export async function preparePurchase(
  umi: Umi, t: PurchaseTerms, feePayer: Signer, settlement: Signer, blockhash: string, current: CurrentAsset,
): Promise<{ transaction: string; tx: Transaction }> {
  if (current.publicKey !== t.asset) throw new TemplateMismatch("asset read doesn't match the offer");
  const owned = ownershipCheck(current, [t.merchant], settlement.publicKey);
  if (!owned.ok) throw new TemplateMismatch(owned.reason);
  const ua = current.updateAuthority;
  const onChainCollection = ua.type === "Collection" ? ua.address : undefined;
  if (onChainCollection !== t.collection) throw new TemplateMismatch("collection doesn't match the asset");
  const built = buildPurchase(umi, t, feePayer, settlement).setBlockhash(blockhash).build(umi);
  assertPurchaseTemplate(umi, built.message, t, feePayer.publicKey, settlement.publicKey);
  const tx = await signTransaction(built, [feePayer, settlement]);
  return { transaction: Buffer.from(umi.transactions.serialize(tx)).toString("base64"), tx };
}

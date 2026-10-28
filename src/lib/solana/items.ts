import { publicKey, type Context, type Signer } from "@metaplex-foundation/umi";
import {
  addPlugin,
  approvePluginAuthority,
  create,
  createCollection,
  revokePluginAuthority,
  type AssetV1,
} from "@metaplex-foundation/mpl-core";

import { memoInstruction } from "./memo";
import { encodeMemo } from "../records";

type Umi = Pick<Context, "eddsa" | "programs" | "payer" | "identity">;

/** §7.2: one Core collection per merchant, named after the store. */
export function buildMerchantCollection(umi: Umi, a: {
  collection: Signer; name: string; uri: string; updateAuthority: Signer; payer: Signer;
}) {
  return createCollection(umi, {
    collection: a.collection, name: a.name, uri: a.uri, updateAuthority: a.updateAuthority.publicKey, payer: a.payer,
  });
}

/**
 * §7.2–7.3: mints the item to the merchant and anchors its origin record in the same transaction.
 * The memo is signed by the anchoring key, so the record's transaction signature doubles as its id.
 */
export function buildRegisterItem(umi: Umi, a: {
  asset: Signer; collection: string; collectionAuthority: Signer; payer: Signer; anchor: Signer;
  owner: string; name: string; uri: string; registrationHash: string; merchant: string; merchantDomain: string;
}) {
  return create(umi, {
    asset: a.asset,
    collection: { publicKey: publicKey(a.collection), oracles: [], lifecycleHooks: [] },
    authority: a.collectionAuthority,
    payer: a.payer,
    owner: publicKey(a.owner),
    name: a.name,
    uri: a.uri,
    plugins: [{
      type: "Attributes",
      attributeList: [
        { key: "registration_hash", value: a.registrationHash },
        { key: "merchant", value: a.merchant },
        { key: "merchant_domain", value: a.merchantDomain },
      ],
    }],
  }).add(memoInstruction(
    encodeMemo({ t: "origin", asset: a.asset.publicKey, h: a.registrationHash, m: a.merchant }),
    [a.anchor],
  ));
}

/**
 * §7.2: listing hands the transfer delegate to the settlement key, so a sale can move the NFT without
 * the merchant's key. Core resets the delegate to the new owner on transfer.
 */
export function buildListItem(umi: Umi, a: {
  asset: AssetV1 | { publicKey: string; transferDelegate?: unknown }; collection?: string; owner: Signer;
  settlement: string; payer: Signer;
}) {
  const args = {
    asset: publicKey(a.asset.publicKey),
    collection: a.collection ? publicKey(a.collection) : undefined,
    authority: a.owner,
    payer: a.payer,
  };
  const authority = { type: "Address" as const, address: publicKey(a.settlement) };
  return a.asset.transferDelegate
    ? approvePluginAuthority(umi, { ...args, plugin: { type: "TransferDelegate" }, newAuthority: authority })
    : addPlugin(umi, { ...args, plugin: { type: "TransferDelegate", authority } });
}

export function buildDelistItem(umi: Umi, a: { asset: string; collection?: string; owner: Signer; payer: Signer }) {
  return revokePluginAuthority(umi, {
    asset: publicKey(a.asset),
    collection: a.collection ? publicKey(a.collection) : undefined,
    authority: a.owner,
    payer: a.payer,
    plugin: { type: "TransferDelegate" },
  });
}

export function attribute(asset: AssetV1, key: string): string | undefined {
  return asset.attributes?.attributeList.find((x) => x.key === key)?.value;
}

/** §9 ownership check: the asset is the merchant's and the sale delegate is ours. */
export function ownershipCheck(asset: Pick<AssetV1, "owner" | "transferDelegate">, merchantWallets: string[], settlement: string):
  { ok: true } | { ok: false; reason: string } {
  if (!merchantWallets.includes(asset.owner)) return { ok: false, reason: "NFT belongs to someone else" };
  const d = asset.transferDelegate?.authority;
  if (!d || d.type !== "Address" || d.address !== settlement) return { ok: false, reason: "item isn't listed for sale" };
  return { ok: true };
}

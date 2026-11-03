import { createNoopSigner, createSignerFromKeypair, generateSigner, publicKey, signTransaction, type Signer } from "@metaplex-foundation/umi";
import type { AssetV1 } from "@metaplex-foundation/mpl-core";
import { and, eq, sum } from "drizzle-orm";

import { hashRecord } from "@/lib/canonical";
import { caip10, solanaChain } from "@/lib/chains";
import { newEnvelope, signEnvelope, verifyEnvelope, type Envelope, type OfferBody } from "@/lib/envelope";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { buildDelistItem, buildListItem, buildMerchantCollection, buildRegisterItem, buildRegisterLot } from "@/lib/solana/items";

import { newId, type App } from "./app";
import { fingerprintPhotos } from "./photos";
import { schema } from "./db";
import { seal, unseal } from "./sealed";

const { merchants, items, offers } = schema;
export type Merchant = typeof merchants.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Offer = typeof offers.$inferSelect;

export class NotFound extends Error {}
export class Refused extends Error {}

function keypairSigner(app: App, secret: Uint8Array): Signer {
  return createSignerFromKeypair(app.umi, app.umi.eddsa.createKeypairFromSecretKey(secret));
}

function sealedSecret(app: App, sealed: string | null, what: string): Uint8Array {
  if (!sealed) throw new Refused(`the service doesn't hold this merchant's ${what} key`);
  return unseal(sealed, app.config.sealSecret);
}

export function sealedSigner(app: App, sealed: string | null, what: string): Signer {
  return keypairSigner(app, sealedSecret(app, sealed, what));
}

/** Name of the shop resale opens for a buyer's wallet; naming a shop later takes it over. */
const resaleName = (wallet: string) => `Resale · ${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

/**
 * Onboards a merchant (§5.1). Without their own wallet they get a vault key of their own (devnet
 * only), never a shared one, so on-chain ownership still tells merchants apart.
 *
 * One shop per wallet: the ownership check finds the shop that holds an NFT by its wallet. A wallet that so far
 * only resells takes on the new name and domain instead of getting a second shop.
 */
export async function createMerchant(app: App, m: { name: string; domain?: string; wallet?: string; ownerWallet?: string }): Promise<Merchant> {
  if (m.wallet) {
    const [existing] = await app.db.select().from(merchants).where(eq(merchants.wallet, m.wallet));
    if (existing && existing.name !== resaleName(m.wallet)) {
      throw new Refused(`This wallet already runs ${existing.name}. Each shop needs its own wallet.`);
    }
    if (existing) {
      const [row] = await app.db.update(merchants).set({ name: m.name, domain: m.domain?.toLowerCase() ?? null, domainVerifiedAt: null })
        .where(eq(merchants.id, existing.id)).returning();
      return row;
    }
  }
  const agent = generateSigner(app.umi);
  const vault = m.wallet ? null : generateSigner(app.umi);
  if (vault && app.config.cluster === "mainnet") throw new Refused("vault custody is devnet-only");
  const [row] = await app.db.insert(merchants).values({
    id: newId("m"),
    name: m.name,
    domain: m.domain?.toLowerCase(),
    wallet: m.wallet ?? vault!.publicKey,
    custody: vault ? "vault" : "own_wallet",
    vaultSecretSealed: vault ? seal(vault.secretKey, app.config.sealSecret) : null,
    agentPubkey: agent.publicKey,
    agentSecretSealed: seal(agent.secretKey, app.config.sealSecret),
    ownerWallet: m.ownerWallet ?? m.wallet ?? null,
  }).returning();
  return row;
}

export async function getMerchant(app: App, id: string): Promise<Merchant> {
  const [m] = await app.db.select().from(merchants).where(eq(merchants.id, id));
  if (!m) throw new NotFound(`no merchant ${id}`);
  return m;
}

/** The DNS TXT record a merchant publishes at `_vcx.<domain>` to prove the domain is theirs (§5.2). */
export function domainProof(m: Pick<Merchant, "domain" | "wallet">) {
  return { name: `_vcx.${m.domain}`, value: `vcx-verify=${m.wallet}` };
}

/** Marks the merchant's domain verified if its TXT record names their wallet. `lookup` is DNS in the app. */
export async function verifyDomain(app: App, merchantId: string,
  lookup: (name: string) => Promise<string[][]> = (n) => import("node:dns/promises").then((d) => d.resolveTxt(n))): Promise<Merchant> {
  const m = await getMerchant(app, merchantId);
  if (!m.domain) throw new Refused("add a domain first");
  const proof = domainProof(m);
  let records: string[][];
  try {
    records = await lookup(proof.name);
  } catch {
    throw new Refused(`no TXT record found at ${proof.name}`);
  }
  if (!records.some((chunks) => chunks.join("").trim() === proof.value)) {
    throw new Refused(`the TXT record at ${proof.name} should be ${proof.value}`);
  }
  const [row] = await app.db.update(merchants).set({ domainVerifiedAt: app.now() }).where(eq(merchants.id, m.id)).returning();
  return row;
}

export async function getItem(app: App, id: string): Promise<Item> {
  const [i] = await app.db.select().from(items).where(eq(items.id, id));
  if (!i) throw new NotFound(`no item ${id}`);
  return i;
}

/** The full origin record; its hash goes on the asset and in the origin memo (§7.3). */
export function registrationRecord(m: Merchant, i: Pick<Item, "title" | "description" | "priceUnits" | "photos" | "fingerprint">) {
  return {
    v: 1,
    merchant: m.id,
    merchant_domain: m.domain,
    title: i.title,
    description: i.description,
    origin_price: formatUsdc(i.priceUnits),
    photos: i.photos,
    fingerprint: i.fingerprint ?? null,
  };
}

/** §5.2: creates the item, mints its Core asset to the merchant and anchors the origin record. */
export async function registerItem(app: App, merchantId: string, input: {
  title: string; description?: string; price: string; photos: string[]; fingerprint?: unknown;
}): Promise<Item> {
  const m = await getMerchant(app, merchantId);
  // Photo fingerprints go into the origin record, so its hash on the NFT covers them.
  const prints = input.fingerprint === undefined && app.images && input.photos.length
    ? await fingerprintPhotos(input.photos, app.images) : [];
  const draft = {
    title: input.title, description: input.description ?? "", priceUnits: parseUsdc(input.price),
    photos: input.photos, fingerprint: input.fingerprint ?? (prints.length ? { photos: prints } : null),
  };
  const registrationHash = hashRecord(registrationRecord(m, draft));
  const { feePayer, anchor } = app.keys;

  let collection = m.collectionAsset;
  if (!collection) {
    const col = generateSigner(app.umi);
    await app.chain.send(buildMerchantCollection(app.umi, {
      collection: col, name: m.name, uri: `${app.config.appUrl}/api/meta/collection/${m.id}`,
      updateAuthority: anchor, payer: feePayer,
    }).setFeePayer(feePayer));
    collection = col.publicKey;
    await app.db.update(merchants).set({ collectionAsset: collection }).where(eq(merchants.id, m.id));
  }

  const id = newId("it");
  const asset = generateSigner(app.umi);
  const originSig = await app.chain.send(buildRegisterItem(app.umi, {
    asset, collection, collectionAuthority: anchor, payer: feePayer, anchor, owner: m.wallet,
    name: `${input.title} #${id.slice(-6)}`.slice(0, 32), uri: `${app.config.appUrl}/api/meta/item/${id}`,
    registrationHash, merchant: m.id, merchantDomain: m.domain ?? "",
  }).setFeePayer(feePayer));

  const [row] = await app.db.insert(items).values({
    id, merchantId: m.id, asset: asset.publicKey, ...draft, registrationHash, originSig, status: "draft",
  }).returning();
  await app.db.insert(schema.records).values({
    sig: originSig, kind: "origin", payload: registrationRecord(m, draft), hash: registrationHash,
  });
  return row;
}

/** Units of an item still free to order: its stock less lots minted but not yet paid for. Null if one of a kind. */
export async function availableUnits(app: App, item: Item): Promise<number | null> {
  if (item.stock === null) return null;
  const [r] = await app.db.select({ n: sum(items.quantity) }).from(items)
    .where(and(eq(items.lotOf, item.id), eq(items.status, "listed")));
  return Math.max(0, item.stock - Number(r?.n ?? 0));
}

/**
 * Mints a lot of `quantity` units of an item, listed and priced at unit price × quantity, for a bulk order. It is
 * an item of its own (and gets its own signed offer), but shoppers never see it: shop agents only pitch items.
 */
export async function createLot(app: App, itemId: string, quantity: number): Promise<Item> {
  const item = await getItem(app, itemId);
  if (item.lotOf) throw new Refused("that's already a lot");
  if (item.status !== "listed") throw new Refused(`${item.title} isn't listed`);
  const free = await availableUnits(app, item);
  if (free === null) throw new Refused(`${item.title} is one of a kind, so it can't be ordered by quantity`);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Refused("quantity must be a whole number");
  if (quantity > free) throw new Refused(`${item.title}: ${free} available, ${quantity} asked for`);
  const m = await getMerchant(app, item.merchantId);
  if (!m.collectionAsset || !item.registrationHash) throw new Refused("the item has no origin record");
  const id = newId("it");
  const asset = generateSigner(app.umi);
  const { feePayer, anchor, settlement } = app.keys;
  await app.chain.send(buildRegisterLot(app.umi, {
    asset, collection: m.collectionAsset, collectionAuthority: anchor, payer: feePayer, owner: m.wallet,
    name: `${item.title} ×${quantity}`.slice(0, 32), uri: `${app.config.appUrl}/api/meta/item/${id}`,
    registrationHash: item.registrationHash, merchant: m.id, merchantDomain: m.domain ?? "", lotOf: item.asset!, quantity,
    settlement: settlement.publicKey,
  }).setFeePayer(feePayer));
  const [row] = await app.db.insert(items).values({
    id, merchantId: m.id, asset: asset.publicKey, title: `${item.title} ×${quantity}`, description: item.description,
    priceUnits: item.priceUnits * BigInt(quantity), photos: item.photos, fingerprint: item.fingerprint,
    registrationHash: item.registrationHash, originSig: item.originSig, status: "listed", lotOf: item.id, quantity,
  }).returning();
  return row;
}

/** Lists an item: the settlement key becomes its transfer delegate (§7.2). Vault custody only, for now. */
export async function listItem(app: App, itemId: string): Promise<Item> {
  const item = await getItem(app, itemId);
  const m = await getMerchant(app, item.merchantId);
  const owner = sealedSigner(app, m.vaultSecretSealed, "vault");
  const asset = await app.chain.getAsset(item.asset!);
  if (!asset || asset.owner !== m.wallet) throw new Refused("the merchant no longer holds this item");
  await app.chain.send(buildListItem(app.umi, {
    asset, collection: assetCollection(asset), owner, settlement: app.keys.settlement.publicKey,
    payer: app.keys.feePayer,
  }).setFeePayer(app.keys.feePayer));
  const [row] = await app.db.update(items).set({ status: "listed" }).where(eq(items.id, itemId)).returning();
  return row;
}

export async function delistItem(app: App, itemId: string): Promise<Item> {
  const item = await getItem(app, itemId);
  const m = await getMerchant(app, item.merchantId);
  await app.chain.send(buildDelistItem(app.umi, {
    asset: item.asset!, collection: m.collectionAsset ?? undefined,
    owner: sealedSigner(app, m.vaultSecretSealed, "vault"), payer: app.keys.feePayer,
  }).setFeePayer(app.keys.feePayer));
  const [row] = await app.db.update(items).set({ status: "delisted" }).where(eq(items.id, itemId)).returning();
  return row;
}

/** The collection an asset belongs to, read from the asset: a resold item stays in its maker's collection. */
export function assetCollection(asset: Pick<AssetV1, "updateAuthority">): string | undefined {
  return asset.updateAuthority.type === "Collection" ? asset.updateAuthority.address : undefined;
}

/** Whether a signed-in wallet may manage this shop. Demo vault shops with no owner are open when MERCHANT_DEMO=1. */
export function manages(m: Merchant, wallet: string | null, demo = process.env.MERCHANT_DEMO === "1"): boolean {
  return m.ownerWallet ? m.ownerWallet === wallet : demo;
}

/**
 * Own-wallet shops (§7.5): the list or delist transaction, built and signed here by the fee payer,
 * for the shop's wallet to sign in the browser. Only the asset's owner can approve the delegate.
 */
export async function prepareOwnerTx(app: App, itemId: string, action: "list" | "delist", wallet: string): Promise<string> {
  const item = await getItem(app, itemId);
  const m = await getMerchant(app, item.merchantId);
  if (m.custody !== "own_wallet" || m.wallet !== wallet) throw new Refused("only the shop's own wallet can do this");
  const asset = await app.chain.getAsset(item.asset!);
  if (!asset || asset.owner !== wallet) throw new Refused("this wallet no longer holds the item");
  const owner = createNoopSigner(publicKey(wallet));
  const { feePayer, settlement } = app.keys;
  const builder = action === "list"
    ? buildListItem(app.umi, { asset, collection: assetCollection(asset), owner, settlement: settlement.publicKey, payer: feePayer })
    : buildDelistItem(app.umi, { asset: asset.publicKey, collection: assetCollection(asset), owner, payer: feePayer });
  const b = builder.setFeePayer(feePayer).setBlockhash(await app.chain.latestBlockhash());
  const tx = await signTransaction(b.build(app.umi), [feePayer]);
  return Buffer.from(app.umi.transactions.serialize(tx)).toString("base64");
}

/** Reads the item's listing state from the chain, after the shop's wallet sent a list or delist. */
export async function syncItem(app: App, itemId: string): Promise<Item> {
  const item = await getItem(app, itemId);
  const m = await getMerchant(app, item.merchantId);
  const asset = await app.chain.getAsset(item.asset!);
  const d = asset?.transferDelegate?.authority;
  const listed = asset?.owner === m.wallet && d?.type === "Address" && d.address === app.keys.settlement.publicKey;
  const status = listed ? "listed" : item.status === "listed" ? "delisted" : item.status;
  if (status === item.status) return item;
  const [row] = await app.db.update(items).set({ status }).where(eq(items.id, itemId)).returning();
  return row;
}

/** Items a wallet bought here and still holds: what it can resell (§5 story 7). */
export async function heldItems(app: App, wallet: string): Promise<Item[]> {
  const rows = await app.db.select({ item: items, merchant: merchants }).from(schema.orders)
    .innerJoin(offers, eq(schema.orders.offerId, offers.id))
    .innerJoin(items, eq(offers.itemId, items.id))
    .innerJoin(merchants, eq(items.merchantId, merchants.id))
    .where(and(eq(schema.orders.buyerWallet, wallet), eq(schema.orders.status, "paid")));
  const out = new Map<string, Item>();
  for (const { item, merchant } of rows) {
    if (merchant.wallet === wallet) continue; // already moved into this wallet's own shop
    const asset = await app.chain.getAsset(item.asset!);
    if (asset?.owner === wallet) out.set(item.id, item);
  }
  return [...out.values()];
}

/**
 * Resale: the holder's wallet gets an own-wallet shop (made on first resale) and the item moves into
 * it at the new price, as a draft. Listing it is then signed by the holder like any own-wallet item.
 * The origin record stays the maker's: it's on the NFT.
 */
export async function startResale(app: App, itemId: string, wallet: string, price: string): Promise<Item> {
  const item = await getItem(app, itemId);
  const asset = await app.chain.getAsset(item.asset!);
  if (!asset || asset.owner !== wallet) throw new Refused("this wallet doesn't hold the item");
  let [shop] = await app.db.select().from(merchants).where(eq(merchants.wallet, wallet));
  shop ??= await createMerchant(app, { name: resaleName(wallet), wallet });
  const [row] = await app.db.update(items).set({ merchantId: shop.id, priceUnits: parseUsdc(price), status: "draft" })
    .where(eq(items.id, itemId)).returning();
  return row;
}

/** A signed offer from the merchant's agent (§8.2). Price and asset come from the database. */
export async function makeOffer(app: App, itemId: string, extra: { pitch?: string; inReplyTo?: string } = {}): Promise<Offer> {
  const item = await getItem(app, itemId);
  if (item.status !== "listed") throw new Refused("item isn't listed");
  const m = await getMerchant(app, item.merchantId);
  const chain = solanaChain(app.config.cluster);
  const id = newId("of");
  const body: OfferBody = {
    offer_id: id, title: item.title, price: formatUsdc(item.priceUnits), currency: "USDC", chain,
    asset: item.asset!, merchant: m.id, merchant_domain: m.domain ?? undefined, seller: m.wallet, pitch: extra.pitch,
    image: item.photos[0], pay_url: `${app.config.appUrl}/api/pay/${id}`,
    action_url: `${app.config.appUrl}/api/actions/offer/${id}`, in_reply_to: extra.inReplyTo,
  };
  const env = signEnvelope(newEnvelope("offer", caip10(chain, m.agentPubkey), body, app.config.offerTtlMinutes, app.now()),
    sealedSecret(app, m.agentSecretSealed, "agent"));
  const [row] = await app.db.insert(offers).values({
    id, itemId, merchantId: m.id, priceUnits: item.priceUnits, expiresAt: new Date(env.expires_at), envelope: env,
  }).returning();
  return row;
}

/** Re-checks a stored offer against its signature and the database before any money moves (§15). */
export function checkOffer(app: App, offer: Offer, item: Item, m: Merchant): void {
  if (offer.expiresAt.getTime() <= app.now().getTime()) throw new Refused("offer expired");
  const env = offer.envelope as Envelope;
  const v = verifyEnvelope(env, app.now());
  if (!v.ok) throw new Refused(`offer signature: ${v.reason}`);
  if (env.from !== caip10(solanaChain(app.config.cluster), m.agentPubkey)) throw new Refused("offer not from this merchant's agent");
  const body = env.body as OfferBody;
  if (body.offer_id !== offer.id || body.asset !== item.asset || parseUsdc(body.price) !== offer.priceUnits
      || offer.priceUnits !== item.priceUnits) throw new Refused("offer doesn't match the listing");
  if (item.status !== "listed") throw new Refused("item isn't listed");
}

export async function loadOffer(app: App, offerId: string) {
  const [offer] = await app.db.select().from(offers).where(eq(offers.id, offerId));
  if (!offer) throw new NotFound(`no offer ${offerId}`);
  const item = await getItem(app, offer.itemId);
  const merchant = await getMerchant(app, offer.merchantId);
  return { offer, item, merchant };
}

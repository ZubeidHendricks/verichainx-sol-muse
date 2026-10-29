import { createSignerFromKeypair, generateSigner, type Signer } from "@metaplex-foundation/umi";
import { eq } from "drizzle-orm";

import { hashRecord } from "@/lib/canonical";
import { caip10, solanaChain } from "@/lib/chains";
import { newEnvelope, signEnvelope, verifyEnvelope, type Envelope, type OfferBody } from "@/lib/envelope";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { buildDelistItem, buildListItem, buildMerchantCollection, buildRegisterItem } from "@/lib/solana/items";

import { newId, type App } from "./app";
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

function sealedSigner(app: App, sealed: string | null, what: string): Signer {
  return keypairSigner(app, sealedSecret(app, sealed, what));
}

/**
 * Onboards a merchant (§5.1). Without their own wallet they get a vault key of their own (devnet
 * only), never a shared one, so on-chain ownership still tells merchants apart.
 */
export async function createMerchant(app: App, m: { name: string; domain?: string; wallet?: string }): Promise<Merchant> {
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
  const draft = {
    title: input.title, description: input.description ?? "", priceUnits: parseUsdc(input.price),
    photos: input.photos, fingerprint: input.fingerprint ?? null,
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

/** Lists an item: the settlement key becomes its transfer delegate (§7.2). Vault custody only, for now. */
export async function listItem(app: App, itemId: string): Promise<Item> {
  const item = await getItem(app, itemId);
  const m = await getMerchant(app, item.merchantId);
  const owner = sealedSigner(app, m.vaultSecretSealed, "vault");
  const asset = await app.chain.getAsset(item.asset!);
  if (!asset || asset.owner !== m.wallet) throw new Refused("the merchant no longer holds this item");
  await app.chain.send(buildListItem(app.umi, {
    asset, collection: m.collectionAsset ?? undefined, owner, settlement: app.keys.settlement.publicKey,
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

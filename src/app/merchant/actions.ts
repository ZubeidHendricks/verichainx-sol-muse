"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { getApp, type App } from "@/server/app";
import { SESSION_COOKIE, sessionAddress } from "@/server/auth";
import {
  Refused, createMerchant, delistItem, getItem, getMerchant, listItem, manages, prepareOwnerTx, registerItem,
  startResale, syncItem, verifyDomain,
} from "@/server/catalog";
import { importProducts, shopifyConfig } from "@/server/shopify";

export type ActionState = { error?: string; done?: string; transaction?: string };

/** The signed-in wallet (§11.4). Server Actions are plain POSTs, so every one checks it. */
async function session(app: App): Promise<string> {
  const address = sessionAddress(app, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!address) throw new Refused("Sign in with your wallet first.");
  return address;
}

async function managedShop(app: App, merchantId: string) {
  const [wallet, m] = await Promise.all([session(app), getMerchant(app, merchantId)]);
  if (!manages(m, wallet)) throw new Refused("This shop is managed by another wallet.");
  return { wallet, m };
}

async function run(fn: (app: App) => Promise<ActionState | void>, done?: string): Promise<ActionState> {
  try {
    const out = await fn(await getApp());
    refresh();
    return out ?? { done };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    return { error: `That didn't go through: ${(e as Error).message.split("\n")[0].slice(0, 160)}` };
  }
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const PRICE = /^\d+(\.\d{1,2})?$/;

export async function addShop(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = text(fd, "name");
  const domain = text(fd, "domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!name) return { error: "Give the shop a name." };
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { error: "The domain should look like yourshop.com." };
  const vault = fd.get("custody") === "vault";
  return run(async (app) => {
    const wallet = await session(app);
    if (vault && process.env.MERCHANT_DEMO !== "1") throw new Refused("A service-held wallet is only available in the devnet demo.");
    await createMerchant(app, vault
      ? { name, domain: domain || undefined, ownerWallet: wallet }
      : { name, domain: domain || undefined, wallet });
  }, `Added ${name}.`);
}

export async function addItem(merchantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const title = text(fd, "title");
  const price = text(fd, "price");
  if (!title) return { error: "Give the item a title." };
  if (!PRICE.test(price) || Number(price) <= 0) return { error: "Price should be a number of USDC, like 129 or 49.50." };
  const photos = text(fd, "photos").split(/\s+/).filter((u) => /^https:\/\//.test(u)).slice(0, 4);
  return run(async (app) => {
    const { m } = await managedShop(app, merchantId);
    const item = await registerItem(app, m.id, { title, description: text(fd, "description"), price, photos });
    if (fd.get("list") === "on" && m.custody === "vault") await listItem(app, item.id);
  }, `Registered ${title}.`);
}

/** Vault shops list and delist here. Own-wallet shops get the transaction back for their wallet to sign. */
export async function setListing(itemId: string, action: "list" | "delist"): Promise<ActionState> {
  return run(async (app) => {
    const item = await getItem(app, itemId);
    const { wallet, m } = await managedShop(app, item.merchantId);
    if (m.custody === "own_wallet") return { transaction: await prepareOwnerTx(app, itemId, action, wallet) };
    await (action === "list" ? listItem(app, itemId) : delistItem(app, itemId));
    return { done: action === "list" ? "Listed." : "Delisted." };
  });
}

/** After the wallet sent a list or delist: read the result back from the chain. */
export async function confirmListing(itemId: string): Promise<ActionState> {
  return run(async (app) => {
    const item = await getItem(app, itemId);
    await managedShop(app, item.merchantId);
    const row = await syncItem(app, itemId);
    return { done: row.status === "listed" ? "Listed." : row.status === "delisted" ? "Delisted." : "Saved." };
  });
}

export async function resell(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const price = text(fd, "price");
  if (!PRICE.test(price) || Number(price) <= 0) return { error: "Price should be a number of USDC, like 150." };
  return run(async (app) => {
    const wallet = await session(app);
    await startResale(app, itemId, wallet, price);
    return { transaction: await prepareOwnerTx(app, itemId, "list", wallet) };
  });
}

export async function importShopify(merchantId: string): Promise<ActionState> {
  return run(async (app) => {
    const { m } = await managedShop(app, merchantId);
    const cfg = shopifyConfig();
    if (!cfg || !m.shopifyShop) throw new Refused("This shop isn't connected to Shopify.");
    const added = await importProducts(app, cfg, m);
    return { done: added.length ? `Registered ${added.join(", ")}.` : "No new products." };
  });
}

export async function checkDomain(merchantId: string): Promise<ActionState> {
  return run(async (app) => {
    await managedShop(app, merchantId);
    await verifyDomain(app, merchantId);
  }, "Domain verified.");
}

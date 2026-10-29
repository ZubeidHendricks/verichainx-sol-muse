"use server";

import { refresh } from "next/cache";

import { getApp } from "@/server/app";
import { Refused, createMerchant, delistItem, listItem, registerItem, verifyDomain } from "@/server/catalog";

export type ActionState = { error?: string; done?: string };

/**
 * Merchant actions spend the fee payer's SOL (minting, listing), so they only run when MERCHANT_DEMO=1
 * until Sign In With Solana ties each action to the merchant's wallet (§5.2).
 */
async function guard<T>(run: () => Promise<T>, done: string): Promise<ActionState> {
  if (process.env.MERCHANT_DEMO !== "1") return { error: "Selling is switched off here. Set MERCHANT_DEMO=1 to try it on devnet." };
  try {
    await run();
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    return { error: `That didn't go through: ${(e as Error).message.split("\n")[0].slice(0, 160)}` };
  }
  refresh();
  return { done };
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addShop(_: ActionState, fd: FormData): Promise<ActionState> {
  const name = text(fd, "name");
  const domain = text(fd, "domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!name) return { error: "Give the shop a name." };
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { error: "The domain should look like yourshop.com." };
  return guard(async () => createMerchant(await getApp(), { name, domain: domain || undefined }), `Added ${name}.`);
}

export async function addItem(merchantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const title = text(fd, "title");
  const price = text(fd, "price");
  if (!title) return { error: "Give the item a title." };
  if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0) return { error: "Price should be a number of USDC, like 129 or 49.50." };
  const photos = text(fd, "photos").split(/\s+/).filter((u) => /^https:\/\//.test(u)).slice(0, 4);
  return guard(async () => {
    const app = await getApp();
    const item = await registerItem(app, merchantId, { title, description: text(fd, "description"), price, photos });
    if (fd.get("list") === "on") await listItem(app, item.id);
  }, `Registered ${title}${fd.get("list") === "on" ? " and listed it" : ""}.`);
}

export async function list(itemId: string): Promise<ActionState> {
  return guard(async () => listItem(await getApp(), itemId), "Listed.");
}

export async function delist(itemId: string): Promise<ActionState> {
  return guard(async () => delistItem(await getApp(), itemId), "Delisted.");
}

export async function checkDomain(merchantId: string): Promise<ActionState> {
  return guard(async () => verifyDomain(await getApp(), merchantId), "Domain verified.");
}

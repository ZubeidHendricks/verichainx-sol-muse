"use server";

import { refresh } from "next/cache";

import { getApp } from "@/server/app";
import { Refused } from "@/server/catalog";
import { redeemClaim } from "@/server/shopify";

export type ClaimState = { error?: string; signature?: string };

export async function claim(claimId: string, token: string, _: ClaimState, fd: FormData): Promise<ClaimState> {
  try {
    const out = await redeemClaim(await getApp(), claimId, token, String(fd.get("email") ?? ""), String(fd.get("address") ?? "").trim());
    refresh();
    return { signature: out.signature };
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    console.error(e);
    return { error: "The transfer didn't go through. Try again in a minute." };
  }
}

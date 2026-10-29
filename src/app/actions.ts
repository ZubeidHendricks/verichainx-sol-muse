"use server";

import { redirect } from "next/navigation";

import { getApp } from "@/server/app";
import { makeOffer } from "@/server/catalog";

/** A new signed offer for a listed item, when the old one has expired. Anyone may ask, as with the agent. */
export async function freshOffer(itemId: string) {
  const offer = await makeOffer(await getApp(), itemId);
  redirect(`/o/${offer.id}`);
}

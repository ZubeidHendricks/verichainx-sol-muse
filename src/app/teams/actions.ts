"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { getApp, type App } from "@/server/app";
import { NotFound, Refused } from "@/server/catalog";
import {
  addMember, approveCard, castVote, createCompany, getCompany, inviteKey, memberFromToken, memberToken, moveCard, procure, teamCookie,
  topUp, updatePolicy, type Member, type Vote,
} from "@/server/procure";

export type TeamState = { error?: string; done?: string };

const YEAR = 60 * 60 * 24 * 365;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function remember(app: App, m: Member) {
  (await cookies()).set(teamCookie(m.companyId), memberToken(app, m), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR, secure: app.config.appUrl.startsWith("https://"),
  });
}

/** The member this browser is, for this company. Server Actions are plain POSTs, so every one checks it. */
async function me(app: App, companyId: string): Promise<Member> {
  const m = await memberFromToken(app, companyId, (await cookies()).get(teamCookie(companyId))?.value);
  if (!m) throw new Refused("Join this company's board first: ask a teammate for the invite link.");
  return m;
}

async function run(fn: (app: App) => Promise<TeamState | void>, done?: string): Promise<TeamState> {
  try {
    const out = await fn(await getApp());
    refresh();
    return out ?? { done };
  } catch (e) {
    if (e instanceof Refused || e instanceof NotFound) return { error: e.message };
    console.error(e);
    return { error: `That didn't go through: ${(e as Error).message.split("\n")[0].slice(0, 160)}` };
  }
}

export async function startCompany(_: TeamState, fd: FormData): Promise<TeamState> {
  let id: string | undefined;
  const out = await run(async (app) => {
    const { company, member } = await createCompany(app, {
      name: text(fd, "company"), you: text(fd, "you"),
      policy: { per_order_usdc: text(fd, "per_order") || "6000", monthly_usdc: text(fd, "monthly") || "20000", verified_only: true },
    });
    await remember(app, member);
    id = company.id;
  });
  if (id) redirect(`/teams/${id}`);
  return out;
}

export async function joinCompany(companyId: string, key: string, _: TeamState, fd: FormData): Promise<TeamState> {
  return run(async (app) => {
    await getCompany(app, companyId);
    const role = key === inviteKey(app, companyId, "approver") ? "approver" : key === inviteKey(app, companyId, "member") ? "member" : null;
    if (!role) throw new Refused("That invite link isn't valid. Ask a teammate for a fresh one.");
    await remember(app, await addMember(app, companyId, text(fd, "you"), role));
  }, "Welcome aboard.");
}

export async function askAgent(companyId: string, _: TeamState, fd: FormData): Promise<TeamState> {
  return run(async (app) => {
    const r = await procure(app, await me(app, companyId), {
      what: text(fd, "what"), quantity: Number(text(fd, "quantity")), budget: text(fd, "budget"),
    });
    return { done: `${r.cards} option${r.cards === 1 ? "" : "s"} sourced, ${r.shortlisted} on the shortlist.` };
  });
}

export async function vote(companyId: string, cardId: string, v: Vote | "clear"): Promise<TeamState> {
  return run(async (app) => castVote(app, await me(app, companyId), cardId, v));
}

export async function move(companyId: string, cardId: string, to: "sourced" | "shortlist" | "rejected"): Promise<TeamState> {
  return run(async (app) => moveCard(app, await me(app, companyId), cardId, to));
}

export async function approve(companyId: string, cardId: string): Promise<TeamState> {
  return run(async (app) => {
    const r = await approveCard(app, await me(app, companyId), cardId);
    return { done: r.status === "paid" ? "Paid. The ownership NFT is in the company wallet." : "Paid; confirming on Solana." };
  });
}

export async function savePolicy(companyId: string, _: TeamState, fd: FormData): Promise<TeamState> {
  return run(async (app) => updatePolicy(app, await me(app, companyId), {
    per_order_usdc: text(fd, "per_order"), monthly_usdc: text(fd, "monthly"), verified_only: fd.get("verified_only") === "on",
  }), "Policy saved.");
}

export async function addFunds(companyId: string): Promise<TeamState> {
  return run(async (app) => {
    const r = await topUp(app, await me(app, companyId));
    return { done: `Added ${r.amount} test USDC.` };
  });
}

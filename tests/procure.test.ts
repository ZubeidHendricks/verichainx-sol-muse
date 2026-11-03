import { describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { parseUsdc } from "@/lib/money";
import { attribute } from "@/lib/solana/items";
import { availableUnits, createMerchant, getItem, listItem, registerItem } from "@/server/catalog";
import { schema } from "@/server/db";
import {
  COMPANY_FUNDING, addMember, approveCard, boardView, castVote, consensus, createCompany, inviteKey, memberFromToken, memberToken,
  moveCard, policyChecks, procure, updatePolicy,
} from "@/server/procure";

import { makeTestApp, type TestApp } from "./testApp";

async function shop(app: TestApp, name: string, domain: string, title: string, price: string, stock: number | null, description = "") {
  const m = await createMerchant(app, { name, domain });
  await app.db.update(schema.merchants).set({ domainVerifiedAt: app.now() }).where(eq(schema.merchants.id, m.id));
  const item = await registerItem(app, m.id, { title, price, description, photos: [] });
  await listItem(app, item.id);
  if (stock !== null) await app.db.update(schema.items).set({ stock }).where(eq(schema.items.id, item.id));
  return { m, item };
}

describe("procurement for companies", () => {
  it("sources totes for a team, takes votes, and pays for a lot of 40 from the company wallet", async () => {
    const app = await makeTestApp();
    const { item: tote } = await shop(app, "Lerato Bags", "lerato.example", "Woven Market Tote", "129", 60, "Hand-woven tote bag");
    await shop(app, "Cape Leather Co", "cape.example", "Leather Tote", "349", 10, "Full-grain leather tote bag");
    await shop(app, "One Off", "oneoff.example", "Vintage Tote", "90", null, "A single vintage tote bag");

    const { company, member: boss } = await createCompany(app, { name: "Acme Events", you: "Thandi" });
    expect(await app.chain.tokenBalance(company.wallet, app.config.usdcMint)).toBe(COMPANY_FUNDING);
    const sam = await addMember(app, company.id, "Sam", "member");

    const run = await procure(app, sam, { what: "tote bag", quantity: 40, budget: "6000" });
    expect(run.engine).toBe("scripted");
    let board = await boardView(app, company.id, sam);
    const byTitle = (t: string) => board.cards.find((c) => c.title === t)!;
    // The woven tote fits stock, the per-order limit and the budget; the leather one is out of stock for 40;
    // the vintage one is one of a kind.
    expect(byTitle("Woven Market Tote")).toMatchObject({ column: "shortlist", available: 60, quantity: 40 });
    expect(byTitle("Woven Market Tote").total).toBe(parseUsdc("5160"));
    expect(byTitle("Vintage Tote").column).toBe("sourced");
    expect(byTitle("Vintage Tote").policy.find((p) => p.rule === "Stock")).toMatchObject({ ok: false });
    expect(run.answer).toContain("Woven Market Tote");

    const card = byTitle("Woven Market Tote");
    await castVote(app, sam, card.id, "must_have");
    await castVote(app, boss, card.id, "nice_to_have");
    board = await boardView(app, company.id, boss);
    expect(board.cards.find((c) => c.id === card.id)!.consensus).toMatchObject({ must: 1, nice: 1, support: 75, mine: "nice_to_have" });

    await expect(approveCard(app, sam, card.id)).rejects.toThrow(/approver/);
    const paid = await approveCard(app, boss, card.id);
    expect(paid.status).toBe("paid");

    // The lot's NFT is the company's, carries the tote's origin hash, and its 40 units came off the stock.
    const lot = await app.chain.getAsset(paid.asset!);
    expect(lot!.owner).toBe(company.wallet);
    expect(attribute(lot!, "registration_hash")).toBe(tote.registrationHash);
    expect(attribute(lot!, "quantity")).toBe("40");
    expect((await getItem(app, tote.id)).stock).toBe(20);
    expect(await availableUnits(app, await getItem(app, tote.id))).toBe(20);
    expect(await app.chain.tokenBalance(company.wallet, app.config.usdcMint)).toBe(COMPANY_FUNDING - parseUsdc("5160"));

    board = await boardView(app, company.id, boss);
    expect(board.cards.find((c) => c.id === card.id)).toMatchObject({ column: "ordered" });
    expect(board.spent).toBe(parseUsdc("5160"));
    await expect(castVote(app, sam, card.id, "skip")).rejects.toThrow(/closed/);

    // Shoppers never see lots: a personal shopper still gets the tote itself pitched, not the lot.
    const again = await procure(app, sam, { what: "tote bag", quantity: 1, budget: "200" });
    const titles = (await boardView(app, company.id, sam)).cards.filter((c) => c.requestId === again.requestId).map((c) => c.title);
    expect(titles).not.toContain("Woven Market Tote ×40");
  });

  it("checks the policy again when paying, and only approvers change it", async () => {
    const app = await makeTestApp();
    await shop(app, "Lerato Bags", "lerato.example", "Woven Market Tote", "129", 100, "Hand-woven tote bag");
    const { company, member: boss } = await createCompany(app, { name: "Acme", you: "Thandi" });
    const sam = await addMember(app, company.id, "Sam", "member");
    await procure(app, sam, { what: "tote bag", quantity: 20, budget: "3000" });
    const [card] = (await boardView(app, company.id, boss)).cards;
    expect(card.column).toBe("shortlist");

    await expect(updatePolicy(app, sam, { per_order_usdc: "1000", monthly_usdc: "5000", verified_only: true })).rejects.toThrow(/approver/);
    await updatePolicy(app, boss, { per_order_usdc: "1000", monthly_usdc: "5000", verified_only: true });
    await expect(approveCard(app, boss, card.id)).rejects.toThrow(/Policy: 2580.00 of 1000 USDC allowed per order/);
    expect((await boardView(app, company.id, boss)).cards[0].column).toBe("shortlist");

    await moveCard(app, sam, card.id, "sourced");
    await expect(moveCard(app, sam, card.id, "rejected")).rejects.toThrow(/approver/);
    await moveCard(app, boss, card.id, "rejected");
    await expect(approveCard(app, boss, card.id)).rejects.toThrow(/rejected/);
  });

  it("invites and member cookies are tied to the company", async () => {
    const app = await makeTestApp();
    const { company, member } = await createCompany(app, { name: "Acme", you: "Thandi" });
    const other = await createCompany(app, { name: "Other", you: "Lee" });
    expect(await memberFromToken(app, company.id, memberToken(app, member))).toMatchObject({ id: member.id, role: "approver" });
    expect(await memberFromToken(app, other.company.id, memberToken(app, member))).toBeNull();
    expect(await memberFromToken(app, company.id, `${member.id}.forged`)).toBeNull();
    expect(inviteKey(app, company.id, "member")).not.toBe(inviteKey(app, company.id, "approver"));
  });

  it("scores consensus and flags a split team", () => {
    const v = (vote: "must_have" | "nice_to_have" | "skip", memberId: string) => ({ vote, memberId, name: memberId });
    expect(consensus([v("must_have", "a"), v("must_have", "b"), v("nice_to_have", "c"), v("skip", "d")], "c"))
      .toMatchObject({ support: 63, split: true, mine: "nice_to_have", total: 4 });
    expect(consensus([])).toMatchObject({ support: 0, split: false });
  });

  it("store items can't be paid from the company wallet", () => {
    const checks = policyChecks({ per_order_usdc: "100", monthly_usdc: "100", verified_only: true },
      { kind: "store", label: "recommended", unitUnits: null, quantity: 5, available: null }, 0n);
    expect(checks.find((c) => c.rule === "Company wallet")).toMatchObject({ ok: false });
  });
});

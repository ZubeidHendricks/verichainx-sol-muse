import { createSignerFromKeypair, generateSigner, signTransaction } from "@metaplex-foundation/umi";
import { and, asc, desc, eq, gte } from "drizzle-orm";

import type { Envelope } from "@/lib/envelope";
import { formatUsdc, parseUsdc } from "@/lib/money";

import { localSource, peerSources, shopWithModels } from "./agents/buyer";
import { copierSource } from "./agents/copier";
import type { Usage } from "./agents/llm";
import { verifyOffer, type Recommendation } from "./agents/verify";
import { newId, type App } from "./app";
import { mac } from "./auth";
import { NotFound, Refused, availableUnits, createLot, getItem, makeOffer } from "./catalog";
import { schema } from "./db";
import type { CardEvent, Policy, PolicyCheck } from "./db/schema";
import { fundTestUsdc } from "./faucet";
import { refreshOrder, startPurchase, submitPurchase } from "./pay";
import { seal, unseal } from "./sealed";
import { formatPrice } from "./stores/catalog";
import { makerScorecard } from "./stores/scorecard";
import { searchStores } from "./stores/search";
import { saveRun } from "./views";

/**
 * Procurement for companies: the same checks as personal shopping, for a team. A member asks the procurement agent
 * (Muse Spark) for a quantity of something; it sources from the makers here and from Shopify stores, every offer is
 * verified, and code checks each against the company's spending policy. Options land on a shared board where the
 * team votes. Only an approver can approve, and approving pays from the company's wallet in one atomic Solana
 * transaction: the shop is paid and the lot's ownership NFT moves to the company. Policy is re-checked at that
 * moment, by code, whatever the votes or the model said.
 */

const { companies, members, requests, cards, votes, items } = schema;
export type Company = typeof companies.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Vote = (typeof votes.$inferSelect)["vote"];

export const DEFAULT_POLICY: Policy = { per_order_usdc: "6000", monthly_usdc: "20000", verified_only: true };
/** Test USDC a new company's devnet wallet starts with, and each top-up. */
export const COMPANY_FUNDING = parseUsdc("10000");

export const teamCookie = (companyId: string) => `vcx_team_${companyId}`;

/** Invite links carry a MAC of the company id and the role, so only someone given the link can join. */
export function inviteKey(app: App, companyId: string, role: Member["role"]) {
  return mac(app, `invite:${role}:${companyId}`);
}

export function memberToken(app: App, m: Member) {
  return `${m.id}.${mac(app, `member:${m.id}:${m.companyId}`)}`;
}

export async function memberFromToken(app: App, companyId: string, token: string | undefined): Promise<Member | null> {
  const [id, tag] = (token ?? "").split(".");
  if (!id || !tag) return null;
  const [m] = await app.db.select().from(members).where(and(eq(members.id, id), eq(members.companyId, companyId)));
  return m && tag === mac(app, `member:${m.id}:${m.companyId}`) ? m : null;
}

const cleanName = (s: string, what: string) => {
  const t = s.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!t) throw new Refused(`Give ${what}.`);
  return t;
};

/** A company with its own devnet wallet, funded with test USDC; whoever creates it is its first approver. */
export async function createCompany(app: App, a: { name: string; you: string; policy?: Partial<Policy> }) {
  if (app.config.cluster === "mainnet") throw new Refused("Company wallets held by the service are devnet-only.");
  const wallet = generateSigner(app.umi);
  const [company] = await app.db.insert(companies).values({
    id: newId("co"), name: cleanName(a.name, "the company a name"), wallet: wallet.publicKey,
    walletSecretSealed: seal(wallet.secretKey, app.config.sealSecret), policy: checkPolicy({ ...DEFAULT_POLICY, ...a.policy }),
  }).returning();
  await fundTestUsdc(app, company.wallet, COMPANY_FUNDING);
  const member = await addMember(app, company.id, a.you, "approver");
  return { company, member };
}

export function checkPolicy(p: Policy): Policy {
  const amount = (v: string, what: string) => {
    if (!/^\d+(\.\d{1,2})?$/.test(v.trim()) || parseUsdc(v.trim()) <= 0n) throw new Refused(`${what} should be an amount in USDC, like 5000.`);
    return v.trim();
  };
  return { per_order_usdc: amount(p.per_order_usdc, "The limit per order"), monthly_usdc: amount(p.monthly_usdc, "The monthly limit"),
    verified_only: Boolean(p.verified_only) };
}

export async function addMember(app: App, companyId: string, name: string, role: Member["role"]) {
  const [m] = await app.db.insert(members).values({ id: newId("mb"), companyId, name: cleanName(name, "your name"), role }).returning();
  return m;
}

export async function getCompany(app: App, id: string): Promise<Company> {
  const [c] = await app.db.select().from(companies).where(eq(companies.id, id));
  if (!c) throw new NotFound(`no company ${id}`);
  return c;
}

export async function updatePolicy(app: App, by: Member, policy: Policy) {
  if (by.role !== "approver") throw new Refused("Only an approver can change the spending policy.");
  await app.db.update(companies).set({ policy: checkPolicy(policy) }).where(eq(companies.id, by.companyId));
}

export async function topUp(app: App, by: Member) {
  const c = await getCompany(app, by.companyId);
  return fundTestUsdc(app, c.wallet, COMPANY_FUNDING);
}

/** USDC the company paid this calendar month (UTC), from orders placed through the board. */
export async function spentThisMonth(app: App, companyId: string): Promise<bigint> {
  const now = app.now();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Unit price × quantity per card, summed in code: the total isn't a column.
  const rows = await app.db.select({ u: cards.unitUnits, q: cards.quantity }).from(cards)
    .where(and(eq(cards.companyId, companyId), eq(cards.column, "ordered"), gte(cards.orderedAt, start)));
  return rows.reduce((t, r) => t + (r.u ?? 0n) * BigInt(r.q), 0n);
}

export const cardTotal = (c: Pick<Card, "unitUnits" | "quantity">) => (c.unitUnits ?? 0n) * BigInt(c.quantity);

/** The company's rules for one option, checked in code. Every rule must pass before the wallet can pay. */
export function policyChecks(policy: Policy, c: { kind: Card["kind"]; label: string; unitUnits: bigint | null; quantity: number;
  available: number | null }, spent: bigint): PolicyCheck[] {
  const out: PolicyCheck[] = [];
  if (c.kind === "store") {
    out.push({ rule: "Company wallet", ok: false, detail: "Sold on the store's own checkout: buy it there with a company card, outside this board." });
  }
  if (c.label === "avoid" || c.label === "excluded") {
    out.push({ rule: "Checks", ok: false, detail: "The checks say avoid." });
  } else if (policy.verified_only) {
    out.push({ rule: "Verified only", ok: c.label === "recommended",
      detail: c.label === "recommended" ? "Passed every check" : "Policy allows only offers that pass every check" });
  }
  if (c.kind === "maker") {
    const enough = c.available === null ? c.quantity === 1 : c.available >= c.quantity;
    out.push({ rule: "Stock", ok: enough, detail: c.available === null
      ? (c.quantity === 1 ? "One of a kind" : "One of a kind: it can't be bought by quantity")
      : `${c.available} available, ${c.quantity} needed` });
    const total = (c.unitUnits ?? 0n) * BigInt(c.quantity);
    const perOrder = parseUsdc(policy.per_order_usdc);
    out.push({ rule: "Per order", ok: total <= perOrder, detail: `${formatUsdc(total)} of ${policy.per_order_usdc} USDC allowed per order` });
    const monthly = parseUsdc(policy.monthly_usdc);
    out.push({ rule: "This month", ok: spent + total <= monthly,
      detail: `${formatUsdc(spent)} spent; this would make ${formatUsdc(spent + total)} of ${policy.monthly_usdc} USDC` });
  }
  return out;
}

export const passes = (checks: PolicyCheck[]) => checks.every((c) => c.ok);

const event = (app: App, who: string, what: string, sig?: string): CardEvent =>
  ({ at: app.now().toISOString(), who, what, ...(sig ? { sig } : {}) });

const QUANTITY_MAX = 10_000;

/**
 * One procurement request. The agent shops per unit (shop agents price single items), so it's told the unit budget;
 * quantity, stock and the company's limits are then checked in code for every option.
 */
export async function procure(app: App, by: Member, a: { what: string; quantity: number; budget: string }) {
  const company = await getCompany(app, by.companyId);
  const what = a.what.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!what) throw new Refused("Say what the company needs.");
  if (!Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > QUANTITY_MAX) throw new Refused(`Quantity should be 1 to ${QUANTITY_MAX}.`);
  if (!/^\d+(\.\d{1,2})?$/.test(a.budget.trim())) throw new Refused("Budget should be a total in USDC, like 5000.");
  const budgetUnits = parseUsdc(a.budget.trim());
  if (budgetUnits <= 0n) throw new Refused("Budget should be more than zero.");
  const unitBudget = formatUsdc(budgetUnits / BigInt(a.quantity));

  const repUsage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const sources = [
    localSource(app, { models: app.agentModels ?? [], onUsage: (u) => {
      repUsage.prompt_tokens += u.prompt_tokens;
      repUsage.completion_tokens += u.completion_tokens;
    } }),
    ...peerSources(),
    ...(process.env.DEMO_COPIER === "1" ? [copierSource(app)] : []),
  ];
  const ask = `${what} under ${unitBudget} USDC each`;
  const brief = `Buying for ${company.name}, a company: ${a.quantity} units of "${what}", total budget ${formatUsdc(budgetUnits)} USDC.`;
  const [result, stores] = await Promise.all([
    shopWithModels(app, ask, sources, app.agentModels ?? [], [{ role: "shopper", text: brief }]),
    searchStores(app, what, Number(unitBudget), 3),
  ]);

  const spent = await spentThisMonth(app, company.id);
  // Copies flagged avoid would drag the typical price down, so they don't count as peers.
  const peers = result.results.filter((r) => r.final !== "avoid" && r.final !== "excluded")
    .map((r) => Math.round(Number(r.offer?.price ?? 0) * 100)).filter(Boolean);
  const requestId = newId("rq");
  const rows: (typeof cards.$inferInsert)[] = [];
  const payable = new Set<string>(); // offer ids from shops here
  for (const r of result.results) {
    const o = r.offer;
    if (!o) continue;
    const [item] = o.asset ? await app.db.select().from(items).where(eq(items.asset, o.asset)) : [];
    // Offers from other apps' agents can't be paid from this board; they're shown so the team sees what was rejected.
    const local = Boolean(item && item.merchantId === o.merchant);
    if (local) payable.add(o.offer_id);
    const available = local ? await availableUnits(app, item!) : null;
    const unitUnits = parseUsdc(o.price);
    const label = local ? r.final : r.final === "recommended" ? "caution" : r.final;
    const reasons = [...(r.model_reason ? [r.model_reason] : []), ...r.reasons];
    if (!local && r.final !== "avoid") reasons.push("Offered by an agent outside this marketplace.");
    rows.push({
      id: newId("cd"), companyId: company.id, requestId, kind: "maker", title: o.title, seller: o.merchant_domain ?? o.merchant,
      image: o.image ?? null, itemId: local ? item!.id : null, unitPrice: `${o.price} USDC`, unitUnits, quantity: a.quantity,
      available, label, reasons, evidence: r.evidence,
      scorecard: makerScorecard(r, r.final, peers.filter((p) => p !== Math.round(Number(o.price) * 100))),
      policy: policyChecks(company.policy, { kind: "maker", label, unitUnits, quantity: a.quantity, available }, spent),
      history: [event(app, "Procurement agent", `Sourced for “${what}” ×${a.quantity}`)],
    });
  }
  for (const s of stores) {
    const p = s.product;
    rows.push({
      id: newId("cd"), companyId: company.id, requestId, kind: "store", title: p.variant_title ? `${p.title} (${p.variant_title})` : p.title,
      seller: p.store.public_domain, image: p.photo, productUrl: p.url, unitPrice: formatPrice(p.price_minor, p.currency), unitUnits: null,
      quantity: a.quantity, available: null, label: s.recommendation, reasons: s.reasons, evidence: s.evidence, scorecard: s.scorecard,
      policy: policyChecks(company.policy, { kind: "store", label: s.recommendation, unitUnits: null, quantity: a.quantity, available: null }, spent),
      history: [event(app, "Procurement agent", `Found on Shopify for “${what}”`)],
    });
  }
  // Options that pass the policy go straight to the shortlist; the rest stay in Sourced with the reasons.
  for (const row of rows) if (passes(row.policy!)) row.column = "shortlist";

  const ok = rows.filter((r) => r.column === "shortlist");
  const best = ok.sort((x, y) => Number(cardTotal(x as Card) - cardTotal(y as Card)))[0];
  const usage = { prompt_tokens: (result.usage?.prompt_tokens ?? 0) + repUsage.prompt_tokens,
    completion_tokens: (result.usage?.completion_tokens ?? 0) + repUsage.completion_tokens };
  const summary = best
    ? ` ${ok.length} option${ok.length === 1 ? "" : "s"} pass${ok.length === 1 ? "es" : ""} ${company.name}'s policy; the best is ${best.title} from ${best.seller}: `
      + `${a.quantity} × ${best.unitPrice} = ${formatUsdc(cardTotal(best as Card))} USDC. It's on the shortlist for the team to vote on.`
    : ` Nothing passes ${company.name}'s policy for ${a.quantity} units yet; the board says which rule each option fails.`;
  const answer = (result.answer + summary).slice(0, 1200);
  const runId = await saveRun(app, `[${company.name}] ${ask} ×${a.quantity}`, {
    ...result, answer, usage: usage.prompt_tokens ? usage : undefined,
    results: result.results.map((r) => ({ ...r, local: payable.has(r.offer?.offer_id ?? "") })),
  });
  await app.db.insert(requests).values({ id: requestId, companyId: company.id, memberId: by.id, text: what, quantity: a.quantity,
    budgetUnits, answer, engine: result.engine, runId });
  if (rows.length) await app.db.insert(cards).values(rows);
  return { requestId, answer, engine: result.engine, runId, cards: rows.length, shortlisted: ok.length };
}

async function getCard(app: App, companyId: string, cardId: string): Promise<Card> {
  const [c] = await app.db.select().from(cards).where(and(eq(cards.id, cardId), eq(cards.companyId, companyId)));
  if (!c) throw new NotFound("That option isn't on this company's board.");
  return c;
}

export async function castVote(app: App, by: Member, cardId: string, vote: Vote | "clear") {
  const card = await getCard(app, by.companyId, cardId);
  if (card.column === "ordered" || card.column === "rejected") throw new Refused("Voting is closed on this option.");
  await app.db.delete(votes).where(and(eq(votes.cardId, card.id), eq(votes.memberId, by.id)));
  if (vote !== "clear") await app.db.insert(votes).values({ cardId: card.id, memberId: by.id, vote, at: app.now() });
}

/** Members move options between Sourced and Shortlist; only approvers reject, and only approving pays. */
export async function moveCard(app: App, by: Member, cardId: string, to: "sourced" | "shortlist" | "rejected") {
  const card = await getCard(app, by.companyId, cardId);
  if (card.column === "ordered" || card.column === "approved") throw new Refused("This option is already approved.");
  if (to === "rejected" && by.role !== "approver") throw new Refused("Only an approver can reject an option.");
  if (card.column === to) return;
  await app.db.update(cards).set({ column: to, history: [...card.history, event(app, by.name, `Moved to ${to}`)] }).where(eq(cards.id, card.id));
}

export type Consensus = { must: number; nice: number; skip: number; total: number; support: number; split: boolean;
  mine?: Vote; voters: { name: string; vote: Vote }[] };

/**
 * Support is must-haves plus half the nice-to-haves, as a share of everyone who voted; an option the team is split
 * on (must-haves and skips both) is marked so the approver sees it.
 */
export function consensus(vs: { vote: Vote; memberId: string; name: string }[], me?: string): Consensus {
  const n = (v: Vote) => vs.filter((x) => x.vote === v).length;
  const must = n("must_have"), nice = n("nice_to_have"), skip = n("skip"), total = vs.length;
  return { must, nice, skip, total, support: total ? Math.round(((must + nice / 2) / total) * 100) : 0,
    split: must > 0 && skip > 0, mine: vs.find((v) => v.memberId === me)?.vote, voters: vs.map((v) => ({ name: v.name, vote: v.vote })) };
}

function companySigner(app: App, c: Company) {
  return createSignerFromKeypair(app.umi, app.umi.eddsa.createKeypairFromSecretKey(unseal(c.walletSecretSealed, app.config.sealSecret)));
}

/**
 * Approve and pay. Code re-checks the policy with fresh stock and this month's spend, mints a lot for quantities
 * (or buys the one-of-a-kind item itself), gets a fresh signed offer from the shop's agent and verifies it again,
 * then pays from the company wallet in one transaction. The lot's NFT, the company's proof of what it bought and
 * from whom, lands in the company wallet.
 */
export async function approveCard(app: App, by: Member, cardId: string) {
  if (by.role !== "approver") throw new Refused("Only an approver can approve a purchase.");
  const company = await getCompany(app, by.companyId);
  const card = await getCard(app, company.id, cardId);
  if (card.column === "ordered") throw new Refused("Already ordered.");
  if (card.column === "rejected") throw new Refused("This option was rejected.");
  if (card.kind !== "maker" || !card.itemId) throw new Refused("Only items from shops here can be paid from the company wallet.");
  const item = await getItem(app, card.itemId);
  const available = await availableUnits(app, item);
  const checks = policyChecks(company.policy, { kind: "maker", label: card.label, unitUnits: item.priceUnits, quantity: card.quantity, available },
    await spentThisMonth(app, company.id));
  if (!passes(checks)) {
    await app.db.update(cards).set({ policy: checks, available }).where(eq(cards.id, card.id));
    throw new Refused(`Policy: ${checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}`);
  }

  await app.db.update(cards).set({ column: "approved", policy: checks, history: [...card.history, event(app, by.name, "Approved")] })
    .where(eq(cards.id, card.id));
  const target = item.stock === null ? item : await createLot(app, item.id, card.quantity);
  try {
    const offer = await makeOffer(app, target.id, { pitch: `${company.name}: order of ${card.quantity}` });
    const v = await verifyOffer(app, offer.envelope as Envelope);
    const allowed: Recommendation[] = company.policy.verified_only ? ["recommended"] : ["recommended", "caution"];
    if (!allowed.includes(v.recommendation)) throw new Refused(`The fresh check says ${v.recommendation}: ${v.reasons.join("; ") || "failed a check"}`);
    const signer = companySigner(app, company);
    const max = item.priceUnits * BigInt(card.quantity);
    const { order, transaction } = await startPurchase(app, offer.id, company.wallet, { maxPriceUnits: max });
    const tx = app.umi.transactions.deserialize(Buffer.from(transaction, "base64"));
    const signed = await signTransaction(tx, [signer]);
    const sig = await submitPurchase(app, order.id, Buffer.from(app.umi.transactions.serialize(signed)).toString("base64"));
    let paid = await refreshOrder(app, order.id);
    for (let i = 0; i < 8 && paid.status === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      paid = await refreshOrder(app, order.id);
    }
    const [fresh] = await app.db.select().from(cards).where(eq(cards.id, card.id));
    await app.db.update(cards).set({
      column: "ordered", orderId: order.id, orderedAt: app.now(), unitUnits: item.priceUnits,
      history: [...fresh.history, event(app, "Company wallet", `Paid ${formatUsdc(max)} USDC; ${paid.status === "paid" ? "NFT received" : "confirming"}`, sig)],
    }).where(eq(cards.id, card.id));
    return { orderId: order.id, signature: sig, status: paid.status, asset: target.asset };
  } catch (e) {
    if (target.lotOf) await app.db.update(items).set({ status: "delisted" }).where(eq(items.id, target.id)); // frees the units
    const [fresh] = await app.db.select().from(cards).where(eq(cards.id, card.id));
    await app.db.update(cards).set({ column: "shortlist",
      history: [...fresh.history, event(app, "Company wallet", `Payment didn't go through: ${(e as Error).message.slice(0, 140)}`)] })
      .where(eq(cards.id, card.id));
    throw e;
  }
}

/** Everything the board page shows: the company, its people, requests, cards with votes, and the wallet. */
export async function boardView(app: App, companyId: string, me: Member | null) {
  const company = await getCompany(app, companyId);
  const people = await app.db.select().from(members).where(eq(members.companyId, companyId)).orderBy(asc(members.createdAt));
  const reqs = await app.db.select().from(requests).where(eq(requests.companyId, companyId)).orderBy(desc(requests.createdAt));
  const all = await app.db.select().from(cards).where(eq(cards.companyId, companyId)).orderBy(asc(cards.createdAt));
  const vs = all.length ? await app.db.select({ cardId: votes.cardId, vote: votes.vote, memberId: votes.memberId, name: members.name })
    .from(votes).innerJoin(members, eq(votes.memberId, members.id)).innerJoin(cards, eq(votes.cardId, cards.id))
    .where(eq(cards.companyId, companyId)) : [];
  const balance = await app.chain.tokenBalance(company.wallet, app.config.usdcMint).catch(() => null);
  return {
    company, people, requests: reqs, spent: await spentThisMonth(app, companyId), balance,
    cards: all.map((c) => ({ ...c, total: cardTotal(c), consensus: consensus(vs.filter((v) => v.cardId === c.id), me?.id) })),
  };
}

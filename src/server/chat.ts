import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { Turn } from "@/lib/envelope";

import { conversationBudget, localSource, peerSources, shopWithModels, type ShopResult } from "./agents/buyer";
import { copierSource } from "./agents/copier";
import type { Usage } from "./agents/llm";
import type { Recommendation } from "./agents/verify";
import { newId, type App } from "./app";
import { NotFound } from "./catalog";
import { schema } from "./db";
import { formatPrice } from "./stores/catalog";
import { makerScorecard } from "./stores/scorecard";
import { searchStores, type StoreResult } from "./stores/search";
import { saveRun, type ShopReply } from "./views";

/**
 * The shopping conversation (§5, agent to agent): shops' sales agents greet and pitch to the shopper, and the
 * shopper's own agent checks every pitch against the chain. Each shopper message is one turn: the need, with
 * the conversation so far, goes to every shop agent; their pitches come back as signed offers (or replies); the
 * shopper's agent verifies and annotates them.
 */
type Result = ShopReply["results"][number];

export type ChatMessage =
  | { kind: "shopper"; text: string }
  | { kind: "rep"; shop: string; verified: boolean; known: boolean; text: string; offers: Result[]; note?: string }
  | { kind: "agent"; text: string; engine?: string; usage?: Usage; notes?: string[]; trace?: ShopResult["trace"]; runId?: string }
  /** Real stores the shopper's agent found and checked itself (Shopify's catalog); they have no agent here. */
  | { kind: "stores"; results: StoreResult[] };

const ORDER: Record<Recommendation, number> = { recommended: 0, caution: 1, avoid: 2, excluded: 3 };

/** The welcome: a verified shop's rep says hello, and the shopper's agent says what it will do. */
export async function greeting(app: App): Promise<ChatMessage[]> {
  const shops = await app.db.select({ m: schema.merchants, title: schema.items.title, description: schema.items.description })
    .from(schema.items).innerJoin(schema.merchants, eq(schema.items.merchantId, schema.merchants.id))
    .where(and(eq(schema.items.status, "listed"), isNull(schema.items.lotOf), isNotNull(schema.merchants.domainVerifiedAt)))
    .orderBy(desc(schema.items.createdAt));
  const host = shops[0];
  const agentIntro: ChatMessage = { kind: "agent", text: "I'm your agent. I don't work for any shop: before you pay, I check every "
    + "offer against Solana: who holds the item's NFT, its origin record, the seller and the price." };
  if (!host) return [agentIntro];
  const shop = host.m.domain ?? host.m.name;
  return [{
    kind: "rep", shop, verified: true, known: true, offers: [],
    text: `Welcome! I'm the sales agent for ${host.m.name}. ${host.description ? `We make things like our ${host.title}. ` : ""}`
      + "What are you looking for today? Agents from other shops are here too, and they'll pitch you as well.",
  }, agentIntro];
}

/** Rep messages for a turn: each shop agent's pitch with its offers, best verdict first, then replies. */
function threadFor(out: ShopReply): ChatMessage[] {
  const groups = new Map<string, Result[]>();
  for (const r of out.results) {
    const key = r.from;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const reps: (ChatMessage & { kind: "rep" })[] = [...groups.values()]
    .sort((a, b) => Math.min(...a.map((r) => ORDER[r.final])) - Math.min(...b.map((r) => ORDER[r.final])) || a[0].rank - b[0].rank)
    .map((rs) => ({
      kind: "rep", shop: rs[0].offer?.merchant_domain ?? rs[0].offer?.merchant ?? rs[0].from,
      verified: rs.some((r) => r.verified_seller), known: rs.some((r) => r.known_seller),
      text: rs[0].offer?.pitch ?? "", offers: rs,
    }));
  for (const r of out.replies ?? []) {
    reps.push({ kind: "rep", shop: r.shop, verified: r.verified, known: r.known, text: r.text, offers: [], note: r.note });
  }
  return reps;
}

function turnsFor(text: string, thread: ChatMessage[]): Turn[] {
  return [{ role: "shopper", text }, ...thread.map((m): Turn => {
    if (m.kind === "rep") return { role: "rep", from: m.shop, text: m.text.slice(0, 1000) };
    if (m.kind === "stores") {
      return { role: "agent", text: `Stores I found: ${m.results.map((r) => `${r.product.title} from ${r.product.store.public_domain}, `
        + `${formatPrice(r.product.price_minor, r.product.currency)}, ${r.recommendation}`).join("; ")}`.slice(0, 1000) };
    }
    return { role: m.kind === "agent" ? "agent" : "shopper", text: m.text.slice(0, 1000) };
  })];
}

/** One sentence on the stores, added to the agent's answer by code so it always matches the checks. */
function storesSentence(stores: StoreResult[]): string {
  if (!stores.length) return "";
  const best = stores[0];
  return ` I also checked ${stores.length} Shopify store${stores.length === 1 ? "" : "s"}: the best is ${best.product.title} from `
    + `${best.product.store.public_domain} (${best.recommendation}, ${best.scorecard.overall}/100), bought on the store's own checkout.`;
}

/** One shopper message: runs the turn and saves it to the conversation (a new one if `conversationId` is null). */
export async function chatTurn(app: App, conversationId: string | null, text: string) {
  let convo = conversationId
    ? (await app.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)))[0]
    : undefined;
  if (conversationId && !convo) throw new NotFound(`no conversation ${conversationId}`);
  const priorTurns = (convo?.turns as Turn[] | undefined) ?? [];
  const priorMessages = (convo?.messages as ChatMessage[] | undefined) ?? await greeting(app);

  const repUsage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const sources = [
    localSource(app, { models: app.agentModels ?? [], onUsage: (u) => {
      repUsage.prompt_tokens += u.prompt_tokens;
      repUsage.completion_tokens += u.completion_tokens;
    } }),
    ...peerSources(),
    ...(process.env.DEMO_COPIER === "1" ? [copierSource(app)] : []),
  ];
  const context = priorTurns.length ? priorTurns : turnsFor("", priorMessages).slice(1);
  const budget = conversationBudget(text, context);
  const [result, stores] = await Promise.all([
    shopWithModels(app, text, sources, app.agentModels ?? [], context),
    searchStores(app, text, budget ? Number(budget) : undefined),
  ]);

  // Offers this app holds get a pay page; ones from other apps' agents are shown but paid there.
  const ids = result.results.map((r) => r.offer?.offer_id).filter((id): id is string => Boolean(id));
  const here = new Set((ids.length ? await app.db.select({ id: schema.offers.id }).from(schema.offers)
    .where(inArray(schema.offers.id, ids)) : []).map((o) => o.id));
  const usage = result.usage || repUsage.prompt_tokens
    ? { prompt_tokens: (result.usage?.prompt_tokens ?? 0) + repUsage.prompt_tokens,
      completion_tokens: (result.usage?.completion_tokens ?? 0) + repUsage.completion_tokens }
    : undefined;
  // Maker prices are USDC; store prices in USD compare with them for value.
  const peerCents = [...result.results.map((r) => Math.round(Number(r.offer?.price ?? 0) * 100)).filter(Boolean),
    ...stores.filter((s) => s.product.currency === "USD").map((s) => s.product.price_minor)];
  const reply: ShopReply = { ...result, usage, results: result.results.map((r) => ({
    ...r, local: here.has(r.offer?.offer_id ?? ""),
    scorecard: makerScorecard(r, r.final, peerCents.filter((c) => c !== Math.round(Number(r.offer?.price ?? 0) * 100))),
  })) };
  const runId = await saveRun(app, text, reply);

  const thread = threadFor(reply);
  const agent: ChatMessage = { kind: "agent", text: reply.answer + storesSentence(stores), engine: reply.engine, usage,
    notes: reply.notes, trace: reply.trace, runId };
  const added: ChatMessage[] = [{ kind: "shopper", text }, ...thread, ...(stores.length ? [{ kind: "stores", results: stores } as const] : []), agent];
  const messages = [...priorMessages, ...added];
  const turns = [...context, ...turnsFor(text, [...thread, agent])].slice(-16);

  const id = convo?.id ?? newId("cv");
  if (convo) {
    await app.db.update(schema.conversations).set({ messages, turns, updatedAt: app.now() }).where(eq(schema.conversations.id, id));
  } else {
    [convo] = await app.db.insert(schema.conversations).values({ id, messages, turns, createdAt: app.now(), updatedAt: app.now() }).returning();
  }
  return { conversationId: id, added, reply, runId };
}

export async function conversation(app: App, id: string) {
  const [c] = await app.db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
  if (!c) throw new NotFound(`no conversation ${id}`);
  return { id: c.id, messages: c.messages as ChatMessage[], createdAt: c.createdAt.toISOString() };
}

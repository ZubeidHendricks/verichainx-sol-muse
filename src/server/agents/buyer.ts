import { caip10, solanaChain } from "@/lib/chains";
import { needBody, newEnvelope, signEnvelope, type Envelope } from "@/lib/envelope";
import { parseUsdc } from "@/lib/money";

import type { App } from "../app";
import { answerNeed } from "./merchant";
import { enforceGuardrail, verifyOffer, type Recommendation, type Verdict } from "./verify";

/** Where offers come from: this host's merchant agents, or another app's `/agent/v1/offers` (§10). */
export type OfferSource = { name: string; request(need: Envelope): Promise<Envelope[]> };

export function localSource(app: App): OfferSource {
  return { name: "local", request: (need) => answerNeed(app, need) };
}

export function remoteSource(endpoint: string, timeoutMs = 5000): OfferSource {
  return {
    name: new URL(endpoint).host,
    async request(need) {
      const r = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(need),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`${endpoint}: HTTP ${r.status}`);
      const body = await r.json();
      return Array.isArray(body) ? body : body.offers ?? [];
    },
  };
}

export type TraceStep = { tool: string; input: unknown; output: unknown };
export type Ranked = Verdict & { rank: number; final: Recommendation };
export type ShopResult = { need: Envelope; trace: TraceStep[]; results: Ranked[]; answer: string; engine: "scripted" };

const ORDER: Record<Recommendation, number> = { recommended: 0, caution: 1, avoid: 2, excluded: 3 };

/** Pulls a budget like "under $400" or "max 250 usdc" out of the request. */
export function parseBudget(text: string): string | undefined {
  const m = /(?:under|below|less than|max(?:imum)?|up to|<)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(text)
    ?? /\$\s*(\d+(?:\.\d{1,2})?)/.exec(text);
  return m?.[1];
}

/**
 * §8.1, scripted engine: the same tools an LLM engine calls, in a fixed order. Used for tests and
 * offline demos, and labelled as such. Verdicts come from code; the guardrail is applied last.
 */
export async function shop(app: App, text: string, sources: OfferSource[]): Promise<ShopResult> {
  const trace: TraceStep[] = [];
  const budget = parseBudget(text);
  // The buyer agent signs as the service's anchoring key, so merchant agents can tell who is asking.
  const need = signEnvelope(newEnvelope("need", caip10(solanaChain(app.config.cluster), app.keys.anchor.publicKey),
    needBody.parse({ text, budget, currency: "USDC" }), 15, app.now()), app.keys.anchor.secretKey);
  trace.push({ tool: "discover_merchants", input: { need: text, budget }, output: sources.map((s) => s.name) });

  const envelopes: Envelope[] = [];
  for (const s of sources) {
    try {
      const got = await s.request(need);
      envelopes.push(...got);
      trace.push({ tool: "request_offers", input: { source: s.name }, output: got.map((e) => ({ type: e.type, from: e.from })) });
    } catch (e) {
      trace.push({ tool: "request_offers", input: { source: s.name }, output: { error: (e as Error).message } });
    }
  }

  const verdicts: Verdict[] = [];
  for (const env of envelopes.filter((e) => e.type === "offer")) {
    const v = await verifyOffer(app, env);
    trace.push({ tool: "verify_offer", input: { offer: v.offer?.offer_id, from: env.from },
      output: { recommendation: v.recommendation, evidence: v.evidence } });
    verdicts.push(v);
  }

  const results: Ranked[] = verdicts
    .map((v) => ({ ...v, final: enforceGuardrail(v, v.recommendation) }))
    .sort((a, b) => ORDER[a.final] - ORDER[b.final]
      || Number(parseUsdc(a.offer?.price ?? "0") - parseUsdc(b.offer?.price ?? "0")))
    .map((v, i) => ({ ...v, rank: i + 1 }));
  trace.push({ tool: "present_recommendations", input: { count: results.length },
    output: results.map((r) => ({ offer: r.offer?.offer_id, final: r.final })) });

  return { need, trace, results, answer: summarize(results, budget), engine: "scripted" };
}

function summarize(results: Ranked[], budget?: string): string {
  const best = results.find((r) => r.final === "recommended");
  const avoided = results.filter((r) => r.final === "avoid");
  const parts: string[] = [];
  if (best?.offer) {
    parts.push(`Best match: ${best.offer.title} for ${best.offer.price} USDC from ${best.offer.merchant_domain ?? best.offer.merchant}. ${best.evidence.filter((e) => e.ok).length} checks passed.`);
  } else if (results.some((r) => r.final === "caution")) {
    parts.push("No offer passed every check; the ones marked caution are listed with the reasons.");
  } else {
    parts.push(`No offers${budget ? ` under ${budget} USDC` : ""} passed verification.`);
  }
  if (avoided.length) parts.push(`Avoid ${avoided.length}: ${avoided.map((r) => r.reasons[0]).join(" ")}`);
  return parts.join(" ");
}

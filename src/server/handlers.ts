import { solanaChain } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { attribute, ownershipCheck } from "@/lib/solana/items";
import { TemplateMismatch } from "@/lib/solana/purchase";

import type { App } from "./app";
import { NotFound, Refused, checkOffer, loadOffer } from "./catalog";
import { refreshOrder, startPurchase } from "./pay";
import { assetReport, offerStatus, saveRun } from "./views";
import { CHALLENGE_COOKIE, SESSION_COOKIE, completeSignIn, readCookie, setCookie, signInChallenge } from "./auth";
import { offers } from "./db/schema";
import { inArray } from "drizzle-orm";
import { localSource, peerSources, shopWithModels } from "./agents/buyer";
import { copierSource } from "./agents/copier";
import { answerNeed } from "./agents/merchant";
import { envelopeSchema } from "@/lib/envelope";

/**
 * HTTP handlers, kept free of Next.js so tests can call them with plain Requests. The route files
 * under src/app/ only wire them to getApp().
 */

/** Solana Actions headers (CORS plus action version and chain), also fine for Solana Pay wallets. */
export function actionHeaders(app: App): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
    "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
    "X-Action-Version": "2.4",
    "X-Blockchain-Ids": solanaChain(app.config.cluster),
  };
}

function json(app: App, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: actionHeaders(app) });
}

async function guarded(app: App, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotFound) return json(app, { message: e.message }, 404);
    if (e instanceof Refused || e instanceof TemplateMismatch) {
      return json(app, { message: e.message }, 400);
    }
    console.error(e);
    return json(app, { message: "Something went wrong preparing this purchase." }, 500);
  }
}

async function readAccount(req: Request): Promise<unknown> {
  try {
    return ((await req.json()) as { account?: unknown }).account;
  } catch {
    return undefined;
  }
}

/** The verification summary shown in Blinks and on item pages (§9). Reads the chain live. */
export async function offerSummary(app: App, offerId: string) {
  const ctx = await loadOffer(app, offerId);
  const asset = await app.chain.getAsset(ctx.item.asset!);
  let live: string | null = null;
  try {
    checkOffer(app, ctx.offer, ctx.item, ctx.merchant);
  } catch (e) {
    live = (e as Error).message;
  }
  const owned = asset ? ownershipCheck(asset, [ctx.merchant.wallet], app.keys.settlement.publicKey) : null;
  return {
    ...ctx,
    checks: {
      verified_seller: Boolean(ctx.merchant.domainVerifiedAt),
      origin_record: Boolean(asset && attribute(asset, "registration_hash") === ctx.item.registrationHash),
      owned_by_seller: owned?.ok === true,
      problem: live ?? (owned && !owned.ok ? owned.reason : null),
    },
  };
}

function describe(s: Awaited<ReturnType<typeof offerSummary>>): string {
  const seller = s.merchant.domain ?? s.merchant.name;
  const lines = [
    s.checks.verified_seller ? `✓ Verified seller: ${seller}` : `Seller: ${seller} (domain not verified yet)`,
    s.checks.origin_record ? "✓ Origin record matches the item's NFT" : "✗ No matching origin record",
    s.checks.owned_by_seller ? "✓ NFT is in the seller's wallet and moves to you when you pay" : "✗ Seller doesn't hold this item's NFT",
  ];
  return [s.item.description, ...lines].filter(Boolean).join("\n");
}

/** GET /api/actions/offer/:id (§11.2). */
export async function actionGet(app: App, offerId: string): Promise<Response> {
  return guarded(app, async () => {
    const s = await offerSummary(app, offerId);
    const price = formatUsdc(s.offer.priceUnits);
    const problem = s.checks.problem;
    return json(app, {
      type: "action",
      icon: s.item.photos[0] ?? `${app.config.appUrl}/icon.png`,
      title: s.item.title,
      description: describe(s),
      label: `Buy for ${price} USDC`,
      ...(problem ? { disabled: true, error: { message: problem } } : {}),
      links: { actions: [{ type: "transaction", label: `Buy for ${price} USDC`, href: `/api/actions/offer/${offerId}` }] },
    });
  });
}

/** POST /api/actions/offer/:id with {account}: the same transaction as Solana Pay. */
export async function actionPost(app: App, offerId: string, req: Request): Promise<Response> {
  return guarded(app, async () => {
    const { transaction, message, order } = await startPurchase(app, offerId, await readAccount(req));
    return json(app, {
      type: "transaction", transaction, message,
      links: { next: { type: "inline", action: {
        type: "completed", icon: `${app.config.appUrl}/icon.png`, title: "Purchase sent",
        description: `Order ${order.id}. Track it at ${app.config.appUrl}/orders/${order.id}`, label: "Done",
      } } },
    });
  });
}

/** GET /api/pay/:id (§11.1): label and icon the wallet shows before asking for the account. */
export async function payGet(app: App, offerId: string): Promise<Response> {
  return guarded(app, async () => {
    const { item, merchant } = await loadOffer(app, offerId);
    return json(app, { label: `${merchant.domain ?? merchant.name} · ${item.title}`, icon: `${app.config.appUrl}/icon.png` });
  });
}

/** POST /api/pay/:id with {account}. */
export async function payPost(app: App, offerId: string, req: Request): Promise<Response> {
  return guarded(app, async () => {
    const { transaction, message } = await startPurchase(app, offerId, await readAccount(req));
    return json(app, { transaction, message });
  });
}

/** GET /api/orders/:id: refreshes from the chain, then reports. */
export async function orderGet(app: App, orderId: string): Promise<Response> {
  return guarded(app, async () => {
    const o = await refreshOrder(app, orderId);
    return json(app, {
      id: o.id, status: o.status, buyer: o.buyerWallet, offer: o.offerId, tx: o.txSig, events: o.events,
    });
  });
}

/** /actions.json (§11.2): lets Blink clients map our share links to the Action endpoints. */
export function actionsJson(app: App): Response {
  return json(app, {
    rules: [
      { pathPattern: "/o/*", apiPath: "/api/actions/offer/*" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  });
}

export function preflight(app: App): Response {
  return new Response(null, { status: 204, headers: actionHeaders(app) });
}

/** POST /agent/v1/offers (§8.2): a `need` envelope in, signed `offer` / `decline` envelopes out. */
export async function merchantAgentPost(app: App, req: Request): Promise<Response> {
  return guarded(app, async () => {
    const need = envelopeSchema.safeParse(await req.json().catch(() => null));
    if (!need.success || need.data.type !== "need") throw new Refused("expected a vcx-agent/1 need envelope");
    return json(app, { offers: await answerNeed(app, need.data) });
  });
}

/** GET /.well-known/vcx-agent.json (§10): how other apps' agents reach this one. */
export function wellKnown(app: App): Response {
  const base = app.config.appUrl;
  return json(app, {
    v: "vcx-agent/1",
    name: "VeriChainX Sol",
    agent_endpoint: `${base}/agent/v1/offers`,
    verify_endpoint: `${base}/api/verify/{asset}`,
    chains: [solanaChain(app.config.cluster)],
    currencies: [{ symbol: "USDC", chain: solanaChain(app.config.cluster), mint: app.config.usdcMint }],
    settlement_key: app.keys.settlement.publicKey,
    buyer_agent_key: app.keys.anchor.publicKey,
  });
}

/** POST /api/agent/shop {message}: the shopper's agent on Muse Spark or Groq, or the scripted engine without a key. */
export async function shopPost(app: App, req: Request): Promise<Response> {
  return guarded(app, async () => {
    const { message } = (await req.json().catch(() => ({}))) as { message?: unknown };
    if (typeof message !== "string" || !message.trim() || message.length > 500) throw new Refused("message is required");
    const sources = [localSource(app), ...peerSources(), ...(process.env.DEMO_COPIER === "1" ? [copierSource(app)] : [])];
    const out = await shopWithModels(app, message.trim(), sources, app.agentModels ?? []);
    // Offers this app holds get a pay page; ones from other apps' agents are shown but paid there.
    const ids = out.results.map((r) => r.offer?.offer_id).filter((id): id is string => Boolean(id));
    const here = new Set((ids.length ? await app.db.select({ id: offers.id }).from(offers).where(inArray(offers.id, ids)) : [])
      .map((o) => o.id));
    const reply = { ...out, results: out.results.map((r) => ({ ...r, local: here.has(r.offer?.offer_id ?? "") })) };
    const run_id = await saveRun(app, message.trim(), reply);
    return json(app, { ...reply, run_id });
  });
}

/** GET /api/verify/:asset: public check of owner, listing and origin record for any item NFT. */
export async function verifyAssetGet(app: App, assetId: string): Promise<Response> {
  return guarded(app, async () => json(app, await assetReport(app, assetId)));
}

/** GET /api/offers/:offer/status: the newest order on an offer, refreshed from the chain. */
export async function offerStatusGet(app: App, offerId: string): Promise<Response> {
  return guarded(app, async () => json(app, await offerStatus(app, offerId)));
}

/** GET /api/auth/siws: a Sign In With Solana challenge for this host. */
export function siwsGet(app: App, req: Request): Response {
  const { input, cookie } = signInChallenge(app, new URL(req.url).host);
  return Response.json({ input }, { headers: { "set-cookie": setCookie(app, CHALLENGE_COOKIE, cookie, 600) } });
}

/** POST /api/auth/siws {address, signedMessage, signature}: checks the signature and starts a session. */
export async function siwsPost(app: App, req: Request): Promise<Response> {
  return guarded(app, async () => {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (![b.address, b.signedMessage, b.signature].every((v) => typeof v === "string")) throw new Refused("missing sign-in fields");
    const { address, cookie } = completeSignIn(app, readCookie(req, CHALLENGE_COOKIE),
      b as { address: string; signedMessage: string; signature: string });
    const headers = new Headers();
    headers.append("set-cookie", setCookie(app, SESSION_COOKIE, cookie, 12 * 3600));
    headers.append("set-cookie", setCookie(app, CHALLENGE_COOKIE, "", 0));
    return Response.json({ address }, { headers });
  });
}

/** POST /api/auth/logout */
export function logoutPost(app: App): Response {
  return Response.json({ ok: true }, { headers: { "set-cookie": setCookie(app, SESSION_COOKIE, "", 0) } });
}

/** POST /api/local/{fund,send}: the local demo's stand-ins for a faucet and an RPC node. 404 anywhere else. */
export async function localPost(app: App, req: Request, action: string): Promise<Response> {
  return guarded(app, async () => {
    if (process.env.VCX_LOCAL_CHAIN !== "1") throw new NotFound("not found");
    const local = await import("./local");
    const body = (await req.json().catch(() => ({}))) as { address?: unknown; transaction?: unknown };
    if (action === "fund" && typeof body.address === "string") {
      await local.fundWallet(app, body.address);
      return json(app, { funded: body.address });
    }
    if (action === "send" && typeof body.transaction === "string") {
      return json(app, { signature: local.submitSigned(app, body.transaction) });
    }
    throw new NotFound("not found");
  });
}

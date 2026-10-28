import { solanaChain } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { attribute, ownershipCheck } from "@/lib/solana/items";
import { TemplateMismatch } from "@/lib/solana/purchase";

import type { App } from "./app";
import { NotFound, Refused, checkOffer, loadOffer } from "./catalog";
import { refreshOrder, startPurchase } from "./pay";

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

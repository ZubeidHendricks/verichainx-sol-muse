import { generateSigner, signTransaction, type KeypairSigner } from "@metaplex-foundation/umi";
import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";

import { siwsMessage } from "@/lib/siws";
import { parseUsdc } from "@/lib/money";
import { SESSION_COOKIE, completeSignIn, sessionAddress, signInChallenge } from "@/server/auth";
import { siwsGet, siwsPost } from "@/server/handlers";
import {
  createMerchant, getItem, heldItems, makeOffer, manages, prepareOwnerTx, registerItem, startResale, syncItem,
} from "@/server/catalog";
import { refreshOrder, startPurchase } from "@/server/pay";

import { makeTestApp, type TestApp } from "./testApp";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

function signIn(app: TestApp, key: KeypairSigner, domain = "sol.example.test", tamper?: (m: string) => string) {
  const { input, cookie } = signInChallenge(app, "sol.example.test");
  const text = (tamper ?? ((m) => m))(siwsMessage({ ...input, domain }, key.publicKey));
  const msg = new TextEncoder().encode(text);
  return completeSignIn(app, cookie, {
    address: key.publicKey, signedMessage: b64(msg), signature: b64(ed25519.sign(msg, key.secretKey.slice(0, 32))),
  });
}

/** What the browser wallet does with a list/delist transaction from the server. */
async function walletSends(app: TestApp, tx: string, wallet: KeypairSigner) {
  app.local.submit(await signTransaction(app.umi.transactions.deserialize(Buffer.from(tx, "base64")), [wallet]));
}

describe("Sign In With Solana", () => {
  it("signs in with a valid signature and refuses other sites, old nonces and forged signatures", async () => {
    const app = await makeTestApp();
    const key = generateSigner(app.umi);
    const { address, cookie } = signIn(app, key);
    expect(address).toBe(key.publicKey);
    expect(sessionAddress(app, cookie)).toBe(key.publicKey);
    expect(sessionAddress(app, cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();

    expect(() => signIn(app, key, "evil.example")).toThrow("different site");
    expect(() => signIn(app, key, undefined, (m) => m.replace(/Nonce: \w+/, "Nonce: 0000"))).toThrow("old sign-in");
    const other = generateSigner(app.umi);
    const { input, cookie: c } = signInChallenge(app, "sol.example.test");
    const msg = new TextEncoder().encode(siwsMessage(input, key.publicKey));
    expect(() => completeSignIn(app, c, { address: key.publicKey, signedMessage: b64(msg),
      signature: b64(ed25519.sign(msg, other.secretKey.slice(0, 32))) })).toThrow("doesn't match the wallet");

    app.clock.now = new Date(app.clock.now.getTime() + 13 * 3_600_000);
    expect(sessionAddress(app, cookie)).toBeNull();
  });
});

describe("sign-in over HTTP", () => {
  it("sets the challenge cookie, then a session cookie for a valid signature", async () => {
    const app = await makeTestApp();
    const key = generateSigner(app.umi);
    const g = siwsGet(app, new Request("https://sol.example.test/api/auth/siws"));
    const { input } = await g.json();
    expect(input.domain).toBe("sol.example.test");
    const challenge = g.headers.get("set-cookie")!.split(";")[0];
    expect(g.headers.get("set-cookie")).toContain("HttpOnly");

    const msg = new TextEncoder().encode(siwsMessage(input, key.publicKey));
    const body = JSON.stringify({ address: key.publicKey, signedMessage: b64(msg), signature: b64(ed25519.sign(msg, key.secretKey.slice(0, 32))) });
    const ok = await siwsPost(app, new Request("https://sol.example.test/api/auth/siws", { method: "POST", body, headers: { cookie: challenge } }));
    expect(ok.status).toBe(200);
    const session = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(sessionAddress(app, decodeURIComponent(session.split(";")[0].split("=")[1]))).toBe(key.publicKey);

    const noCookie = await siwsPost(app, new Request("https://sol.example.test/api/auth/siws", { method: "POST", body }));
    expect(noCookie.status).toBe(400);
    expect((await noCookie.json()).message).toContain("expired");
  });
});

describe("own-wallet shops and resale", () => {
  it("lists from the shop's own wallet, sells, then the buyer resells it from their wallet", async () => {
    const app = await makeTestApp();
    const maker = generateSigner(app.umi);
    const shop = await createMerchant(app, { name: "Maker", domain: "maker.example", wallet: maker.publicKey });
    expect(shop.custody).toBe("own_wallet");
    expect(manages(shop, maker.publicKey)).toBe(true);
    expect(manages(shop, app.buyer.publicKey, true)).toBe(false);

    const item = await registerItem(app, shop.id, { title: "Woven Market Tote", price: "129", photos: [] });
    expect(app.local.asset(item.asset!).owner).toBe(maker.publicKey); // minted straight to the shop's wallet
    await expect(prepareOwnerTx(app, item.id, "list", app.buyer.publicKey)).rejects.toThrow("shop's own wallet");
    await walletSends(app, await prepareOwnerTx(app, item.id, "list", maker.publicKey), maker);
    expect((await syncItem(app, item.id)).status).toBe("listed");

    // Delist and relist from the wallet, read back from the chain each time.
    await walletSends(app, await prepareOwnerTx(app, item.id, "delist", maker.publicKey), maker);
    expect((await syncItem(app, item.id)).status).toBe("delisted");
    await walletSends(app, await prepareOwnerTx(app, item.id, "list", maker.publicKey), maker);
    expect((await syncItem(app, item.id)).status).toBe("listed");

    const sale = await startPurchase(app, (await makeOffer(app, item.id)).id, app.buyer.publicKey);
    await walletSends(app, sale.transaction, app.buyer as KeypairSigner);
    expect((await refreshOrder(app, sale.order.id)).status).toBe("paid");
    expect(app.local.tokenBalance(maker.publicKey, app.config.usdcMint)).toBe(parseUsdc("127.71"));

    // Resale: the buyer sees what they hold, moves it into their own shop at a new price, and lists it.
    expect((await heldItems(app, app.buyer.publicKey)).map((i) => i.id)).toEqual([item.id]);
    const resale = await startResale(app, item.id, app.buyer.publicKey, "150");
    expect(resale.status).toBe("draft");
    await walletSends(app, await prepareOwnerTx(app, item.id, "list", app.buyer.publicKey), app.buyer as KeypairSigner);
    expect((await syncItem(app, item.id)).status).toBe("listed");
    expect(await heldItems(app, app.buyer.publicKey)).toEqual([]);

    const second = generateSigner(app.umi);
    await app.local.mintUsdc(app.config.usdcMint, app.keys.feePayer, second.publicKey, parseUsdc("200"));
    const resold = await startPurchase(app, (await makeOffer(app, item.id)).id, second.publicKey);
    expect(resold.message).toContain("150.00 USDC");
    await walletSends(app, resold.transaction, second);
    expect((await refreshOrder(app, resold.order.id)).status).toBe("paid");
    expect(app.local.asset(item.asset!).owner).toBe(second.publicKey);
    expect((await getItem(app, item.id)).status).toBe("sold");

    // One shop per wallet: naming a shop takes over the resale shop, and a second shop is refused.
    const named = await createMerchant(app, { name: "Thandi's Finds", domain: "Thandi.example", wallet: app.buyer.publicKey });
    expect(named).toMatchObject({ id: resale.merchantId, name: "Thandi's Finds", domain: "thandi.example" });
    await expect(createMerchant(app, { name: "Another", wallet: app.buyer.publicKey }))
      .rejects.toThrow("This wallet already runs Thandi's Finds. Each shop needs its own wallet.");
  });
});

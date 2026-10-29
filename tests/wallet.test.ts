import { signTransaction } from "@metaplex-foundation/umi";
import { describe, expect, it } from "vitest";

import { canPay, payWithWallet, walletChain } from "@/lib/wallet";
import { createMerchant, listItem, makeOffer, registerItem } from "@/server/catalog";
import { payPost } from "@/server/handlers";
import { refreshOrder } from "@/server/pay";
import { schema } from "@/server/db";

import { makeTestApp, type TestApp } from "./testApp";

/** A Wallet Standard wallet holding the test buyer's key, sending to the local chain. */
function fakeWallet(app: TestApp, chains = ["solana:devnet"]) {
  const account = { address: app.buyer.publicKey, publicKey: new Uint8Array(32), chains, features: [] };
  return {
    version: "1.0.0", name: "Test Wallet", icon: "data:image/svg+xml,<svg/>", chains, accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "solana:signAndSendTransaction": {
        version: "1.0.0", supportedTransactionVersions: [0],
        signAndSendTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          const tx = await signTransaction(app.umi.transactions.deserialize(transaction), [app.buyer]);
          app.local.submit(tx);
          return [{ signature: tx.signatures[0] }];
        },
      },
    },
  } as never;
}

describe("buying in the app with a browser wallet", () => {
  it("connects, gets the purchase from the pay endpoint, and the wallet signs and sends it", async () => {
    const app = await makeTestApp();
    const m = await createMerchant(app, { name: "Lerato Bags", domain: "lerato-bags.example" });
    const item = await listItem(app, (await registerItem(app, m.id, { title: "Woven Market Tote", price: "129", photos: [] })).id);
    const offer = await makeOffer(app, item.id);
    const chain = walletChain("devnet");
    const wallet = fakeWallet(app);
    expect(canPay(wallet, chain)).toBe(true);
    expect(canPay(fakeWallet(app, ["solana:mainnet"]), chain)).toBe(false);

    const route = (async (url: string, init: RequestInit) =>
      payPost(app, url.split("/").pop()!, new Request(`https://sol.example.test${url}`, init))) as typeof fetch;
    const paid = await payWithWallet(wallet, offer.id, chain, route);
    expect(paid.account).toBe(app.buyer.publicKey);
    expect(paid.message).toContain("129.00 USDC");

    const [order] = await app.db.select().from(schema.orders);
    expect((await refreshOrder(app, order.id)).status).toBe("paid");
    expect(app.local.asset(item.asset!).owner).toBe(app.buyer.publicKey);
    // A second attempt is refused by the server: the item is sold.
    await expect(payWithWallet(wallet, offer.id, chain, route)).rejects.toThrow("isn't listed");
  });
});

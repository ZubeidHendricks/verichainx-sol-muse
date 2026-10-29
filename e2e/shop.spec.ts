import { expect, test, type Page } from "@playwright/test";

import { installTestWallet, newWalletKey } from "./test-wallet";

/**
 * One wallet, start to finish: it buys the real tote (the copy is flagged), then signs in as a seller,
 * resells it, and names its shop and lists a new item. Serial, sharing one page, because each step builds on the last.
 */
test.describe.serial("shopper and seller on the local chain", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await installTestWallet(page, newWalletKey());
  });
  test.afterAll(() => page.close());

  test("the agent recommends the real tote and flags the copy", async () => {
    await page.goto("/");
    await page.getByLabel("What are you looking for?").fill("a woven tote under $200");
    await page.getByRole("button", { name: "Find offers" }).click();

    const real = page.locator(".tag-wrap").filter({ hasText: "Woven Market Tote" }).filter({ hasText: "lerato-bags.example" });
    const copy = page.locator(".tag-wrap").filter({ hasText: "Woven Market Tote" }).filter({ hasText: "outlet" });
    await expect(real.locator(".stamp")).toHaveText("Verified");
    await expect(copy.locator(".stamp")).toHaveText("Avoid");
    await expect(copy).toContainText("NFT belongs to someone else");

    await real.getByRole("link", { name: "View and pay" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Woven Market Tote");
  });

  test("pays from the wallet in one signature, and the order confirms", async () => {
    await page.getByRole("button", { name: "Pay with Test Wallet" }).click();
    await expect(page.getByText("Paid. The NFT is in the buyer's wallet.")).toBeVisible();
    await page.getByRole("link", { name: "View the order" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paid");
    await expect(page.getByText("Woven Market Tote from lerato-bags.example, 129.00 USDC.")).toBeVisible();
  });

  test("the run is saved", async () => {
    await page.goto("/runs");
    await expect(page.getByRole("link", { name: "a woven tote under $200" })).toBeVisible();
  });

  test("signs in with Solana and resells the tote", async () => {
    await page.goto("/merchant");
    await page.getByRole("button", { name: "Sign in with Test Wallet" }).click();
    await expect(page.getByText("Signed in as")).toBeVisible();

    const held = page.locator("section").filter({ has: page.getByRole("heading", { name: "Items in your wallet" }) });
    await expect(held).toContainText("Woven Market Tote");
    await held.getByLabel("Your price in USDC").fill("150");
    await held.getByRole("button", { name: "List for resale" }).click();

    const resale = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: /^Resale/ }) });
    await expect(resale.getByRole("row").filter({ hasText: "Woven Market Tote" }).locator(".pill")).toHaveText("listed");
  });

  test("names its shop, registers an item and lists it", async () => {
    const add = page.locator("aside.panel");
    await add.getByLabel("Shop name").fill("Test Studio");
    await add.getByRole("button", { name: "Add shop" }).click();
    await expect(add.getByText("Added Test Studio.")).toBeVisible();

    // One shop per wallet: the resale shop takes the new name, the tote still listed in it.
    const shop = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Test Studio" }) });
    await expect(shop.getByRole("row").filter({ hasText: "Woven Market Tote" }).locator(".pill")).toHaveText("listed");
    await shop.getByText("Register an item").click();
    await shop.getByLabel("Title").fill("Beaded Market Bag");
    await shop.getByLabel("Price in USDC").fill("110");
    await shop.getByRole("button", { name: "Register item" }).click();
    await expect(shop.getByText("Registered Beaded Market Bag.")).toBeVisible();

    const row = shop.getByRole("row").filter({ hasText: "Beaded Market Bag" });
    await row.getByRole("button", { name: "List" }).click();
    await expect(row.locator(".pill")).toHaveText("listed");
  });

  test("a Shopify buyer claims the item's NFT with the order's email", async () => {
    const r = await page.request.post("/api/local/shopify-order", { data: { email: "thandi@example.com" } });
    const { claim_url: url } = await r.json();
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everyday Woven Basket");
    await page.getByLabel("Email you ordered with").fill("someone@else.com");
    await page.getByRole("button", { name: "Use Test Wallet" }).click();
    await expect(page.getByLabel("Your Solana wallet address")).not.toHaveValue("");
    await page.getByRole("button", { name: "Claim the NFT" }).click();
    await expect(page.locator(".notice.error")).toHaveText("That isn't the email on the order.");

    await page.getByLabel("Email you ordered with").fill("thandi@example.com");
    await page.getByRole("button", { name: "Claim the NFT" }).click();
    await expect(page.getByText(/^Claimed\. The NFT is in wallet/)).toBeVisible();
    await page.getByRole("link", { name: "Check the NFT" }).click();
    await expect(page.getByText("Everyday Woven Basket").first()).toBeVisible();
  });
});

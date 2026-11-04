# Demo video: 3 minutes

Narration is about 420 words, read at an easy pace. Times are targets; the cuts are where to trim if you run long.

## Before you record

- Use https://verichainx-sol-muse.vercel.app in a clean browser window at 1440 wide, zoom 110%.
- Install Phantom on devnet with a little test USDC (the faucet button on an offer page) for the shopper's purchase.
- Make the company board ahead of time, so the recording doesn't wait on setup:
  1. Open `/teams` and start a board, for example "Northwind Events".
  2. Copy the invite link and open it in a second browser profile as a member, "Thandi".
  3. Leave both windows signed in.
- Do one full rehearsal locally on Groq (`AGENT_PROVIDER=groq`) first. The live take on prod uses Muse Spark: about
  R0.5–1 per take for both scenes, so keep it to two or three takes.
- Set the currency picker to ZAR (or your judges' currency) before the board scene.
- Stock is real: the live Woven Market Tote has 60, so only one 40-tote payment goes through. Rehearse up to the
  "Pay … USDC" button and press it only in the final take. If you need another take, the shop's stock has to be reset
  first (`npm run devnet:seed` against the live database sets it back to 60), or use the 25 leather wallets example
  instead (120 in stock).

## Script

### 0:00–0:15 · The problem

**Screen:** home page, the hero and the company card.

> AI agents are starting to shop for us. But an agent can't tell a maker's real tote from a copy with stolen photos,
> and when a company lets an agent buy, nobody can prove what was bought or from whom. VeriChainX fixes both, with
> Meta's Muse Spark doing the shopping and Solana holding the proof.

### 0:15–1:10 · A shopper's agent

**Screen:** type "A woven tote for under $200" in the chat and send.

> I ask my agent for a woven tote. Shop agents answer, each one a Muse Spark agent pitching from its own catalogue,
> in signed messages.

**Screen:** the pitches arrive; scroll to the copier's offer marked Avoid, then the real tote marked Verified.

> My agent, also Muse Spark, checks every pitch against Solana: who the seller is, who holds the item's NFT, its
> origin record, the photos and the price. This outlet claims the same tote at 45% off, but the item's NFT belongs to
> another seller. Avoid. Code makes that call, so the model can't recommend something the checks rule out.

**Screen:** on the Verified tote, point at the 0–100 score and the price with its rand amount, press View and pay,
then pay and sign in Phantom.

> One signature. A single transaction pays the maker in USDC, takes a 1% fee and moves the ownership NFT to me.
> Either all of it lands or none of it does.

**Screen:** the order page turning to paid; the NFT's origin record. *(Cut here if long: skip the origin record.)*

### 1:10–2:35 · A procurement agent for a company

**Screen:** the company board. Point at the ledger: wallet balance, the monthly gauge, the policy.

> Now the same checks for a company. This board has its own wallet and a spending policy: verified sellers only, a
> limit per order and per month.

**Screen:** press the "40 woven tote bags for conference speakers" example, then Ask.

> I ask the procurement agent for forty tote bags on a six-thousand-dollar budget. It sources from makers on Solana
> and from Shopify stores, and every option gets the same checks, plus the company's rules and the shop's stock.

**Screen:** the agent's summary appears and the best option is already on the Shortlist. Open the "options don't
pass the policy" drawer under the lanes for a second.

> The agent puts the best option that passes on the shortlist. Options that break a rule never reach the lanes: the
> outlet copies, and store items the company wallet can't pay for. They wait down here, with the reason.

**Screen:** in the second window, Thandi votes Must have; back in the first, vote Nice to have. The meter fills.

> The team votes: must have, nice to have, or skip. The board updates itself, and it flags when the team is split.

**Screen:** press Approve and pay, then "Pay … USDC". *(Cut here if long: skip the vote from the second window.)*

> Only an approver can pay, and code checks the policy again at that moment, whatever the votes say. The company
> wallet buys one lot NFT for all forty units, carrying the maker's origin record.

**Screen:** the card moves to Ordered and the wallet and month figures drop; open Transaction on Solana Explorer.

> That's the company's proof of what it bought, from whom, and that the seller was real.

### 2:35–3:00 · How it's built

**Screen:** `/developers` page, then the GitHub repo.

> Muse Spark runs the shopper's agent, every shop's agent, the procurement agent and the photo check. Code checks
> every claim against Solana before money moves. Other agents can use the same checks over MCP. It's open source and
> live on devnet today.

## Shots to have ready as cutaways

- Solana Explorer for the shopper's purchase: the USDC split and the NFT transfer in one transaction.
- The run page (`/runs/:id`) showing which engine answered each turn.
- A phone-width view of the board, if there's time.

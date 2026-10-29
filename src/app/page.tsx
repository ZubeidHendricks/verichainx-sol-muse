import { ShopChat } from "./ui/shop-chat";

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Shopping agent · Solana</p>
        <h1 className="display">Buy from the shop that holds the item</h1>
        <p>
          Say what you need. The agent asks independent shops for offers, checks on Solana who actually holds each
          item&apos;s ownership NFT, and shows you the evidence before you pay. Payment and the NFT change hands in one
          transaction.
        </p>
      </section>
      <ShopChat />
    </>
  );
}

import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "VeriChainX", template: "%s · VeriChainX" },
  description: "Ask an agent to shop independent makers. It checks who holds each item's ownership NFT on Solana before you pay.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body>
        <header className="site-head">
          <Link href="/" className="brand">VeriChainX</Link>
          <nav aria-label="Main">
            <Link href="/">Shop</Link>
            <Link href="/merchant">Sell</Link>
            <span className="net">Solana devnet</span>
          </nav>
        </header>
        <main className="page">{children}</main>
        <footer className="site-foot">
          Test network only: prices are in test USDC and nothing here costs real money.
        </footer>
      </body>
    </html>
  );
}

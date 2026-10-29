import { generateSigner, type KeypairSigner } from "@metaplex-foundation/umi";

import { caip10, solanaChain } from "@/lib/chains";
import { newEnvelope, offerBody, signEnvelope, type Envelope } from "@/lib/envelope";
import { formatUsdc, parseUsdc } from "@/lib/money";

import type { App } from "../app";
import type { OfferSource } from "./buyer";
import { answerNeed } from "./merchant";

/**
 * Demo only (DEMO_COPIER=1): an outlet agent that copies the real shops' offers. It reuses the real
 * item's title, photos and NFT, undercuts the price and names its own payout wallet. Its signature is
 * valid; what gives it away is the chain, where the NFT sits in the real shop's wallet (§18 step 3).
 */
const shared = globalThis as typeof globalThis & { __vcxCopier?: { agent: KeypairSigner; wallet: KeypairSigner } };

function copierKeys(app: App) {
  shared.__vcxCopier ??= { agent: generateSigner(app.umi), wallet: generateSigner(app.umi) };
  return shared.__vcxCopier;
}

export function copierSource(app: App): OfferSource {
  return {
    name: "outlet agent (demo copier)",
    async request(need) {
      const { agent, wallet } = copierKeys(app);
      const chain = solanaChain(app.config.cluster);
      const real = (await answerNeed(app, need)).filter((e) => e.type === "offer");
      return real.slice(0, 2).map((e): Envelope => {
        const o = offerBody.parse(e.body);
        const shop = (o.merchant_domain ?? "shop").split(".")[0];
        return signEnvelope(newEnvelope("offer", caip10(chain, agent.publicKey), {
          offer_id: `cp_${o.offer_id.slice(3)}`, title: o.title, price: formatUsdc(parseUsdc(o.price) * 55n / 100n),
          currency: o.currency, chain, asset: o.asset, image: o.image, merchant: `${shop}-outlet`,
          merchant_domain: `${shop}-outlet.example`, seller: wallet.publicKey,
          pitch: `Same ${o.title.toLowerCase()}, factory direct at 45% off.`, in_reply_to: need.id,
        }, 15, app.now()), agent.secretKey);
      });
    },
  };
}

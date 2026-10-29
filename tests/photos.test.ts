import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

import type { Envelope } from "@/lib/envelope";
import type { ChatMessage, ChatModel } from "@/server/agents/llm";
import { verifyOffer } from "@/server/agents/verify";
import { createMerchant, listItem, makeOffer, registerItem } from "@/server/catalog";
import { dhash, fingerprintPhotos, hamming } from "@/server/photos";

import { makeTestApp, type TestApp } from "./testApp";

/** A simple product shot: a coloured bag shape with a handle on a plain ground. */
const shot = (bag: string, ground: string, handle = true) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${ground}"/>
   <path d="M90 150 L310 150 L280 360 L120 360 Z" fill="${bag}"/>
   ${handle ? `<path d="M150 150 C150 60 250 60 250 150" stroke="${bag}" stroke-width="18" fill="none"/>` : ""}
   <rect x="180" y="230" width="40" height="22" fill="#c9a227"/></svg>`)).png().toBuffer();

describe("photo fingerprints", () => {
  let tote: Buffer, toteSmallJpeg: Buffer, basket: Buffer;

  beforeAll(async () => {
    tote = await shot("#8a5a2b", "#f2efe8");
    toteSmallJpeg = await sharp(tote).resize(180).jpeg({ quality: 60 }).toBuffer();
    basket = await shot("#2b5a8a", "#202020", false);
  });

  it("keeps a picture's hash through resizing and recompression, and tells different pictures apart", async () => {
    expect(hamming(await dhash(tote), await dhash(toteSmallJpeg))).toBeLessThanOrEqual(10);
    expect(hamming(await dhash(tote), await dhash(basket))).toBeGreaterThan(10);
  });

  it("fingerprints the photos that load, numbered by position", async () => {
    const prints = await fingerprintPhotos(["https://a/1.png", "https://a/missing.png", "https://a/3.png"],
      async (u) => (u.includes("missing") ? null : tote));
    expect(prints.map((p) => p.id)).toEqual(["R1", "R3"]);
    expect(prints[0].dhash).toMatch(/^[0-9a-f]{16}$/);
  });

  describe("in the verifier", () => {
    let app: TestApp;
    const served = new Map<string, Buffer>();
    const URL_ = "https://cdn.example.test/tote.png";

    async function verdict() {
      const m = await createMerchant(app, { name: "Lerato Bags", domain: `lerato-${served.size}-${Math.random()}.example` });
      served.set(URL_, tote);
      const item = await listItem(app, (await registerItem(app, m.id, { title: "Woven Market Tote", price: "129", photos: [URL_] })).id);
      return { item, check: async () => verifyOffer(app, (await makeOffer(app, item.id)).envelope as Envelope) };
    }

    beforeAll(async () => {
      app = await makeTestApp();
      app.images = async (u) => served.get(u) ?? null;
    });

    it("puts the fingerprints in the origin record and matches the same photo", async () => {
      const { item, check } = await verdict();
      expect((item.fingerprint as { photos: unknown[] }).photos).toHaveLength(1);
      const v = await check();
      expect(v.evidence.find((e) => e.check === "photos")).toMatchObject({ ok: true });
      expect(v.evidence.find((e) => e.check === "photos")?.detail).toMatch(/^listing photo matches registered photo R1/);
    });

    it("flags a listing photo that isn't a registered one, and asks the vision model when there is one", async () => {
      const { check } = await verdict();
      served.set(URL_, basket); // the picture behind the listing URL changed
      app.photoModel = null;
      let v = await check();
      expect(v.evidence.find((e) => e.check === "photos")).toMatchObject({ ok: null, detail: "the listing photo isn't one of the registered photos" });
      expect(v.reasons).toContain("The listing photo isn't one of the item's registered photos.");

      const seen: ChatMessage[][] = [];
      const model = (answer: string): ChatModel => ({ provider: "muse", model: "fake-vision", async chat(messages) {
        seen.push(messages);
        return { message: { role: "assistant", content: answer }, usage: { prompt_tokens: 900, completion_tokens: 30 } };
      } });
      app.photoModel = model('{"same": false, "reason": "A blue basket without a handle, not the brown tote."}');
      v = await check();
      expect(v.evidence.find((e) => e.check === "photos")).toMatchObject({ ok: false, detail: "muse:fake-vision: A blue basket without a handle, not the brown tote." });
      expect(v.recommendation).toBe("caution");
      const parts = seen[0][1].content as { type: string }[];
      expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);

      // The same pair isn't sent again.
      await check();
      expect(seen).toHaveLength(1);
    });
  });
});

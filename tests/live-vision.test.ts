/**
 * Live photo comparison (opt-in, costs API usage): `LIVE_VISION=1 npx vitest run tests/live-vision.test.ts` uses
 * Groq's Llama vision model; add `LIVE_PROVIDER=muse` for Muse Spark. Two calls: the same tote, and a different bag.
 */
import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { visionModelFromEnv } from "@/server/agents/llm";
import { judgePhotos } from "@/server/agents/vision";
import { toDataUrl } from "@/server/photos";

describe.runIf(process.env.LIVE_VISION === "1")("live photo comparison", () => {
  it("tells the registered tote from a different bag", async () => {
    process.loadEnvFile(".env.local");
    const model = visionModelFromEnv({ ...process.env, PHOTO_MODEL: process.env.LIVE_PROVIDER ?? "groq" })!;
    const tote = readFileSync("public/demo/woven-market-tote.jpg");
    // The same tote, photographed closer and on a different ground.
    const closer = await sharp(tote).extract({ left: 90, top: 90, width: 460, height: 500 }).modulate({ brightness: 0.9, hue: 8 }).toBuffer();
    const other = readFileSync("public/demo/everyday-leather-tote.jpg");
    const registered = [await toDataUrl(tote)];

    const same = await judgePhotos(model, registered, await toDataUrl(closer));
    const different = await judgePhotos(model, registered, await toDataUrl(other));
    console.log(JSON.stringify({ same, different }, null, 2));
    expect(same.same).toBe(true);
    expect(different.same).toBe(false);
  }, 240_000);
});

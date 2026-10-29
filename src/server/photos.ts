import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

/**
 * §9 photos. Each registered photo gets a difference hash (dHash): 64 bits that survive resizing and
 * recompression but change when the picture does. A listing photo within MATCH_BITS of a registered one is the
 * same picture. Anything else goes to the vision model, if one is set, to judge whether it shows the same item.
 */
export type PhotoPrint = { id: string; url: string; dhash: string; sha256: string };
export type ImageLoader = (url: string) => Promise<Buffer | null>;

export const MATCH_BITS = 10;
const MAX_BYTES = 8 * 1024 * 1024;

export async function dhash(image: Buffer): Promise<string> {
  const px = await sharp(image).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

/** Fingerprints for the photos that load, as R1, R2… in the order given. */
export async function fingerprintPhotos(urls: string[], load: ImageLoader): Promise<PhotoPrint[]> {
  const prints: PhotoPrint[] = [];
  for (const [i, url] of urls.entries()) {
    const img = await load(url).catch(() => null);
    if (!img) continue;
    prints.push({ id: `R${i + 1}`, url, dhash: await dhash(img), sha256: createHash("sha256").update(img).digest("hex") });
  }
  return prints;
}

/** The closest registered photo to `img`. */
export async function closestPrint(img: Buffer, prints: PhotoPrint[]) {
  const h = await dhash(img);
  return prints.map((p) => ({ print: p, bits: hamming(h, p.dhash) })).sort((a, b) => a.bits - b.bits)[0] ?? null;
}

/**
 * Fetches a photo over https, up to 8 MB, within 8 seconds. This app's own static photos are read from public/,
 * so seeding works while the server is stopped.
 */
export function httpImageLoader(appUrl: string): ImageLoader {
  const publicDir = resolve("public");
  return async (url) => {
    if (url.startsWith(`${appUrl}/`)) {
      const file = resolve(publicDir, `.${new URL(url).pathname}`);
      if (file.startsWith(`${publicDir}/`)) return readFile(file).catch(() => null);
    }
    if (!url.startsWith("https://")) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length <= MAX_BYTES ? buf : null;
  };
}

/** A JPEG data URL no larger than `maxSide`, for sending to a vision model. */
export async function toDataUrl(img: Buffer, maxSide = 768): Promise<string> {
  const jpg = await sharp(img).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/**
 * Renders the demo shops' product photos (simple illustrations) into public/demo. Run once; the PNGs are committed.
 *
 *   node scripts/demo-photos.mts
 */
import { mkdirSync } from "node:fs";

import sharp from "sharp";

const W = 640;
const frame = (ground: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 640 640">
  <defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  <rect width="640" height="640" fill="${ground}"/><rect width="640" height="640" fill="url(#g)"/>
  <ellipse cx="320" cy="560" rx="210" ry="22" fill="#000" opacity="0.12"/>${body}</svg>`;

const weave = (x: number, y: number, w: number, h: number, a: string, b: string) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${b}"/>`;
  for (let r = 0; r < h / 20; r++) for (let c = 0; c < w / 40; c++) {
    s += `<rect x="${x + c * 40 + (r % 2) * 20}" y="${y + r * 20}" width="20" height="20" fill="${a}"/>`;
  }
  return s;
};

const PHOTOS: Record<string, string> = {
  "woven-market-tote": frame("#e9e1d3", `
    <clipPath id="t"><path d="M150 230 L490 230 L455 545 L185 545 Z"/></clipPath>
    <path d="M230 235 C230 110 410 110 410 235" stroke="#6b4423" stroke-width="22" fill="none" stroke-linecap="round"/>
    <g clip-path="url(#t)">${weave(140, 230, 360, 320, "#c8a46a", "#b08850")}</g>
    <path d="M150 230 L490 230 L455 545 L185 545 Z" fill="none" stroke="#8a6436" stroke-width="6"/>
    <rect x="296" y="300" width="48" height="28" rx="4" fill="#c9a227" stroke="#8a6d12" stroke-width="3"/>`),
  "everyday-woven-basket": frame("#dfe7e2", `
    <clipPath id="b"><path d="M130 300 Q320 260 510 300 L470 530 Q320 560 170 530 Z"/></clipPath>
    <path d="M200 300 C200 170 440 170 440 300" stroke="#5a3a1c" stroke-width="18" fill="none"/>
    <g clip-path="url(#b)">${weave(120, 260, 400, 300, "#d6b98a", "#a98352")}</g>
    <path d="M130 300 Q320 260 510 300" stroke="#7a5630" stroke-width="10" fill="none"/>`),
  "everyday-leather-tote": frame("#ece6df", `
    <path d="M235 230 C235 120 405 120 405 230" stroke="#3b2414" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M140 230 L500 230 L470 545 L170 545 Z" fill="#7a4a2a"/>
    <path d="M140 230 L500 230 L497 262 L143 262 Z" fill="#5f381f"/>
    <path d="M160 270 L480 270" stroke="#e8d3b5" stroke-width="3" stroke-dasharray="10 8"/>
    <path d="M185 530 L455 530" stroke="#e8d3b5" stroke-width="3" stroke-dasharray="10 8"/>`),
  "slim-leather-wallet": frame("#e4e8ee", `
    <rect x="150" y="210" width="340" height="240" rx="18" fill="#8a5232"/>
    <rect x="150" y="210" width="340" height="110" rx="18" fill="#a2643f"/>
    <rect x="166" y="226" width="308" height="208" rx="12" fill="none" stroke="#f0dcc0" stroke-width="3" stroke-dasharray="9 7"/>
    <circle cx="420" cy="320" r="10" fill="#c9a227"/>`),
  "everyday-canvas-tote": frame("#e6ebf0", `
    <path d="M235 235 C235 130 405 130 405 235" stroke="#2e3b4e" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M150 235 L490 235 L490 545 L150 545 Z" fill="#4f6b5a"/>
    <path d="M150 235 L490 235 L490 275 L150 275 Z" fill="#3e5748"/>
    <rect x="250" y="340" width="140" height="110" fill="#5f7d6a" stroke="#d9e3dc" stroke-width="3" stroke-dasharray="8 6"/>`),
};

mkdirSync("public/demo", { recursive: true });
for (const [slug, svg] of Object.entries(PHOTOS)) {
  await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(`public/demo/${slug}.jpg`);
  console.log(`public/demo/${slug}.jpg`);
}

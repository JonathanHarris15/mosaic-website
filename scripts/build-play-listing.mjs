// Builds the Google Play store-listing graphics from the existing brand art.
// Play requires: a 512x512 icon and a 1024x500 feature graphic.
//   node scripts/build-play-listing.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const NAVY = "#182F57";
const PARCHMENT = "#FBF7F0";
const OUT = "build/play";

await mkdir(OUT, { recursive: true });

// 1. Store icon — 512x512, flattened onto navy (Play rejects transparency here).
await sharp("assets/icon-only.png")
  .resize(512, 512, { fit: "contain", background: NAVY })
  .flatten({ background: NAVY })
  .png()
  .toFile(`${OUT}/icon-512.png`);

// 2. Feature graphic — 1024x500. Seal on the left, wordmark on the right.
//    Text is drawn as an SVG layer; librsvg resolves the font from the system,
//    so this sticks to Georgia, which ships with Windows and macOS.
const seal = await sharp("assets/icon-only.png")
  .resize(360, 360, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const wordmark = Buffer.from(`
<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <text x="450" y="228" font-family="Georgia, 'Times New Roman', serif"
        font-size="72" fill="${PARCHMENT}">Mosaic Manager</text>
  <text x="452" y="290" font-family="Georgia, 'Times New Roman', serif"
        font-size="30" fill="${PARCHMENT}" opacity="0.72">Worship planning and</text>
  <text x="452" y="332" font-family="Georgia, 'Times New Roman', serif"
        font-size="30" fill="${PARCHMENT}" opacity="0.72">shepherding for Mosaic Church</text>
</svg>`);

await sharp({
  create: { width: 1024, height: 500, channels: 4, background: NAVY },
})
  .composite([
    { input: seal, top: 70, left: 60 },
    { input: wordmark, top: 0, left: 0 },
  ])
  .png()
  .toFile(`${OUT}/feature-graphic-1024x500.png`);

console.log(`wrote ${OUT}/icon-512.png`);
console.log(`wrote ${OUT}/feature-graphic-1024x500.png`);

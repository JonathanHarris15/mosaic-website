/* ============================================================
   build-launch-assets.mjs — generate the @capacitor/assets source
   set (assets/) from the Mosaic seal.

   Produces:
     assets/icon-only.png        1024  seal on navy (iOS + Android legacy; opaque)
     assets/icon-foreground.png  1024  seal on transparent, sized to Android's
                                       adaptive-icon safe zone (~62%)
     assets/icon-background.png  1024  solid navy (Android adaptive background)
     assets/splash.png           2732  seal on parchment (light)
     assets/splash-dark.png      2732  seal on navy (dark)

   Then run:  npx capacitor-assets generate --android   (iOS on the Mac)

   Usage:  node scripts/build-launch-assets.mjs
   ============================================================ */

import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("@capacitor/assets")] }));

const SRC = "design/mosaic-seal-1024.png";
const NAVY = "#182F57";        // icon bg + dark splash-adjacent brand primary
const NAVY_DARK = "#0E1C36";   // dark splash bg
const PARCHMENT = "#FBF7F0";   // light splash bg

// Tight bbox of the seal disc (alpha > 40), measured from the source.
const BOX = { left: 171, top: 169, width: 685, height: 686 };

async function disc() {
  return sharp(SRC).extract(BOX).toBuffer();
}

// Center a seal sized to `fillW` px onto a `size` px canvas of `bg`
// (bg = hex string for opaque, or null for transparent).
async function compose(size, fillW, bg, outfile) {
  const seal = await sharp(await disc())
    .resize(fillW, fillW, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const base = bg
    ? sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    : sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const off = Math.round((size - fillW) / 2);
  await base.composite([{ input: seal, left: off, top: off }]).png().toFile(outfile);
  console.log("  wrote", outfile);
}

await mkdir("assets", { recursive: true });

// Icons
await compose(1024, Math.round(1024 * 0.82), NAVY, "assets/icon-only.png");
await compose(1024, Math.round(1024 * 0.62), null, "assets/icon-foreground.png"); // adaptive safe zone
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: NAVY } })
  .png().toFile("assets/icon-background.png");
console.log("  wrote assets/icon-background.png");

// Splashes (logo ~26% of the 2732 canvas, centered)
await compose(2732, Math.round(2732 * 0.26), PARCHMENT, "assets/splash.png");
await compose(2732, Math.round(2732 * 0.26), NAVY_DARK, "assets/splash-dark.png");

console.log("done.");

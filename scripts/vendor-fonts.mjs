/* ============================================================
   vendor-fonts.mjs — self-host every Google Font the app uses.

   1. Scans public/ for distinct fonts.googleapis.com/css2 URLs.
   2. Fetches each stylesheet with a modern Chrome UA so Google
      returns woff2 (incl. the variable Material Symbols icon font).
   3. Downloads every referenced woff2 into public/fonts/files/,
      deduping by content-hashed filename.
   4. Emits public/fonts.css with @font-face src rewritten to local
      paths. The codemod later swaps all Google <link>s for this file.

   Usage:  node scripts/vendor-fonts.mjs
   ============================================================ */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const FILES_DIR = join(PUBLIC, "fonts", "files");

// Chrome UA => Google serves woff2 + variable fonts.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&");
}

// ---- 1. collect distinct css2 URLs from all HTML ----
const htmlFiles = (await readdir(PUBLIC)).filter((f) => f.endsWith(".html"));
const cssUrls = new Set();
for (const f of htmlFiles) {
  const html = await readFile(join(PUBLIC, f), "utf8");
  for (const m of html.matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g)) {
    cssUrls.add(decodeEntities(m[0]));
  }
}
console.log(`Found ${cssUrls.size} distinct Google Fonts stylesheet(s).`);

// ---- 2 + 3. fetch each stylesheet, download woff2 files ----
await mkdir(FILES_DIR, { recursive: true });
const seenWoff2 = new Map(); // gstatic url -> local filename
const cssBlocks = [];

for (const cssUrl of cssUrls) {
  const res = await fetch(cssUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${cssUrl}`);
  let css = await res.text();

  const woff2Urls = [...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)"']+\.woff2/g)].map((m) => m[0]);
  for (const url of new Set(woff2Urls)) {
    if (!seenWoff2.has(url)) {
      const name = basename(new URL(url).pathname); // content-hashed by Google
      const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
      await writeFile(join(FILES_DIR, name), buf);
      seenWoff2.set(url, name);
    }
    css = css.split(url).join(`fonts/files/${seenWoff2.get(url)}`);
  }
  cssBlocks.push(`/* ${cssUrl} */\n${css.trim()}`);
}

// ---- 4. write combined fonts.css ----
const header =
  "/* ============================================================\n" +
  "   fonts.css — self-hosted Google Fonts (generated).\n" +
  "   Regenerate with:  node scripts/vendor-fonts.mjs\n" +
  "   Do not edit by hand.\n" +
  "   ============================================================ */\n\n";
await writeFile(join(PUBLIC, "fonts.css"), header + cssBlocks.join("\n\n") + "\n");

console.log(`Downloaded ${seenWoff2.size} unique woff2 file(s) -> public/fonts/files/`);
console.log(`Wrote public/fonts.css`);

/* ============================================================
   rewrite-cdn.mjs — one-pass codemod: point every page at the
   local, vendored assets instead of CDNs. Idempotent.

   Per HTML page it:
     1. swaps each vendored library URL -> local path (manifest);
     2. removes all Google Fonts <link>s (stylesheets + preconnects)
        and links the self-hosted public/fonts.css instead;
     3. replaces the Tailwind Play-CDN <script> with a <link> to the
        compiled public/mosaic.css, and drops the now-dead
        mosaic-theme.js <script>;
     4. converts every <style type="text/tailwindcss"> block to a
        plain <style>: blocks using @apply/@layer are compiled via
        Tailwind first (kept per-page to preserve scoping), the rest
        just lose the CDN-only type attribute.

   Usage:  node scripts/rewrite-cdn.mjs
   ============================================================ */

import { JS_CSS_ASSETS } from "./asset-manifest.mjs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const twConfig = require("../tailwind.config.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

const CSS_LINKS =
  '<link rel="stylesheet" href="mosaic.css" />\n' +
  '    <link rel="stylesheet" href="fonts.css" />';

const NEEDS_COMPILE = /@apply|@layer|@tailwind|@screen|theme\(|@variants/;

// Compile a single text/tailwindcss block (resolves @apply against the
// theme). No @tailwind directives in the input => output is only the
// resolved rules, never the whole framework.
async function compileBlock(css) {
  const res = await postcss([tailwind({ ...twConfig, content: [{ raw: "", extension: "html" }] })])
    .process(css, { from: undefined });
  return res.css.trim();
}

async function processHtml(name, src) {
  let out = src;
  const notes = [];

  // 1. vendored library URL swaps
  for (const { url, local } of JS_CSS_ASSETS) {
    if (out.includes(url)) { out = out.split(url).join(local); notes.push(local.split("/").pop()); }
  }

  // 2. remove Google Fonts <link>s (css2 stylesheets + preconnects)
  const beforeFonts = out;
  out = out.replace(/[ \t]*<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\n?/gi, "");
  const removedFonts = beforeFonts !== out;

  // 3. Tailwind Play-CDN <script> -> compiled mosaic.css + fonts.css links
  let insertedCss = out.includes('href="mosaic.css"');
  if (!insertedCss) {
    const twScript = /[ \t]*<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>/i;
    if (twScript.test(out)) { out = out.replace(twScript, "    " + CSS_LINKS); insertedCss = true; }
  }
  // drop dead mosaic-theme.js loader
  const hadTheme = /<script src="mosaic-theme\.js"><\/script>/.test(out);
  out = out.replace(/[ \t]*<script src="mosaic-theme\.js"><\/script>\n?/g, "");
  // fallback: page had fonts/theme but no tailwind script -> insert before </head>
  if (!insertedCss && (removedFonts || hadTheme)) {
    out = out.replace(/([ \t]*)<\/head>/i, `    ${CSS_LINKS}\n$1</head>`);
    insertedCss = true;
  }

  // 4. text/tailwindcss blocks -> plain <style> (compile if needed)
  const blockRe = /<style type="text\/tailwindcss">([\s\S]*?)<\/style>/gi;
  const blocks = [...out.matchAll(blockRe)];
  for (const m of blocks) {
    const inner = m[1];
    if (NEEDS_COMPILE.test(inner)) {
      const compiled = await compileBlock(inner);
      out = out.replace(m[0], `<style>\n${compiled}\n    </style>`);
      notes.push("compiled-tw-block");
    } else {
      out = out.replace(m[0], `<style>${inner}</style>`);
      notes.push("plain-tw-block");
    }
  }

  return { out, changed: out !== src, notes };
}

const files = (await readdir(PUBLIC)).filter((f) => f.endsWith(".html"));
let changedCount = 0;
for (const f of files) {
  const src = await readFile(join(PUBLIC, f), "utf8");
  const { out, changed, notes } = await processHtml(f, src);
  if (changed) {
    await writeFile(join(PUBLIC, f), out);
    changedCount++;
    console.log(`  edited  ${f}  [${[...new Set(notes)].join(", ")}]`);
  } else {
    console.log(`  skip    ${f}`);
  }
}
console.log(`\n${changedCount} file(s) edited.`);

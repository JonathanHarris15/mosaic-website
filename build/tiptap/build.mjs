/* ============================================================
   build.mjs — bundle TipTap core + the extension set the Care List
   editor uses (must match shepherding-care-list.js) + a single
   ProseMirror instance into ONE offline IIFE, exposed as
   window._TipTapLib, for the mobile shell (fully vendored, no CDN).

   Run from the repo root:  npm run vendor:tiptap
   ============================================================ */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, "..", "..", "public", "vendor", "tiptap", "tiptap.bundle.js");

await build({
  entryPoints: [join(here, "entry.js")],
  bundle: true,
  format: "iife",
  minify: true,
  legalComments: "none",
  outfile,
});

console.log("Built " + outfile);

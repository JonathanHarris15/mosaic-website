#!/usr/bin/env node
/* ============================================================
   check-design-components.mjs — is anything using a component that
   does not exist, or defining one nobody uses?

   The generator keeps the four outputs identical to each other. This
   checks the thing a generator cannot: that the pages actually reach for
   classes the stylesheet defines, and that the stylesheet is not carrying
   components nothing draws.

   Two findings:

     GHOST     markup uses .m-something that no component defines. It
               renders as nothing at all — the silent kind of broken.
     UNUSED    a component nobody has adopted yet. Not an error: a
               component can land before its first caller. Reported so
               the number is visible rather than quietly growing.

   Usage:
     npm run check:design-components
     npm run check:design-components -- --strict   exit 1 on a ghost
   ============================================================ */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "../build/design-components.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

/* Every class the stylesheet actually defines, base and modifier alike. */
const defined = new Set();
for (const c of COMPONENTS) {
  for (const m of c.css.matchAll(/\.(m-[a-z0-9_-]+)/g)) defined.add(m[1]);
}

/* Every m-* class the app reaches for. Static attributes, Alpine's
   :class bindings, and the modifiers mobile/ui.js builds by concatenation. */
const used = new Map();

/* The printed Service Guide templates use `m-` for their own thing —
   m-hymn, m-oos, m-sheet, m-cover. A real namespace collision, but a
   harmless one: those classes live in a print stylesheet the app never
   loads and the app's components never reach a printed page. Renaming
   one of the two namespaces is a bigger call than this check should
   make on its own, so they are excluded and the collision is recorded. */
const skip = new RegExp([
  "vendor", "fonts/", "assets/", "\\.min\\.",
  "guide-seed\\.js", "guide-components\\.js",
  // Generated output, not markup. Scanning a stylesheet for "usage" finds
  // its own selectors and its keyframe names — m-spin is an animation, not
  // a class, and reading it as one reported a ghost for something real.
  "mosaic\\.css", "mobile/tokens\\.css", "components-demo\\.html",
].join("|"));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(html|js|css)$/.test(entry)) yield path;
  }
}

function note(cls, where) {
  if (!used.has(cls)) used.set(cls, new Set());
  used.get(cls).add(where);
}

for (const path of walk(join(repo, "public"))) {
  const rel = relative(repo, path).replace(/\\/g, "/");
  if (skip.test(rel)) continue;
  const src = readFileSync(path, "utf8");

  // Plain occurrences inside a class attribute or a quoted class string.
  // Hyphens are part of the name — matching m-icon out of m-icon-btn would
  // report a ghost for a class that exists and mark the real one unused.
  // Leading -- is excluded so --m-focus-ring is not read as a class.
  //
  // ⚠ The ELEMENT may carry hyphens too. It could not until MS-229, so
  // `m-rota__hole-dot` in the markup was read as `m-rota__hole` — which
  // reported a class the page really draws as unused, and would have missed a
  // ghost with a hyphen in its element. Widening only ever matches MORE, so no
  // ghost this caught before can slip through it now.
  for (const m of src.matchAll(/(?<!-)\bm-[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+)?\b/g)) {
    note(m[0], rel);
  }

  // "m-btn--" + variant  →  every variant the source lists.
  for (const m of src.matchAll(/"(m-[a-z-]+--)"\s*\+/g)) {
    const base = m[1].slice(0, -2);
    const comp = COMPONENTS.find((c) => c.cls === base);
    if (!comp) { note(m[1] + "?", rel); continue; }
    for (const values of Object.values(comp.variants ?? {})) {
      for (const v of values) note(`${base}--${v}`, rel);
    }
  }
}

/* Composed names that resolve to the base are fine: .m-btn--md is not a
   class, but md is the default and the base carries it. */
const defaultish = new Set();
for (const c of COMPONENTS) {
  for (const [, values] of Object.entries(c.variants ?? {})) {
    for (const v of values) if (v === "md" || v === "default") defaultish.add(`${c.cls}--${v}`);
  }
}

const ghosts = [...used.entries()]
  .filter(([cls]) => !defined.has(cls) && !defaultish.has(cls))
  .filter(([cls]) => /^m-[a-z]/.test(cls));

const unused = [...defined].filter((cls) => !used.has(cls)).sort();

console.log(`${COMPONENTS.length} components · ${defined.size} classes defined · ${used.size} referenced\n`);

if (ghosts.length) {
  console.log(`GHOST — markup reaches for a class nothing defines (${ghosts.length})`);
  console.log("  These render as nothing. No error, no warning, just missing styling.\n");
  for (const [cls, files] of ghosts.sort()) {
    console.log(`  .${cls}`);
    console.log(`      ${[...files].slice(0, 4).join(", ")}${files.size > 4 ? `, +${files.size - 4}` : ""}`);
  }
  console.log("");
}

if (unused.length) {
  console.log(`UNUSED — defined, nothing draws it yet (${unused.length})`);
  console.log(`  ${unused.join(" ")}`);
  console.log("  Not a fault: a component can land before its first caller.\n");
}

if (!ghosts.length) console.log("No ghosts — every component class the app uses exists.");

if (strict && ghosts.length) process.exit(1);

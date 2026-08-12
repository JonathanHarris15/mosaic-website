#!/usr/bin/env node
/* ============================================================
   compare-design-tokens.mjs — which side moved?

   design-sync has to know this before it writes anything. Pushing when
   the design system is the side that changed erases somebody's decision,
   and the permission prompt shows a path list rather than a diff, so it
   cannot warn them.

   Reads the design system's copy of a token file on stdin, compares the
   @generated block against the local one, and says what differs.

   Usage:
     node scripts/compare-design-tokens.mjs colors.css < remote.css

   Exit codes, so a caller can branch:
     0  identical
     3  they differ  (read the report; do not assume a direction)
     1  something was wrong with the input
   ============================================================ */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(repo, ".claude", "design.json"), "utf8"));

const file = process.argv[2];
if (!file) {
  console.error("usage: compare-design-tokens.mjs <colors.css|spacing.css|typography.css> < remote.css");
  process.exit(1);
}

const clean = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s).replace(/\r\n/g, "\n");

/** Just the generated block — everything outside it belongs to the design
 *  system and is none of our business. */
function generated(text, label) {
  const m = text.match(/\/\* @generated:start [a-z-]+ \*\/\n([\s\S]*?)\/\* @generated:end \*\//);
  if (!m) {
    console.error(`${label}: no @generated block — cannot compare safely`);
    process.exit(1);
  }
  return m[1];
}

/** name -> value, ignoring comments, blank lines and alignment. */
function tokens(block) {
  const out = new Map();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*(?:\/\*.*\*\/)?\s*$/i);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

const localPath = join(repo, config.tokens.localDir, file);
const local = tokens(generated(clean(readFileSync(localPath, "utf8")), "local"));
const remote = tokens(generated(clean(readFileSync(0, "utf8")), "remote"));

const onlyLocal = [...local.keys()].filter((k) => !remote.has(k));
const onlyRemote = [...remote.keys()].filter((k) => !local.has(k));
const changed = [...local.keys()].filter((k) => remote.has(k) && remote.get(k) !== local.get(k));

if (!onlyLocal.length && !onlyRemote.length && !changed.length) {
  console.log(`${file}: identical — ${local.size} tokens`);
  process.exit(0);
}

console.log(`${file}: the two copies differ\n`);

if (changed.length) {
  console.log(`  CHANGED (${changed.length}) — one side edited a token both have`);
  for (const k of changed) {
    console.log(`    ${k}`);
    console.log(`      design system: ${remote.get(k)}`);
    console.log(`      config:        ${local.get(k)}`);
  }
  console.log("\n    If the config moved, push. If the design system moved, somebody");
  console.log("    made a decision in a file whose header says do not hand-edit —");
  console.log("    take it down into the config instead of overwriting it. Ask.\n");
}

if (onlyLocal.length) {
  console.log(`  ONLY IN THE CONFIG (${onlyLocal.length}) — new tokens to push`);
  for (const k of onlyLocal) console.log(`    ${k}: ${local.get(k)}`);
  console.log("");
}

if (onlyRemote.length) {
  console.log(`  ONLY IN THE DESIGN SYSTEM (${onlyRemote.length}) — nothing to win with`);
  for (const k of onlyRemote) console.log(`    ${k}: ${remote.get(k)}`);
  console.log("\n    Adopt these into the config. Pushing without them is a deletion.\n");
}

process.exit(3);

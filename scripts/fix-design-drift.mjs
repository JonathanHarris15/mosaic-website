#!/usr/bin/env node
/* ============================================================
   fix-design-drift.mjs — turn raw colours back into tokens

   The companion to check-design-drift.mjs: that one finds, this one
   mends. Everything it does is mechanical and reversible; anything
   needing a judgement call it reports and leaves alone.

   Three things it will change:

     a raw colour that exactly matches a token   -> var(--token)
     the same inside a Tailwind arbitrary value  -> the class
     a var(--x, #stale) whose fallback has moved -> the current value

   And the rules that keep it safe, each learnt the hard way:

   1. A CSS PROPERTY MUST PRECEDE THE COLOUR. Everywhere else a hex is
      a value rather than a style. setHighlight('#fef08a') is written
      into the Note Body and rendered back later; var() there is stored
      verbatim and draws nothing.

   2. THE ALLOWLIST WINS. .claude/design.json names the literals that
      must stay, each with a reason. auth.js draws the "page didn't
      load" bar, and if the page failed then the stylesheet may have
      too — a var() resolving to nothing removes the property rather
      than falling back, so the bar would be invisible.

   3. AMBIGUITY IS NOT GUESSED. #ffffff is four tokens. The property
      decides: a background takes a surface, ink takes an on-. Where
      that is not enough, it is listed for a person.

   Usage:
     npm run fix:design-drift            report what it would change
     npm run fix:design-drift -- --write apply it
   ============================================================ */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");

const config = JSON.parse(readFileSync(join(repo, ".claude", "design.json"), "utf8"));
const colors = require(join(repo, config.tokens.source)).theme?.extend?.colors ?? {};

const norm = (h) =>
  (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toLowerCase();

const byValue = new Map();
for (const [name, v] of Object.entries(colors)) {
  if (typeof v !== "string" || !v.startsWith("#")) continue;
  const k = norm(v);
  if (!byValue.has(k)) byValue.set(k, []);
  byValue.get(k).push(name);
}

/* Which name to use when several share a value. Keyed by what the property
   is for: "surface" paints a background, "on" paints ink, "line" draws an
   edge. A null means the property is not enough to tell — report it. */
const PREFER = {
  surface: ["surface-container-lowest", "surface", "background", "primary", "secondary",
            "tertiary", "cream", "primary-container", "surface-variant", "primary-fixed-dim"],
  on:      ["on-surface", "on-primary", "on-secondary", "on-tertiary", "on-error",
            "primary", "secondary", "tertiary"],
  line:    ["outline-variant", "outline", "primary", "secondary", "tertiary"],
};

function role(before) {
  const prop = before.match(/([a-zA-Z-]+)\s*:\s*[^:;{]*$/)?.[1]?.toLowerCase() ?? "";
  if (/^(background|background-color)$/.test(prop)) return "surface";
  if (/^(color|fill)$/.test(prop)) return "on";
  if (/border|outline|stroke|shadow/.test(prop)) return "line";
  return null;
}

function pick(names, r) {
  if (names.length === 1) return names[0];
  if (!r) return null;
  return PREFER[r]?.find((n) => names.includes(n)) ?? null;
}

/* ---- What not to touch ------------------------------------- */

function matcher(pattern) {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(",").join("|")})`)
    .replace(/\*\*\//g, " ").replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*").replace(/ /g, ".*");
  return new RegExp(`^${rx}$`);
}
const ignored = (config.drift?.ignore ?? []).map(matcher);
const allow = (config.drift?.allow ?? []).map((a) => ({ ...a, rx: a.match ? new RegExp(a.match) : null }));

const isIgnored = (rel) => ignored.some((rx) => rx.test(rel));
const isAllowed = (rel, line) => allow.some((a) =>
  (!a.file || rel === a.file) && (!a.rx || a.rx.test(line)) && (a.file || a.rx));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = relative(repo, path).replace(/\\/g, "/");
    if (statSync(path).isDirectory()) {
      if (!isIgnored(`${rel}/`) && !isIgnored(rel)) yield* walk(path);
    } else if (/\.(html|js|css)$/.test(entry) && !isIgnored(rel)) {
      yield path;
    }
  }
}

/* ---- The sweep --------------------------------------------- */

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const FALLBACK = /var\(\s*--([a-z0-9-]+)\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/gi;
const CLASS_PREFIX =
  /(bg|text|border|fill|stroke|ring|from|to|via|decoration|outline|shadow|accent|caret|divide|placeholder)-\[$/;

const applied = new Map();
const needsAPerson = [];
let touched = 0;

for (const path of walk(join(repo, "public"))) {
  const rel = relative(repo, path).replace(/\\/g, "/");
  const src = readFileSync(path, "utf8");

  const out = src.split("\n").map((line, i) => {
    if (/<meta|theme-color|msapplication/i.test(line)) return line;
    if (!HEX.test(line)) { HEX.lastIndex = 0; return line; }
    HEX.lastIndex = 0;
    if (isAllowed(rel, line)) return line;

    // A var() whose fallback has gone stale: correct the fallback, keep it.
    let next = line.replace(FALLBACK, (whole, token, hex) => {
      const current = colors[token];
      if (typeof current !== "string" || !current.startsWith("#")) return whole;
      if (norm(current) === norm(hex)) return whole;
      applied.set(`${hex} -> --${token} fallback`, (applied.get(`${hex} -> --${token} fallback`) ?? 0) + 1);
      return `var(--${token}, ${current})`;
    });

    return next.replace(HEX, (raw, idx) => {
      const hex = norm(raw);
      const names = byValue.get(hex);
      if (!names) {
        // No token carries this value, so there is nothing to swap it for —
        // but saying nothing would report "all mended" over a colour that is
        // not accounted for anywhere.
        needsAPerson.push({ rel, ln: i + 1, hex, why: "no token has this value" });
        return raw;
      }

      const before = next.slice(Math.max(0, idx - 120), idx);
      const isClass = CLASS_PREFIX.test(before);
      const r = role(before);

      if (!isClass && !r) {
        needsAPerson.push({ rel, ln: i + 1, hex, why: "a value, not a style — must stay literal or be allowlisted" });
        return raw;
      }
      const token = pick(names, r ?? "surface");
      if (!token) {
        needsAPerson.push({ rel, ln: i + 1, hex, why: `${names.join(" / ")} — the property does not say which` });
        return raw;
      }
      const key = `${hex} -> --${token}`;
      applied.set(key, (applied.get(key) ?? 0) + 1);
      return isClass ? `--CLS--${token}` : `var(--${token})`;
    });
  }).join("\n").replace(/([a-z-]+)-\[--CLS--([a-z0-9-]+)\]/g, "$1-$2");

  if (out !== src) {
    touched += 1;
    if (write) writeFileSync(path, out);
  }
}

/* ---- Report ------------------------------------------------ */

const total = [...applied.values()].reduce((a, b) => a + b, 0);

if (!total && !needsAPerson.length) {
  console.log("Nothing to mend — every colour is already a token or accounted for.");
  process.exit(0);
}

if (total) {
  console.log(`${write ? "CHANGED" : "WOULD CHANGE"} ${total} in ${touched} file(s)\n`);
  for (const [k, n] of [...applied].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
}

if (needsAPerson.length) {
  console.log(`\nNEEDS A DECISION (${needsAPerson.length}) — not touched\n`);
  const grouped = new Map();
  for (const n of needsAPerson) {
    if (!grouped.has(n.why)) grouped.set(n.why, []);
    grouped.get(n.why).push(n);
  }
  for (const [why, items] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(items.length).padStart(4)}  ${why}`);
    for (const i of items.slice(0, 5)) console.log(`          ${i.rel}:${i.ln}  ${i.hex}`);
    if (items.length > 5) console.log(`          … +${items.length - 5}`);
  }
  console.log("\n  Each is either a token the theme is missing, a genuine one-off");
  console.log("  that belongs in drift.allow with a reason, or a value the code");
  console.log("  has to store as a number. Decide, do not sweep.");
}

if (!write) console.log("\nDry run — pass --write to apply.");

#!/usr/bin/env node
/* ============================================================
   build-design-tokens.mjs — tailwind.config.js -> design-system CSS

   The Mosaic Website Design system on claude.ai/design draws with
   CSS custom properties. The app draws with Tailwind utilities.
   Both have to mean the same thing, so one side has to be generated.
   The config wins, because it is what actually renders.

   This rewrites the block between the @generated markers in each
   file under build/design-tokens/, in place. Everything outside the
   markers belongs to the design system — motion, --container-max,
   the .m-* helper classes — and is left alone.

   Usage:
     npm run build:tokens          rewrite the files
     npm run build:tokens -- --check   exit 1 if they are out of date
   ============================================================ */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokensDir = join(repo, "build", "design-tokens");
const check = process.argv.includes("--check");

const theme = require(join(repo, "tailwind.config.js")).theme?.extend ?? {};

/* ---- Grouping ----------------------------------------------
   Tokens are emitted under these headings, in this order. Any key
   the config carries that no group claims falls into "Other", so a
   token added to tailwind.config.js can never vanish just because
   nobody remembered to list it here.
   ------------------------------------------------------------ */

const COLOR_GROUPS = [
  ["Brand core (sampled from the seal)",
    ["navy", "navy-900", "navy-800", "ocean", "steel", "sand", "gold", "cream", "parchment"]],
  ["Primary",
    ["primary", "on-primary", "primary-container", "on-primary-container",
     "primary-fixed", "primary-fixed-dim", "inverse-primary"]],
  ["Secondary",
    ["secondary", "on-secondary", "secondary-container", "on-secondary-container"]],
  ["Tertiary",
    ["tertiary", "on-tertiary", "tertiary-container", "on-tertiary-container"]],
  ["Warm neutral surfaces (cream -> parchment -> white)",
    ["background", "on-background", "surface", "surface-bright", "surface-dim",
     "surface-container-lowest", "surface-container-low", "surface-container",
     "surface-container-high", "surface-container-highest", "surface-variant",
     "on-surface", "on-surface-variant"]],
  ["Lines — warm sand hairlines do the work",
    ["outline", "outline-variant"]],
  ["Status (kept within the palette)",
    ["error", "on-error", "error-container", "on-error-container",
     "success", "success-container", "on-success-container",
     "warning", "warning-container", "on-warning-container"]],
  ["Event colours — a bar and its tint, for the Calendar",
    ["event-steel", "event-steel-tint", "event-ocean", "event-ocean-tint",
     "event-navy", "event-navy-tint", "event-green", "event-green-tint",
     "event-gold", "event-gold-tint", "event-amber", "event-amber-tint",
     "event-plum", "event-plum-tint", "event-rose", "event-rose-tint"]],
  ["Highlighter — Note Module pen colours, outside the brand on purpose",
    ["highlight-yellow", "highlight-green", "highlight-blue",
     "highlight-red", "highlight-orange", "highlight-purple"]],
  ["Inline trigger chips — written into a Note Body, so stored as literals",
    ["chip-tag-added", "chip-tag-removed", "chip-status"]],
  ["Service Notes card — a margin note, not a caution",
    ["note-ink", "note-heading", "note-border", "note-icon"]],
  ["Printed-guide preview — neutral, so the print is judged honestly",
    ["preview-canvas", "preview-scroll", "preview-scroll-hover"]],
  ["Code editor — the Page Template authoring pane, dark by design",
    ["editor-shell", "editor-chrome", "editor-gutter", "editor-surface",
     "editor-scroll", "editor-scroll-hover"]],
  ["Relations Viewer — edge palette, node ink, and the inactive set",
    ["edge-terracotta", "edge-violet", "graph-ink",
     "inactive-surface", "inactive-outline", "on-inactive"]],
  ["Relationship Group bubbles — cycled by group order, so numbered",
    ["graph-1", "graph-2", "graph-3", "graph-4", "graph-5", "graph-6"]],
];

const SPACE_ORDER = ["xs", "base", "sm", "md", "lg", "xl", "gutter", "margin"];
const RADIUS_ORDER = ["none", "sm", "DEFAULT", "md", "lg", "xl", "2xl", "full"];
const SHADOW_ORDER = ["xs", "sm", "md", "lg"];

/* ---- Emitting ---------------------------------------------- */

/** Split an object's keys into [heading, keys] blocks, sweeping the
 *  unclaimed remainder into "Other" so nothing is silently dropped. */
function group(entries, groups) {
  const claimed = new Set();
  const blocks = [];
  for (const [heading, keys] of groups) {
    const present = keys.filter((k) => k in entries);
    present.forEach((k) => claimed.add(k));
    if (present.length) blocks.push({ heading, keys: present });
  }
  const rest = Object.keys(entries).filter((k) => !claimed.has(k));
  if (rest.length) blocks.push({ heading: "Other", keys: rest });
  return blocks;
}

/** Order an object's keys by a preferred list, appending strays. */
function ordered(entries, order) {
  const known = order.filter((k) => k in entries);
  const rest = Object.keys(entries).filter((k) => !order.includes(k));
  return [...known, ...rest];
}

/** A font stack: quote anything that is not a bare CSS keyword. */
function stack(families) {
  const list = Array.isArray(families) ? families : [families];
  return list.map((f) => (/^[a-z][a-z0-9-]*$/.test(f) ? f : `"${f}"`)).join(", ");
}

/** Render blocks of rows into aligned CSS declarations.
 *  A row is { name, value, note? } — note becomes a trailing comment.
 *  "@kind other" tells the Design System pane a value is neither a
 *  colour nor a length, so it does not try to swatch it.
 *  A null row is a blank line. */
function css(blocks, indent = "  ") {
  const rows = blocks.flatMap((b) => b.rows).filter(Boolean);
  const width = Math.max(...rows.map((r) => r.name.length));
  const out = [];
  blocks.forEach((block, i) => {
    if (i > 0) out.push("");
    out.push(`${indent}/* ---- ${block.heading} ---- */`);
    for (const row of block.rows) {
      if (!row) { out.push(""); continue; }
      const pad = " ".repeat(width - row.name.length + 1);
      const decl = `${indent}--${row.name}:${pad}${row.value};`;
      out.push(row.note ? `${decl}   /* ${row.note} */` : decl);
    }
  });
  return out.join("\n");
}

/* ---- The three generated blocks ---------------------------- */

function colors() {
  const entries = theme.colors ?? {};
  const blocks = group(entries, COLOR_GROUPS).map((b) => ({
    heading: b.heading,
    rows: b.keys.map((k) => ({ name: k, value: entries[k] })),
  }));
  return css(blocks);
}

function spacing() {
  const space = theme.spacing ?? {};
  const widths = theme.maxWidth ?? {};
  const radius = theme.borderRadius ?? {};
  const shadow = theme.boxShadow ?? {};
  return css([
    {
      heading: "Spacing (8px rhythm)",
      rows: ordered(space, SPACE_ORDER).map((k) => ({ name: `space-${k}`, value: space[k] })),
    },
    {
      heading: "Layout container",
      rows: Object.keys(widths).map((k) => ({
        name: k === "container" ? "container-max" : `width-${k}`,
        value: widths[k],
      })),
    },
    {
      heading: "Radius (one coherent scale; pills are pills)",
      rows: ordered(radius, RADIUS_ORDER).map((k) => ({
        name: k === "DEFAULT" ? "radius" : `radius-${k}`,
        value: radius[k],
        note: k === "DEFAULT" ? "default card radius" : undefined,
      })),
    },
    {
      heading: "Shadows — ambient navy glow, never harsh",
      rows: ordered(shadow, SHADOW_ORDER).map((k) => ({ name: `shadow-${k}`, value: shadow[k] })),
    },
  ]);
}

function typography() {
  const families = theme.fontFamily ?? {};
  const sizes = theme.fontSize ?? {};

  // fontFamily also carries one alias per role (display-lg, body-md, …)
  // pointing at the same three stacks. Those are Tailwind plumbing, not
  // tokens — emit only the families that are not also a size role.
  const base = Object.keys(families).filter((k) => !(k in sizes));

  const roleRows = [];
  for (const [role, spec] of Object.entries(sizes)) {
    const [size, opts = {}] = Array.isArray(spec) ? spec : [spec, {}];
    if (roleRows.length) roleRows.push(null);   // blank line between roles
    roleRows.push({ name: `${role}-size`, value: size });
    if (opts.lineHeight) {
      roleRows.push({ name: `${role}-line`, value: opts.lineHeight, note: "@kind other" });
    }
    if (opts.letterSpacing) {
      roleRows.push({ name: `${role}-spacing`, value: opts.letterSpacing });
    }
    if (opts.fontWeight) {
      roleRows.push({ name: `${role}-weight`, value: opts.fontWeight });
    }
  }

  return css([
    { heading: "Families", rows: base.map((k) => ({ name: `font-${k}`, value: stack(families[k]) })) },
    { heading: "Role sizes", rows: roleRows },
  ]);
}

/* ---- Splice ------------------------------------------------ */

function splice(file, name, body) {
  const path = join(repo, file);
  // Normalise to LF and drop any byte-order mark. An editor that saves CRLF
  // would otherwise leave --check reporting "stale" forever against an
  // LF-generated block, and a BOM rides along into the design system as three
  // bytes nothing on this side wrote — PowerShell's Set-Content -Encoding utf8
  // adds one, which is how it got in.
  const raw = readFileSync(path, "utf8");
  const hadBom = raw.charCodeAt(0) === 0xFEFF;
  const src = (hadBom ? raw.slice(1) : raw).replace(/\r\n/g, "\n");
  const open = `/* @generated:start ${name} */`;
  const close = "/* @generated:end */";

  const i = src.indexOf(open);
  const j = src.indexOf(close, i);
  if (i === -1 || j === -1) {
    throw new Error(`${file}: no @generated markers for "${name}" — add them or the block cannot be placed`);
  }

  // Compared against the normalised source: the question is whether the
  // token content is current, not whether the bytes match. A BOM is the one
  // byte-level thing worth rewriting for — it is not content, and it travels
  // to the design system.
  const next = `${src.slice(0, i + open.length)}\n${body}\n${src.slice(j)}`;
  if (next === src && !hadBom) return false;
  if (!check) writeFileSync(path, next);
  return true;
}

const work = [
  // For the design system on claude.ai — three files, matching its layout.
  ["build/design-tokens/colors.css", "colors", colors()],
  ["build/design-tokens/spacing.css", "spacing", spacing()],
  ["build/design-tokens/typography.css", "typography", typography()],

  // For the app — the same theme, in one :root block, compiled into
  // mosaic.css so a scrollbar or a canvas has something to call.
  ["build/tailwind-input.css", "app-tokens", [colors(), spacing(), typography()].join("\n\n")],
];

let stale = 0;
for (const [file, name, body] of work) {
  const changed = splice(file, name, body);
  if (changed) stale += 1;
  console.log(`${changed ? (check ? "stale  " : "written") : "current"}  ${file}`);
}

if (check && stale) {
  console.error(`\n${stale} token file(s) are behind tailwind.config.js — run: npm run build:tokens`);
  process.exit(1);
}

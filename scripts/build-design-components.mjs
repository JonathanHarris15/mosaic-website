#!/usr/bin/env node
/* ============================================================
   build-design-components.mjs — one source, four outputs

   build/design-components.mjs holds the definition of every Mosaic
   component. This turns it into:

     build/design-tokens/components.css   for the design system
     build/tailwind-input.css             spliced in, so it reaches
                                          public/mosaic.css and every page
     public/components-demo.html          the gallery — the repo's own
                                          answer to "what does a Badge
                                          look like"
     build/design-system/components/      the .prompt.md files Claude
                                          Design reads when composing

   Four copies that cannot disagree, because none of them is authored.

   Usage:
     npm run build:components
     npm run build:components -- --check   exit 1 if anything is behind
   ============================================================ */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { COMPONENTS, EXTRA_ROOT } from "../build/design-components.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const require_ = createRequire(import.meta.url);
const colors = require_(resolve(dirname(fileURLToPath(import.meta.url)), "..", "tailwind.config.js")).theme.extend.colors;
const changed = [];

function put(rel, next) {
  const path = join(repo, rel);
  let current = null;
  try {
    const raw = readFileSync(path, "utf8");
    current = (raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw).replace(/\r\n/g, "\n");
  } catch { /* new file */ }
  if (current === next) return false;
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
  }
  changed.push(rel);
  return true;
}

/** The first sentence of a summary, without a doubled full stop when the
 *  summary was only one sentence to begin with. */
const firstSentence = (s) => s.split(". ")[0].replace(/\.$/, "");

const GROUPS = ["Core", "Forms", "Display", "Feedback", "Layout"];
const byGroup = (g) => COMPONENTS.filter((c) => c.group === g);

/* ---- 1. The stylesheet ------------------------------------- */

function stylesheet() {
  const parts = [
    "/* ============================================================",
    "   Mosaic Church — Components",
    "   ------------------------------------------------------------",
    "   GENERATED from build/design-components.mjs by",
    "   `npm run build:components`. Do not hand-edit.",
    "",
    "   Plain CSS over the design tokens, deliberately: the desktop is",
    "   Alpine and Tailwind, the phone is Preact and htm, and this is the",
    "   only form all of them — and the design system — can hold at once.",
    "   ============================================================ */",
    "",
    ":root {",
    EXTRA_ROOT,
    "}",
  ];
  for (const g of GROUPS) {
    const list = byGroup(g);
    if (!list.length) continue;
    parts.push("", `/* ── ${g} ${"─".repeat(Math.max(0, 56 - g.length))} */`);
    for (const c of list) {
      parts.push("", `/* ${c.name} — ${firstSentence(c.summary)}. */`, c.css.trim());
    }
  }
  return parts.join("\n") + "\n";
}

/* ---- 2. The prompt files ----------------------------------- */

function prompt(c) {
  const lines = [`**${c.name}** — ${c.summary}`, ""];
  lines.push("```html", ...c.examples, "```", "");

  const vs = Object.entries(c.variants ?? {});
  if (vs.length) {
    for (const [axis, values] of vs) {
      lines.push(`**${axis}:** ${values.map((v) => `\`${v}\``).join(" · ")}`);
    }
    lines.push("");
  }
  lines.push(`Base class \`.${c.cls}\`, modifiers \`.${c.cls}--<variant>\`.`, "");
  for (const n of c.notes ?? []) lines.push(`- ${n}`);
  if (c.notes?.length) lines.push("");
  lines.push(
    "Built from the Mosaic tokens only — no raw colours, no second icon set.",
    "Icons are Material Symbols Outlined."
  );
  return lines.join("\n") + "\n";
}

/* ---- 3. The gallery ---------------------------------------- */

function swatchRow(c) {
  const vs = Object.entries(c.variants ?? {});
  const bits = [];
  for (const ex of c.examples) bits.push(`        <div class="g-item">${ex}</div>`);
  if (!bits.length) bits.push('        <div class="g-item"><em>no example</em></div>');
  const variantLines = vs.length
    ? vs.map(([axis, vals]) => `<div class="g-variants"><b>${axis}</b> ${vals.join(" · ")}</div>`).join("")
    : "";
  return `      <section class="g-card" id="${c.cls}">
        <header>
          <h3>${c.name}</h3>
          <code>.${c.cls}</code>
        </header>
        <p class="g-summary">${c.summary}</p>
        ${variantLines}
        <div class="g-demo">
${bits.join("\n")}
        </div>
      </section>`;
}

function gallery() {
  const nav = GROUPS.map(
    (g) =>
      `      <div class="g-navgroup"><span class="m-label">${g}</span>${byGroup(g)
        .map((c) => `<a href="#${c.cls}">${c.name}</a>`)
        .join("")}</div>`
  ).join("\n");

  const body = GROUPS.map(
    (g) => `    <h2 class="g-group">${g}</h2>\n${byGroup(g).map(swatchRow).join("\n")}`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Components — Mosaic Services</title>

    <!-- ⚠ GENERATED by \`npm run build:components\` from
         build/design-components.mjs. Do not hand-edit.

         This page is the repo's own answer to "what does a Badge look
         like". check-design-components.mjs compares it against the
         design system on claude.ai, so the two cannot drift. -->

    <link rel="stylesheet" href="mosaic.css" />
    <link rel="stylesheet" href="fonts.css" />
    <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    <style>
        body { margin: 0; background: var(--background); color: var(--on-surface); font-family: var(--font-sans); }
        .g-wrap { max-width: var(--container-max); margin: 0 auto; padding: var(--space-md); }
        .g-title { font-family: var(--font-display); font-size: var(--display-lg-size); color: var(--primary); margin: var(--space-md) 0 var(--space-base); }
        .g-lede { color: var(--on-surface-variant); max-width: 60ch; margin: 0 0 var(--space-md); }
        .g-nav { display: flex; flex-wrap: wrap; gap: var(--space-md); padding: var(--space-md) 0; border-top: 1px solid var(--outline-variant); border-bottom: 1px solid var(--outline-variant); margin-bottom: var(--space-lg); }
        .g-navgroup { display: flex; flex-direction: column; gap: 2px; }
        .g-navgroup a { color: var(--primary); text-decoration: none; font-size: 13px; }
        .g-navgroup a:hover { text-decoration: underline; }
        .g-group { font-family: var(--font-display); font-size: var(--headline-lg-size); color: var(--primary); margin: var(--space-lg) 0 var(--space-sm); }
        .g-card { background: var(--surface-container-lowest); border: 1px solid var(--outline-variant); border-radius: var(--radius-xl); padding: var(--space-md); margin-bottom: var(--space-md); }
        .g-card header { display: flex; align-items: baseline; gap: var(--space-sm); }
        .g-card h3 { margin: 0; font-family: var(--font-serif); font-size: var(--headline-md-size); }
        .g-card code { font-size: 12px; color: var(--on-surface-variant); }
        .g-summary { margin: var(--space-xs) 0 var(--space-base); color: var(--on-surface-variant); font-size: 14px; max-width: 70ch; }
        .g-variants { font-size: 12px; color: var(--on-surface-variant); margin-bottom: 4px; }
        .g-variants b { color: var(--on-surface); }
        .g-demo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); padding: var(--space-md); margin-top: var(--space-base); background: var(--background); border-radius: var(--radius); }
        .g-item { display: flex; }
    </style>
</head>
<body>
    <div class="g-wrap">
        <h1 class="g-title">Components</h1>
        <p class="g-lede">Every Mosaic component, as the app really draws it. Generated from
            <code>build/design-components.mjs</code>, which is also what produces the stylesheet,
            the design system's copy, and the prompts Claude Design composes with. If this page is
            right, all four are.</p>

        <nav class="g-nav">
${nav}
        </nav>

${body}
    </div>
</body>
</html>
`;
}

/* ---- Write --------------------------------------------------- */

const css = stylesheet();
put("build/design-tokens/components.css", css);
put("public/components-demo.html", gallery());

// The prompt files, staged for the design system. Cleared first so a
// component removed from the source cannot linger as a stale file.
const promptDir = join(repo, "build", "design-system", "components");
if (!check) {
  try { rmSync(promptDir, { recursive: true }); } catch { /* first run */ }
  mkdirSync(promptDir, { recursive: true });
}
for (const c of COMPONENTS) {
  put(`build/design-system/components/${c.name}.prompt.md`, prompt(c));
}

// And spliced into the Tailwind input, so it lands in public/mosaic.css.
const inputPath = join(repo, "build", "tailwind-input.css");
const rawInput = readFileSync(inputPath, "utf8");
const input = (rawInput.charCodeAt(0) === 0xFEFF ? rawInput.slice(1) : rawInput).replace(/\r\n/g, "\n");
const open = "/* @generated:start components */";
const close = "/* @generated:end components */";
const i = input.indexOf(open), j = input.indexOf(close, i);
if (i === -1 || j === -1) {
  console.error("build/tailwind-input.css: no @generated components markers — add them");
  process.exit(1);
}
const spliced = `${input.slice(0, i + open.length)}\n${css}${input.slice(j)}`;
if (spliced !== input) {
  if (!check) writeFileSync(inputPath, spliced);
  changed.push("build/tailwind-input.css");
}

/* ---- 4. The phone's stylesheet ------------------------------
   public/mobile/tokens.css was a hand-maintained copy of the palette,
   mirroring mosaic-theme.js — which is itself the superseded source. A
   third definition of the brand, drifting quietly.

   The shell cannot simply load mosaic.css: that carries Tailwind's
   preflight, which would reset margins under a layout built without it.
   So the same generated material is emitted here on its own — the token
   block and the components, no utilities, no reset. One source, two
   stylesheets, and this file stops being anybody's to edit. */

const tokenBlock = (() => {
  const o = input.indexOf("/* @generated:start app-tokens */");
  const c = input.indexOf("/* @generated:end */", o);
  if (o === -1 || c === -1) {
    console.error("build/tailwind-input.css: no @generated app-tokens block to mirror");
    process.exit(1);
  }
  return input.slice(o + "/* @generated:start app-tokens */".length, c).trim();
})();

put("public/mobile/tokens.css", `/* ============================================================
   tokens.css — the brand and the components, for the mobile shell.
   ------------------------------------------------------------
   GENERATED by \`npm run build:components\`. Do not hand-edit.

   The phone does not load mosaic.css, because that carries Tailwind's
   preflight and this layout was not built under one. It gets the same
   generated tokens and the same generated components instead, so a
   Button is one definition on both — it was a hand-kept copy of the
   palette until MS design-sync, mirroring a source that had already
   been superseded.
   ============================================================ */

:root {
${tokenBlock}

${EXTRA_ROOT}
}

${css.slice(css.indexOf("/* ── Core"))}`);

/* ---- 5. The design system's own preview cards ---------------
   The Design System pane builds its index from each file's first-line
   @dsCard marker. These were hand-authored, and the colour ones printed
   their hex as literal text beside a swatch that read the token — so
   moving a token left the card showing the new colour next to the old
   number. Generated now, from the same place the colour comes from. */

function card({ group, name, subtitle, width = 700, height = 200, body }) {
  return `<!-- @dsCard group="${group}" viewport="${width}x${height}" name="${name}" subtitle="${subtitle}" -->
<!DOCTYPE html><html><head><meta charset="utf-8"/>
<link rel="stylesheet" href="${"../".repeat(1)}styles.css"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"/>
<style>
  body { margin:0; padding:18px; background:var(--background); font-family:var(--font-sans); color:var(--on-surface); }
  .r { display:flex; flex-wrap:wrap; gap:14px; align-items:center; }
  .sw { display:flex; flex-direction:column; width:150px; border-radius:var(--radius); overflow:hidden; border:1px solid var(--outline-variant); }
  .sw .t { padding:16px 12px; font-size:12px; font-weight:600; }
  .sw .b { padding:7px 12px; font-size:10.5px; background:var(--surface-container-lowest); color:var(--on-surface-variant); display:flex; justify-content:space-between; gap:6px; }
  .sw .b code { font-family:ui-monospace,monospace; }
</style></head><body>
${body}
</body></html>
`;
}

/** A swatch whose printed value is written by the generator from the same
 *  token the swatch paints with, so the two cannot disagree. */
function swatch(token, value, onToken) {
  return `  <div class="sw"><div class="t" style="background:var(--${token});color:var(--${onToken})">${token}</div>` +
    `<div class="b"><code>--${token}</code><code>${value}</code></div></div>`;
}

const COLOUR_CARDS = [
  { name: "Brand", subtitle: "The seal's own colours",
    tokens: ["navy", "navy-900", "navy-800", "ocean", "steel", "sand", "gold"] },
  { name: "Primary", subtitle: "Primary, secondary, tertiary and their containers",
    tokens: ["primary", "secondary", "tertiary", "primary-container", "secondary-container", "tertiary-container"] },
  { name: "Surfaces", subtitle: "Cream through parchment to white",
    tokens: ["background", "surface", "surface-container-low", "surface-container", "surface-container-high", "surface-container-highest", "surface-variant"] },
  { name: "Status", subtitle: "Error, success, warning — each with its container",
    tokens: ["error", "error-container", "success", "success-container", "warning", "warning-container"] },
  { name: "Event colours", subtitle: "The eight an editor can paint an Event",
    tokens: ["event-steel", "event-ocean", "event-navy", "event-green", "event-gold", "event-amber", "event-plum", "event-rose"] },
  { name: "Highlighter", subtitle: "Note Module pens — outside the brand on purpose",
    tokens: ["highlight-yellow", "highlight-green", "highlight-blue", "highlight-red", "highlight-orange", "highlight-purple"] },
];

/** Readable ink for a swatch. Its own on- token if the palette has one,
 *  otherwise decided by how dark the colour actually is — a card that
 *  prints navy on dark red is a card nobody can read. */
function inkFor(token) {
  if (colors[`on-${token}`]) return `on-${token}`;
  if (/-container$/.test(token) && colors[`on-${token}`]) return `on-${token}`;
  const hex = colors[token];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Rec. 601 luma: good enough to answer "is this dark".
  return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "on-primary" : "on-surface";
}

for (const c of COLOUR_CARDS) {
  const rows = c.tokens
    .filter((t) => colors[t])
    .map((t) => swatch(t, colors[t], inkFor(t)))
    .join("\n");
  const height = 120 + Math.ceil(c.tokens.length / 4) * 90;
  put(
    `build/design-system/guidelines/colors-${c.name.toLowerCase().replace(/\s+/g, "-")}.card.html`,
    card({ group: "Colors", name: c.name, subtitle: c.subtitle, width: 700, height, body: `<div class="r">\n${rows}\n</div>` })
  );
}

for (const c of COMPONENTS) {
  const demo = c.examples.map((e) => `  <div>${e}</div>`).join("\n");
  put(
    `build/design-system/components/${c.name}.card.html`,
    card({
      group: c.group,
      name: c.name,
      subtitle: firstSentence(c.summary).slice(0, 120),
      width: 700,
      height: 100 + c.examples.length * 70,
      body: `<div class="r">\n${demo}\n</div>`,
    })
  );
}

/* ---- 6. The readme's component index ------------------------
   The prose around it is hand-written and worth keeping; this list is
   not. It went stale last time because it was typed. */

const indexPath = join(repo, "build", "design-system", "readme.md");
try {
  const rawReadme = readFileSync(indexPath, "utf8");
  const readme = (rawReadme.charCodeAt(0) === 0xFEFF ? rawReadme.slice(1) : rawReadme).replace(/\r\n/g, "\n");
  const o = "<!-- @generated:start component-index -->";
  const c = "<!-- @generated:end -->";
  const a = readme.indexOf(o), b = readme.indexOf(c, a);
  if (a !== -1 && b !== -1) {
    const index = GROUPS.map((g) => {
      const list = byGroup(g);
      if (!list.length) return "";
      return `**${g}**\n` + list.map((x) =>
        `- **${x.name}** \`.${x.cls}\` — ${firstSentence(x.summary)}.`).join("\n");
    }).filter(Boolean).join("\n\n");
    const next = `${readme.slice(0, a + o.length)}\n\n${index}\n\n${readme.slice(b)}`;
    if (next !== readme) {
      if (!check) writeFileSync(indexPath, next);
      changed.push("build/design-system/readme.md");
    }
  }
} catch { /* the readme is optional; the components are not */ }

/* ---- Report -------------------------------------------------- */

console.log(`${COMPONENTS.length} components, ${GROUPS.length} groups`);
if (!changed.length) {
  console.log("everything current");
} else {
  for (const c of changed) console.log(`${check ? "stale  " : "written"}  ${c}`);
}
if (check && changed.length) {
  console.error(`\n${changed.length} file(s) behind build/design-components.mjs — run: npm run build:components`);
  process.exit(1);
}

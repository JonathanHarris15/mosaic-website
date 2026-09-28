#!/usr/bin/env node
/* Append ghost-density.css and ghost-mobile.css to public/mosaic.css after Tailwind build. */

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(repo, "public", "mosaic.css");
const marker = "/* @ghost-density:start */";

function read(rel) {
  return readFileSync(join(repo, rel), "utf8").trim();
}

let css = readFileSync(outPath, "utf8");
const start = css.indexOf(marker);
if (start !== -1) {
  css = css.slice(0, start);
}

const block = [
  marker,
  read("build/ghost-density.css"),
  "/* @ghost-mobile:start */",
  read("build/ghost-mobile.css"),
].join("\n\n");

writeFileSync(outPath, css.trimEnd() + "\n\n" + block + "\n");

copyFileSync(
  join(repo, "build", "ghost-mobile-app.css"),
  join(repo, "public", "ghost-mobile-app.css"),
);

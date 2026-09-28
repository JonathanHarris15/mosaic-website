#!/usr/bin/env node
/* Append ghost-density.css to public/mosaic.css after Tailwind build.
   @import at the tail of tailwind-input.css is not emitted by the CLI. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const marker = "/* @ghost-density:start */";
const density = readFileSync(join(repo, "build", "ghost-density.css"), "utf8");
const outPath = join(repo, "public", "mosaic.css");
let css = readFileSync(outPath, "utf8");
const start = css.indexOf(marker);
if (start !== -1) {
  css = css.slice(0, start);
}
writeFileSync(outPath, css.trimEnd() + "\n\n" + marker + "\n" + density.trim() + "\n");

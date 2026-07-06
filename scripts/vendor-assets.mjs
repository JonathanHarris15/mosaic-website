/* ============================================================
   vendor-assets.mjs — download every CDN asset in the manifest
   into public/, so the app can run fully offline / bundled in a
   native (Capacitor) WebView. Re-runnable and idempotent.

   Usage:  node scripts/vendor-assets.mjs
   ============================================================ */

import { JS_CSS_ASSETS } from "./asset-manifest.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

async function download({ url, downloadUrl, local }) {
  const from = downloadUrl || url;
  const res = await fetch(from, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${from}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 128) throw new Error(`Suspiciously small (${buf.length}B): ${from}`);
  const dest = join(PUBLIC, local);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

let ok = 0, failed = 0;
const results = await Promise.allSettled(JS_CSS_ASSETS.map((a) => download(a)));
results.forEach((r, i) => {
  const a = JS_CSS_ASSETS[i];
  if (r.status === "fulfilled") {
    ok++;
    console.log(`  ok   ${(r.value / 1024).toFixed(1).padStart(7)} KB  ${a.local}`);
  } else {
    failed++;
    console.error(`  FAIL              ${a.local}  <- ${r.reason.message}`);
  }
});
console.log(`\n${ok} downloaded, ${failed} failed, ${JS_CSS_ASSETS.length} total`);
if (failed) process.exit(1);
